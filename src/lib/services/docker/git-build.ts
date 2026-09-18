import { PassThrough, type Readable } from "node:stream";
import type { BuildMethod } from "$lib/build-methods";
import { config } from "$lib/config";
import {
	authenticatedCloneUrl,
	cloneFailureHint,
	type GitCredential,
	redactCloneUrl,
} from "$lib/git-clone-url";
import { gitCheckoutSteps } from "$lib/git-ref";
import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";
import {
	BUILDER_HELPER_IMAGE,
	BUILDER_HELPER_TAG,
	BUILDER_SCRIPT,
	BUILDER_TOOLS_VOLUME,
	builderEnv,
	buildFailureMessage,
	createLineSplitter,
	DOCKER_SOCKET,
} from "./builder-run.ts";
import type { RemoteHostConnection } from "./client.ts";
import { MANAGED_LABEL } from "./labels.ts";

const logger = new Logger("GitBuild");

const GIT_IMAGE = "alpine/git:latest";

const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

const BUILDER_TIMEOUT_MS = 60 * 60 * 1000;

const RECENT_LINE_LIMIT = 40;

/**
 * Decodes Docker's multiplexed stdout/stderr stream format (an 8-byte header
 * per frame: stream type + big-endian length, then that many payload bytes)
 * into plain text, for a non-Tty container's combined logs/output. Falls
 * back to treating `raw` as plain UTF-8 text when it doesn't parse as framed
 * output.
 */
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

/** The first full 40-character commit SHA found in `output` (e.g. `git rev-parse HEAD`), or null if none appears. */
export function extractCommitSha(output: string): string | null {
	return /\b[0-9a-f]{40}\b/.exec(output)?.[0] ?? null;
}

const ignoreCleanupFailure = () => undefined;

const WORKSPACE = "/workspace";
const REPO_DIR = `${WORKSPACE}/repo`;

export interface BuildCacheRegistryConfig {
	password: string;
	registryUrl: string;
	username: string;
}

export interface GitBuildParams {
	bakeFile?: string | null;
	bakeTarget?: string | null;
	// Subdirectory inside the repo to use as the build context (".": repo root).
	buildContext?: string | null;
	buildMethod?: BuildMethod | null;
	cacheRegistry?: BuildCacheRegistryConfig | null;
	commit?: string | null;
	// Credentials for a private repo, when a git provider is connected for
	// the repo's host : injected into the clone URL rather than relying on a
	// credential helper, since the clone runs in a container with no tty (git
	// would otherwise fail with "could not read Username ... No such device").
	credential?: GitCredential | null;
	// Relative to buildContext.
	dockerfilePath?: string | null;
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

/** Git-clone-then-BuildKit-build, tagging the result for the normal deploy pipeline to run like any other image. */
// oxlint-disable-next-line max-lines-per-function -- mixin factory: the body is a class definition, not a procedure
export function DockerGitBuildMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerGitBuildService extends Base {
		/** Pulls the `alpine/git` helper image if it isn't already present locally, reporting progress via `onProgress`. */
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

		/**
		 * Runs one command (`entrypoint`/`cmd`) inside a throwaway
		 * `alpine/git` container bound to the build's shared workspace
		 * volume, waits for it to exit (bounded by `CLONE_TIMEOUT_MS`), and
		 * returns its demuxed combined output and exit code. Always removes
		 * the container afterwards, even on failure.
		 *
		 * @throws When the command doesn't exit before the timeout.
		 */
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

		/**
		 * Shallow-clones `params.gitUrl` at `ref` (a branch, tag or full
		 * commit SHA, see `gitCheckoutSteps`) into the
		 * workspace volume (via `#runInWorkspace`), then resolves the commit
		 * that was actually built: the cloned HEAD, unless `params.commit`
		 * was pinned and the branch has since moved past it, in which case
		 * it fetches and checks out that exact commit via `#checkoutCommit`.
		 * Reports progress via `onProgress`.
		 *
		 * @returns The built commit SHA, or null when it couldn't be
		 *   determined (e.g. `rev-parse` failed).
		 * @throws With a redacted, hint-augmented message when the clone
		 *   itself fails.
		 */
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
			for (const cmd of gitCheckoutSteps(cloneUrl, ref, REPO_DIR)) {
				// oxlint-disable-next-line no-await-in-loop -- each git step works on the previous one's checkout
				const step = await this.#runInWorkspace({
					cmd,
					entrypoint: ["git"],
					remote: params.remote,
					volumeName,
				});
				if (step.statusCode !== 0) {
					const output = redactCloneUrl(
						step.output || `git exited ${step.statusCode}`,
					);
					throw new Error(cloneFailureHint(params.gitUrl, output));
				}
			}
			logger.info(`Cloned: ${params.gitUrl}#${ref} -> ${volumeName}`);

			const rev = await this.#runInWorkspace({
				cmd: ["-C", REPO_DIR, "rev-parse", "HEAD"],
				entrypoint: ["git"],
				readOnly: true,
				remote: params.remote,
				volumeName,
			}).catch(() => null);
			const head = rev?.statusCode === 0 ? extractCommitSha(rev.output) : null;
			const commit =
				params.commit && head !== params.commit
					? await this.#checkoutCommit(
							params,
							params.commit,
							volumeName,
							onProgress,
						)
					: head;
			if (commit) {
				onProgress?.(`Building commit ${commit.slice(0, 7)}`);
			}
			return commit;
		}

		/**
		 * Fetches and checks out one specific commit by SHA into the
		 * already-cloned workspace, for when the branch has moved past the
		 * commit whose status checks were verified before this build started.
		 *
		 * @throws When the fetch or checkout step fails.
		 */
		async #checkoutCommit(
			params: GitBuildParams,
			commit: string,
			volumeName: string,
			onProgress?: (line: string) => void,
		): Promise<string> {
			onProgress?.(
				`The branch moved since its status checks were read, checking out the checked commit ${commit.slice(0, 7)}...`,
			);
			const steps = [
				["-C", REPO_DIR, "fetch", "--depth", "1", "origin", commit],
				["-C", REPO_DIR, "checkout", "--detach", commit],
			];
			for (const cmd of steps) {
				// oxlint-disable-next-line no-await-in-loop -- the checkout depends on the fetch before it
				const step = await this.#runInWorkspace({
					cmd,
					entrypoint: ["git"],
					remote: params.remote,
					volumeName,
				});
				if (step.statusCode !== 0) {
					throw new Error(
						`Couldn't check out the checked commit ${commit.slice(0, 7)}: ${redactCloneUrl(step.output || `git exited ${step.statusCode}`)}`,
					);
				}
			}
			return commit;
		}

		/**
		 * Builds the cloned repo with the service's build method (BuildKit
		 * through `docker buildx build` or `docker buildx bake`, Nixpacks,
		 * Railpack or pack) inside a throwaway `docker:cli` container on the
		 * same daemon, with the workspace volume, a persistent tools volume
		 * (builder binaries and the cache builder's buildx config) and the
		 * daemon's socket mounted, so the build tags `params.tag` straight
		 * into that daemon's image store. With a cache registry the layer
		 * cache is imported from and exported to it. Streams the output to
		 * `onProgress` line by line.
		 *
		 * @throws When the build settings are invalid, or the build exits
		 *   non-zero (with its most telling output line) or runs past the
		 *   timeout.
		 */
		async #runBuilder(
			params: GitBuildParams,
			method: BuildMethod,
			volumeName: string,
			onProgress?: (line: string) => void,
		): Promise<void> {
			const docker = this.getDocker(params.remote);
			const helper = `${BUILDER_HELPER_IMAGE}:${BUILDER_HELPER_TAG}`;
			try {
				await docker.getImage(helper).inspect();
			} catch {
				onProgress?.(`Pulling ${helper}...`);
				const pullStream: NodeJS.ReadableStream = await docker.pull(helper, {});
				await new Promise<void>((resolvePromise, reject) => {
					docker.modem.followProgress(pullStream, (err) =>
						err ? reject(err) : resolvePromise(),
					);
				});
			}
			const env = builderEnv({
				bakeFile: params.bakeFile,
				bakeTarget: params.bakeTarget,
				buildContext: params.buildContext,
				cacheRegistry: params.cacheRegistry,
				dockerfilePath: params.dockerfilePath,
				method,
				repoDir: REPO_DIR,
				tag: params.tag,
			});
			onProgress?.(`Building with ${method}...`);
			const container = await docker.createContainer({
				Cmd: ["-c", BUILDER_SCRIPT],
				Entrypoint: ["sh"],
				Env: env,
				HostConfig: {
					Binds: [
						`${volumeName}:${WORKSPACE}`,
						`${BUILDER_TOOLS_VOLUME}:/tools`,
						`${params.remote ? DOCKER_SOCKET : config.docker.socketPath}:${DOCKER_SOCKET}`,
					],
				},
				Image: helper,
				Labels: { [MANAGED_LABEL]: "true" },
				Tty: false,
			});
			const recentLines: string[] = [];
			const lines = createLineSplitter((line) => {
				recentLines.push(line);
				if (recentLines.length > RECENT_LINE_LIMIT) {
					recentLines.shift();
				}
				onProgress?.(line);
			});
			const output = new PassThrough();
			output.on("data", (chunk: Buffer) => lines.push(chunk.toString("utf8")));
			const raw = (await container.attach({
				stderr: true,
				stdout: true,
				stream: true,
			})) as unknown as Readable & { destroy: () => void };
			docker.modem.demuxStream(raw, output, output);
			const streamDone = new Promise<void>((resolvePromise) => {
				raw.on("end", resolvePromise);
				raw.on("close", resolvePromise);
			});
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				container.kill().catch(ignoreCleanupFailure);
			}, BUILDER_TIMEOUT_MS);
			try {
				await container.start();
				const result = (await container.wait()) as { StatusCode: number };
				await streamDone;
				lines.flush();
				if (timedOut) {
					throw new Error(`The ${method} build timed out.`);
				}
				if (result.StatusCode !== 0) {
					throw new Error(
						buildFailureMessage(method, result.StatusCode, recentLines),
					);
				}
			} finally {
				clearTimeout(timer);
				raw.destroy();
				await container.remove({ force: true }).catch(ignoreCleanupFailure);
			}
		}

		/**
		 * Runs the full git-based build pipeline for a service: creates a
		 * scratch Docker volume, ensures the git helper image, clones the
		 * repo (checking out a pinned commit if the branch has since moved),
		 * builds it with the configured build method into `params.tag`
		 * (see `#runBuilder`), and always removes the scratch volume.
		 * Reports progress via `onProgress`.
		 *
		 * Never throws: build failures are caught and returned as
		 * `{ success: false, error }` rather than propagated.
		 */
		async buildFromGit(
			params: GitBuildParams,
			onProgress?: (line: string) => void,
		): Promise<GitBuildResult> {
			const ref = params.gitRef || "main";
			const docker = this.getDocker(params.remote);
			const volumeName = `homerun-build-${crypto.randomUUID()}`;

			let commit: string | null = null;
			try {
				await docker.createVolume({
					Labels: { [MANAGED_LABEL]: "true" },
					Name: volumeName,
				});
				await this.#ensureGitImage(params.remote, onProgress);
				commit = await this.#cloneRepo(params, ref, volumeName, onProgress);
				await this.#runBuilder(
					params,
					params.buildMethod ?? "dockerfile",
					volumeName,
					onProgress,
				);
				logger.info(`Build succeeded: tag=${params.tag}`);
				return { commit, success: true };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.error(`Build failed: ${params.gitUrl}#${ref}`, err);
				return { error: redactCloneUrl(message), success: false };
			} finally {
				await docker.getVolume(volumeName).remove().catch(ignoreCleanupFailure);
			}
		}
	};
}
