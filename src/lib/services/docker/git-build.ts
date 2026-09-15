import type { Readable } from "node:stream";
import {
	authenticatedCloneUrl,
	cloneFailureHint,
	type GitCredential,
	redactCloneUrl,
} from "$lib/git-clone-url";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import type { RemoteHostConnection } from "./client.ts";
import type { RegistryAuth } from "./containers.ts";
import { MANAGED_LABEL } from "./labels.ts";

const logger = new Logger("GitBuild");

const GIT_IMAGE = "alpine/git:latest";

const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

export function demuxDockerFrames(raw: Buffer): string {
	const parts: string[] = [];
	let offset = 0;
	while (offset + 8 <= raw.length) {
		const stream = raw[offset];
		if (stream > 2 || raw[offset + 1] !== 0) {
			return raw.toString("utf8").trim();
		}
		const length = raw.readUInt32BE(offset + 4);
		parts.push(raw.subarray(offset + 8, offset + 8 + length).toString("utf8"));
		offset += 8 + length;
	}
	return parts.join("").trim();
}

export function extractCommitSha(output: string): string | null {
	return /\b[0-9a-f]{40}\b/.exec(output)?.[0] ?? null;
}

const ignoreCleanupFailure = () => undefined;

const WORKSPACE = "/workspace";
const REPO_DIR = `${WORKSPACE}/repo`;

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
	// Credentials for a private repo, when a git provider is connected for
	// the repo's host : injected into the clone URL rather than relying on a
	// credential helper, since the clone runs in a container with no tty (git
	// would otherwise fail with "could not read Username ... No such device").
	credential?: GitCredential | null;
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
	/** The commit that was actually built, when git reported one. */
	commit?: string | null;
	error?: string;
	success: boolean;
}

/** Git-clone-then-Dockerfile-build, tagging the result for the normal deploy pipeline to run like any other image. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerGitBuildMixin<
	TBase extends Constructor<BaseDockerService & RequiresContainerMixin>,
>(Base: TBase) {
	return class DockerGitBuildService extends Base {
		async #ensureGitImage(
			remote?: RemoteHostConnection | null,
			onProgress?: (line: string) => void,
		): Promise<void> {
			const docker = this.getDocker(remote);
			try {
				await docker.getImage(GIT_IMAGE).inspect();
				return;
			} catch {
				onProgress?.(`Pulling ${GIT_IMAGE}...`);
			}
			const stream: NodeJS.ReadableStream = await docker.pull(GIT_IMAGE, {});
			await new Promise<void>((resolve, reject) => {
				docker.modem.followProgress(stream, (err) =>
					err ? reject(err) : resolve(),
				);
			});
		}

		async #runInWorkspace(opts: {
			cmd: string[];
			entrypoint: string[];
			readOnly?: boolean;
			remote?: RemoteHostConnection | null;
			volumeName: string;
		}): Promise<{ output: string; statusCode: number }> {
			const { cmd, entrypoint, readOnly = false, remote, volumeName } = opts;
			const docker = this.getDocker(remote);
			const container = await docker.createContainer({
				Cmd: cmd,
				Entrypoint: entrypoint,
				Env: ["GIT_TERMINAL_PROMPT=0"],
				HostConfig: {
					Binds: [`${volumeName}:${WORKSPACE}${readOnly ? ":ro" : ""}`],
				},
				Image: GIT_IMAGE,
				Labels: { [MANAGED_LABEL]: "true" },
			});
			try {
				await container.start();
				const result = await Promise.race([
					container.wait(),
					new Promise<never>((_, reject) => {
						setTimeout(
							() => reject(new Error("The clone timed out.")),
							CLONE_TIMEOUT_MS,
						);
					}),
				]);
				const logs = await container.logs({ stderr: true, stdout: true });
				return {
					output: demuxDockerFrames(logs as unknown as Buffer),
					statusCode: result.StatusCode,
				};
			} finally {
				await container.remove({ force: true }).catch(ignoreCleanupFailure);
			}
		}

		async #cloneRepo(
			params: GitBuildParams,
			ref: string,
			volumeName: string,
			onProgress?: (line: string) => void,
		): Promise<string | null> {
			const cloneUrl = authenticatedCloneUrl(
				params.gitUrl,
				params.credential ?? null,
			);
			onProgress?.(`Cloning ${redactCloneUrl(cloneUrl)} (${ref})...`);
			const clone = await this.#runInWorkspace({
				cmd: [
					"clone",
					"--depth",
					"1",
					"--branch",
					ref,
					"--single-branch",
					cloneUrl,
					REPO_DIR,
				],
				entrypoint: ["git"],
				remote: params.remote,
				volumeName,
			});
			if (clone.statusCode !== 0) {
				const output = redactCloneUrl(
					clone.output || `git clone exited ${clone.statusCode}`,
				);
				throw new Error(cloneFailureHint(params.gitUrl, output));
			}
			logger.info(`Cloned: ${params.gitUrl}#${ref} -> ${volumeName}`);

			const rev = await this.#runInWorkspace({
				cmd: ["-C", REPO_DIR, "rev-parse", "HEAD"],
				entrypoint: ["git"],
				readOnly: true,
				remote: params.remote,
				volumeName,
			}).catch(() => null);
			const commit =
				rev?.statusCode === 0 ? extractCommitSha(rev.output) : null;
			if (commit) {
				onProgress?.(`Building commit ${commit.slice(0, 7)}`);
			}
			return commit;
		}

		async #openContext(
			volumeName: string,
			buildContext: string | null | undefined,
			remote?: RemoteHostConnection | null,
		): Promise<{ close: () => Promise<void>; stream: Readable }> {
			const docker = this.getDocker(remote);
			const container = await docker.createContainer({
				Entrypoint: ["true"],
				HostConfig: { Binds: [`${volumeName}:${WORKSPACE}:ro`] },
				Image: GIT_IMAGE,
				Labels: { [MANAGED_LABEL]: "true" },
			});
			await container.start();
			await container.wait();

			const path = buildContext
				? `${REPO_DIR}/${buildContext.replace(/^\/+|\/+$/g, "")}/.`
				: `${REPO_DIR}/.`;
			const stream = (await container.getArchive({ path })) as Readable;
			return {
				close: async () => {
					await container.remove({ force: true }).catch(ignoreCleanupFailure);
				},
				stream,
			};
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
			context: Readable,
			cacheRef: string | null,
			onProgress?: (line: string) => void,
		): Promise<void> {
			const docker = this.getDocker(params.remote);
			const dockerfile = params.dockerfilePath || "Dockerfile";

			onProgress?.(`Building ${dockerfile}...`);
			const stream = await docker.buildImage(context, {
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
			});

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
			const docker = this.getDocker(params.remote);
			const volumeName = `homerun-build-${crypto.randomUUID()}`;

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

			let commit: string | null = null;
			let context: { close: () => Promise<void>; stream: Readable } | null =
				null;
			try {
				await docker.createVolume({
					Labels: { [MANAGED_LABEL]: "true" },
					Name: volumeName,
				});
				await this.#ensureGitImage(params.remote, onProgress);
				commit = await this.#cloneRepo(params, ref, volumeName, onProgress);

				if (cacheRef) {
					await this.#pullBuildCache(docker, cacheRef, cacheAuth, onProgress);
				}

				context = await this.#openContext(
					volumeName,
					params.buildContext,
					params.remote,
				);
				await this.#runBuild(params, context.stream, cacheRef, onProgress);
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

				return { commit, success: true };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.error(`Build failed: ${params.gitUrl}#${ref}`, err);
				return { error: message, success: false };
			} finally {
				await context?.close();
				// Best-effort cleanup : a leftover temp dir isn't worth
				// failing the build over.
				await docker.getVolume(volumeName).remove().catch(ignoreCleanupFailure);
			}
		}
	};
}
