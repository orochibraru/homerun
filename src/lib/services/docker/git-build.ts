import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { RemoteHostConnection } from "./client.ts";

const logger = new Logger("GitBuild");
const execFileAsync = promisify(execFile);

export interface BuildCacheRegistryConfig {
	password: string;
	registryUrl: string;
	username: string;
}

export interface GitBuildParams {
	// Subdirectory inside the repo to use as the build context (".": repo root).
	buildContext?: string | null;
	// Registry to pull a `--cache-from` source from before the build and push
	// the fresh layers back to after (best-effort both ways : a missing cache
	// image or a failed push never fails the build itself, it just means no
	// cache this time). Undefined/null : no cache-from/cache-to at all, same
	// behavior as before this existed.
	cacheRegistry?: BuildCacheRegistryConfig | null;
	// Relative to buildContext.
	dockerfilePath?: string | null;
	// Branch, tag, or commit : passed to `git clone --branch`, so only
	// branches/tags work directly (a bare commit SHA needs a full clone,
	// not attempted here : shallow-clone-by-ref covers the common case).
	gitRef?: string | null;
	gitUrl: string;
	remote?: RemoteHostConnection | null;
	tag: string;
}

export interface GitBuildResult {
	error?: string;
	success: boolean;
}

/** Git-clone-then-Dockerfile-build, tagging the result for the normal deploy pipeline to run like any other image. */
export function DockerGitBuildMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerGitBuildService extends Base {
		/**
		 * Clones a git repo at a specific ref and builds its Dockerfile into
		 * a local image, tagged `tag` : the deploy pipeline then runs that
		 * tag like any other image, no registry involved. Shells out to the
		 * system `git` binary (same "shell out to a well-known CLI tool"
		 * precedent as `tar`/`df`/`nvidia-smi` elsewhere in this app) rather
		 * than a git library dependency.
		 */
		async buildFromGit(
			params: GitBuildParams,
			onProgress?: (line: string) => void,
		): Promise<GitBuildResult> {
			const ref = params.gitRef || "main";
			const dir = await mkdtemp(join(tmpdir(), "homerun-build-"));
			const docker = this.getDocker(params.remote);

			// Same image name as `tag` (before the ":"), just pushed under the
			// cache registry instead of staying purely local : a stable name
			// per service so the *next* build of the same service finds this
			// one as its cache-from source.
			const imageName = params.tag.split(":")[0];
			const cacheRef = params.cacheRegistry
				? `${params.cacheRegistry.registryUrl}/${imageName}:cache`
				: null;
			const cacheAuth = params.cacheRegistry
				? {
						password: params.cacheRegistry.password,
						serveraddress: params.cacheRegistry.registryUrl,
						username: params.cacheRegistry.username,
					}
				: undefined;

			try {
				onProgress?.(`Cloning ${params.gitUrl} (${ref})...`);
				await execFileAsync("git", [
					"clone",
					"--depth",
					"1",
					"--branch",
					ref,
					"--single-branch",
					params.gitUrl,
					dir,
				]);
				logger.info(`Cloned: ${params.gitUrl}#${ref} -> ${dir}`);

				if (cacheRef) {
					onProgress?.(`Pulling build cache ${cacheRef}...`);
					try {
						const pullStream: NodeJS.ReadableStream = await docker.pull(
							cacheRef,
							cacheAuth ? { authconfig: cacheAuth } : {},
						);
						await new Promise<void>((res) => {
							docker.modem.followProgress(pullStream, () => res());
						});
					} catch (err) {
						// No cache yet (first build) or the registry's briefly
						// unreachable : never fails the build over this.
						logger.warn(`No build cache pulled for ${cacheRef}`, {
							error: err instanceof Error ? err.message : String(err),
						});
					}
				}

				const contextDir = params.buildContext
					? join(dir, params.buildContext)
					: dir;
				const dockerfile = params.dockerfilePath || "Dockerfile";

				onProgress?.(`Building ${dockerfile}...`);
				const stream = await docker.buildImage(
					{ context: contextDir, src: ["."] },
					{
						dockerfile,
						rm: true,
						t: params.tag,
						// The classic (non-BuildKit) build API this app uses wants
						// cachefrom as a JSON-encoded array string, despite
						// @types/dockerode typing it as a plain string : verified
						// live, a bare string 400s with "error reading cache-from:
						// invalid character ... looking for beginning of value"
						// (the daemon tries to JSON-parse it). No
						// BUILDKIT_INLINE_CACHE buildarg : that's a BuildKit-only
						// concept, the classic builder just warns "not consumed"
						// and ignores it, real cache reuse here comes from the
						// cachefrom image's layers alone (verified live : a repeat
						// build showed "Using cache" for every step).
						...(cacheRef ? { cachefrom: JSON.stringify([cacheRef]) } : {}),
					},
				);

				await new Promise<void>((resolve, reject) => {
					let lastStatus = "";
					docker.modem.followProgress(
						stream,
						(err: Error | null) => {
							if (err) {
								reject(err);
							} else {
								resolve();
							}
						},
						(event: { stream?: string; error?: string }) => {
							if (event.error) {
								reject(new Error(event.error));
								return;
							}
							const text = event.stream?.trim();
							// Docker build output is far chattier than a pull's
							// layer events : only forward lines that actually
							// changed, same "status change, not byte-tick"
							// filtering as pullImage.
							if (text && text !== lastStatus) {
								lastStatus = text;
								onProgress?.(text);
							}
						},
					);
				});

				logger.info(`Build succeeded: tag=${params.tag}`);

				if (cacheRef) {
					onProgress?.(`Pushing build cache ${cacheRef}...`);
					await this.pushBuildCache(
						docker,
						params.tag,
						cacheRef,
						cacheAuth,
					).catch((err) => {
						// Best-effort : the deploy already succeeded, a failed
						// cache push just means the next build starts fresh.
						logger.warn(`Couldn't push build cache ${cacheRef}`, {
							error: err instanceof Error ? err.message : String(err),
						});
					});
				}

				return { success: true };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.error(`Build failed: ${params.gitUrl}#${ref}`, err);
				return { error: message, success: false };
			} finally {
				await rm(dir, { force: true, recursive: true }).catch(() => {
					// Best-effort cleanup : a leftover temp dir isn't worth
					// failing the build over.
				});
			}
		}

		/** Tags the just-built image under `cacheRef` and pushes it, so the next build of this service can pull it as a `--cache-from` source. */
		private async pushBuildCache(
			docker: ReturnType<BaseDockerService["getDocker"]>,
			builtTag: string,
			cacheRef: string,
			auth:
				| { password: string; serveraddress: string; username: string }
				| undefined,
		): Promise<void> {
			const [repo, tag] = splitRef(cacheRef);
			await docker.getImage(builtTag).tag({ repo, tag });
			const pushStream = await docker
				.getImage(`${repo}:${tag}`)
				.push({ authconfig: auth, tag });
			await new Promise<void>((res, reject) => {
				docker.modem.followProgress(
					pushStream,
					(err: Error | null) => (err ? reject(err) : res()),
					() => {},
				);
			});
			logger.info(`Build cache pushed: ${cacheRef}`);
		}
	};
}

/** Splits "registry.example.com/name:tag" into ["registry.example.com/name", "tag"]. */
function splitRef(ref: string): [string, string] {
	const lastColon = ref.lastIndexOf(":");
	const lastSlash = ref.lastIndexOf("/");
	// A colon before the last slash is a registry port (e.g. "host:5000/name"),
	// not a tag separator.
	if (lastColon === -1 || lastColon < lastSlash) {
		return [ref, "latest"];
	}
	return [ref.slice(0, lastColon), ref.slice(lastColon + 1)];
}
