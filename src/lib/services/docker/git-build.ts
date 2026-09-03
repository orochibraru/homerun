import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { RemoteHostConnection } from "./client.ts";
import type { RegistryAuth } from "./containers.ts";

const logger = new Logger("GitBuild");
const execFileAsync = promisify(execFile);

/** What this mixin needs from whatever's ahead of it in the merge chain (see docker.service.ts) : the container mixin's pushImage. */
interface RequiresContainerMixin {
	pushImage: (
		localRef: string,
		targetRef: string,
		auth?: RegistryAuth,
		remote?: RemoteHostConnection | null,
	) => Promise<void>;
}

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
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerGitBuildMixin<
	TBase extends Constructor<BaseDockerService & RequiresContainerMixin>,
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
		/** Shallow-clones the repo at `ref` into `dir`. A bare commit SHA doesn't work : branches and tags only. */
		async #cloneRepo(
			params: GitBuildParams,
			ref: string,
			dir: string,
			onProgress?: (line: string) => void,
		): Promise<void> {
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
		}

		/** Best-effort cache warm-up : no cache yet (first build) or a briefly unreachable registry never fails the build. */
		async #pullBuildCache(
			docker: ReturnType<BaseDockerService["getDocker"]>,
			cacheRef: string,
			cacheAuth: RegistryAuth | undefined,
			onProgress?: (line: string) => void,
		): Promise<void> {
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
				logger.warn(`No build cache pulled for ${cacheRef}`, {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		/** Runs the image build itself, forwarding only changed output lines to `onProgress`. */
		async #runBuild(
			params: GitBuildParams,
			dir: string,
			cacheRef: string | null,
			onProgress?: (line: string) => void,
		): Promise<void> {
			const docker = this.getDocker(params.remote);
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

			await new Promise<void>((resolvePromise, reject) => {
				let lastStatus = "";
				docker.modem.followProgress(
					stream,
					(err: Error | null) => (err ? reject(err) : resolvePromise()),
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
		}

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
				await this.#cloneRepo(params, ref, dir, onProgress);

				if (cacheRef) {
					await this.#pullBuildCache(docker, cacheRef, cacheAuth, onProgress);
				}

				await this.#runBuild(params, dir, cacheRef, onProgress);
				logger.info(`Build succeeded: tag=${params.tag}`);

				if (cacheRef) {
					onProgress?.(`Pushing build cache ${cacheRef}...`);
					// this.pushImage : DockerContainerMixin is lower in the chain
					// than this mixin (see docker.service.ts's merge order), so
					// it's a real inherited method here, not a separate helper.
					await this.pushImage(
						params.tag,
						cacheRef,
						cacheAuth,
						params.remote,
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
	};
}
