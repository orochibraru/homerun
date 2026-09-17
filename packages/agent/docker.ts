import type { Readable } from "node:stream";
import Docker from "dockerode";
import { runBuilder } from "./builders";
import { config } from "./config";
import type { BuildInput } from "./schemas";

/**
 * Cloning runs in this image rather than shelling out to `git` : the agent's
 * own image is `alpine:3` plus a handful of libraries and has no git binary,
 * so the old `execFile("git", ...)` failed with ENOENT on every git build.
 * Mirrors the main app's `docker/git-build.ts`, which hit the same wall.
 */
const GIT_IMAGE = "alpine/git:latest";
const WORKSPACE = "/workspace";
const REPO_DIR = `${WORKSPACE}/repo`;
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

/** Injects a credential into an https clone URL, same rules as the main app's `authenticatedCloneUrl` (hand-mirrored, the agent can't import from src/). */
export function authenticatedCloneUrl(
	gitUrl: string,
	credential: { token: string; username: string } | null | undefined,
): string {
	if (!credential) {
		return gitUrl;
	}
	let url: URL;
	try {
		url = new URL(gitUrl);
	} catch {
		return gitUrl;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return gitUrl;
	}
	if (url.username !== "" || url.password !== "") {
		return gitUrl;
	}
	url.username = encodeURIComponent(credential.username);
	url.password = encodeURIComponent(credential.token);
	return url.toString();
}

/** Whether a ref is a full 40-character commit SHA, same rule as the main app's `$lib/git-ref.ts` `isCommitSha` (hand-mirrored). */
export function isCommitSha(ref: string | null | undefined): boolean {
	return !!ref && /^[0-9a-f]{40}$/i.test(ref.trim());
}

/**
 * The `git` argv lists that check `ref` of `cloneUrl` out into `repoDir`,
 * hand-mirrored from the main app's `$lib/git-ref.ts` `gitCheckoutSteps`: a
 * shallow single-branch clone for a branch or tag, an init plus a shallow
 * fetch and detached checkout for a commit SHA.
 */
export function gitCheckoutSteps(
	cloneUrl: string,
	ref: string,
	repoDir: string,
): string[][] {
	if (!isCommitSha(ref)) {
		return [
			[
				"clone",
				"--depth",
				"1",
				"--branch",
				ref,
				"--single-branch",
				cloneUrl,
				repoDir,
			],
		];
	}
	const sha = ref.trim().toLowerCase();
	return [
		["init", "--quiet", repoDir],
		["-C", repoDir, "remote", "add", "origin", cloneUrl],
		["-C", repoDir, "fetch", "--depth", "1", "origin", sha],
		["-C", repoDir, "checkout", "--detach", "FETCH_HEAD"],
	];
}

/** The first full commit SHA in a git command's output, e.g. `rev-parse HEAD`, or null. */
export function extractCommitSha(output: string): string | null {
	return /\b[0-9a-f]{40}\b/.exec(output)?.[0] ?? null;
}

/** Strips any credential back out before a URL reaches a log line. */
export function redactCloneUrl(gitUrl: string): string {
	try {
		const url = new URL(gitUrl);
		if (url.username === "" && url.password === "") {
			return gitUrl;
		}
		url.username = "";
		url.password = "";
		return url.toString();
	} catch {
		return gitUrl;
	}
}

/** Same convention as the main app's docker/labels.ts : kept identical on purpose so both sides read the same way. */
export const MANAGED_LABEL = "homerun.managed";
export const SERVICE_ID_LABEL = "homerun.service.id";

/** Build progress goes to this process's own console/journal, not only into the HTTP response. */
function logLine(prefix: string, line: string): void {
	console.log(`[${prefix}] ${line}`);
}

/**
 * Real instance state (the lazily-opened dockerode client), not a static
 * barrel : same "plain instance singleton" shape as the main app's
 * `AdminService`/`SystemStatsService`/etc. (see CLAUDE.md's OOP convention
 * note). HMR isn't a concern here (this is a long-running standalone binary,
 * not a dev server), but a lazy singleton still avoids reopening the socket
 * per-request.
 */
class AgentDockerService {
	#docker: Docker | null = null;

	/** Returns the dockerode client for the configured socket, opening it on first use and reusing it afterwards. */
	getDocker(): Docker {
		if (!this.#docker) {
			this.#docker = new Docker({ socketPath: config.dockerSocketPath });
		}
		return this.#docker;
	}

	/**
	 * Pulls the `alpine/git` image the clone runs in, unless it's already
	 * present locally.
	 *
	 * @param push Progress sink, told when a pull actually starts.
	 * @throws When the pull fails.
	 */
	async #ensureGitImage(push: (line: string) => void): Promise<void> {
		const d = this.getDocker();
		try {
			await d.getImage(GIT_IMAGE).inspect();
			return;
		} catch {
			push(`Pulling ${GIT_IMAGE}...`);
		}
		const stream: NodeJS.ReadableStream = await d.pull(GIT_IMAGE, {});
		await new Promise<void>((resolvePromise, reject) => {
			d.modem.followProgress(stream, (err) =>
				err ? reject(err) : resolvePromise(),
			);
		});
	}

	/**
	 * Runs a one-off `git` container with the build volume mounted at the
	 * workspace, waits for it (bounded by the clone timeout) and always removes
	 * it afterwards.
	 *
	 * @param opts.cmd Arguments passed to the `git` entrypoint.
	 * @returns The container's combined stdout/stderr and its exit code.
	 * @throws When the command exceeds the clone timeout.
	 */
	async #runInWorkspace(opts: {
		cmd: string[];
		volumeName: string;
	}): Promise<{ output: string; statusCode: number }> {
		const d = this.getDocker();
		const container = await d.createContainer({
			Cmd: opts.cmd,
			Entrypoint: ["git"],
			Env: ["GIT_TERMINAL_PROMPT=0"],
			HostConfig: { Binds: [`${opts.volumeName}:${WORKSPACE}`] },
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
				output: logs.toString("utf8"),
				statusCode: result.StatusCode,
			};
		} finally {
			await container.remove({ force: true }).catch(() => {
				// Best-effort cleanup, same as the main app's own git build.
			});
		}
	}

	/**
	 * Checks `ref` out into the workspace volume (see `gitCheckoutSteps`),
	 * then pins it to `commit` when one was given and the branch has moved
	 * past it: the main app sends the commit whose required status checks
	 * passed, so the build is that commit or it fails.
	 *
	 * @returns The commit that will be built, null when git didn't report one.
	 * @throws When a clone, fetch or checkout step fails.
	 */
	async #checkout(
		checkout: {
			cloneUrl: string;
			commit: string | null | undefined;
			ref: string;
			volumeName: string;
		},
		push: (line: string) => void,
	): Promise<string | null> {
		const { cloneUrl, commit, ref, volumeName } = checkout;
		await this.#runSteps(gitCheckoutSteps(cloneUrl, ref, REPO_DIR), volumeName);
		const rev = await this.#runInWorkspace({
			cmd: ["-C", REPO_DIR, "rev-parse", "HEAD"],
			volumeName,
		}).catch(() => null);
		const head = rev?.statusCode === 0 ? extractCommitSha(rev.output) : null;
		const pinned = commit?.toLowerCase() ?? null;
		if (pinned && head !== pinned) {
			push(
				`The branch moved since its status checks were read, checking out the checked commit ${pinned.slice(0, 7)}...`,
			);
			await this.#runSteps(
				[
					["-C", REPO_DIR, "fetch", "--depth", "1", "origin", pinned],
					["-C", REPO_DIR, "checkout", "--detach", pinned],
				],
				volumeName,
			);
		}
		const built = pinned ?? head;
		if (built) {
			push(`Building commit ${built.slice(0, 7)}`);
		}
		return built;
	}

	/**
	 * Runs git steps in order in the workspace volume, stopping at the first
	 * that fails.
	 *
	 * @throws With the failing step's redacted output.
	 */
	async #runSteps(steps: string[][], volumeName: string): Promise<void> {
		for (const cmd of steps) {
			// biome-ignore lint/performance/noAwaitInLoops: each git step works on the previous one's checkout
			const step = await this.#runInWorkspace({ cmd, volumeName });
			if (step.statusCode !== 0) {
				throw new Error(
					redactCloneUrl(step.output || `git exited ${step.statusCode}`),
				);
			}
		}
	}

	/**
	 * Clones a git repo at a ref and builds it with BuildKit (or the
	 * configured builder) into a local image tagged `input.tag`, using and
	 * refreshing the registry layer cache and pushing the image to that
	 * registry afterward when `input.push` is set : see `buildInputSchema`'s
	 * docstring for when that matters. Mirrors the main app's
	 * `docker/git-build.ts`'s `buildFromGit`, this is a from-scratch,
	 * self-contained implementation (the agent has no access to the main
	 * app's source tree, same "keep the two in sync by hand" precedent as
	 * `deploy()`/`createAndStartContainer` already document), including its
	 * clone-in-a-container-into-a-volume shape : the agent image has no git
	 * binary of its own.
	 */
	async buildFromGit(
		input: BuildInput,
		onProgress?: (line: string) => void,
	): Promise<{ commit?: string | null; error?: string; success: boolean }> {
		const ref = input.gitRef || "main";
		const d = this.getDocker();
		// Always logs to this process's own console, regardless of whether a
		// caller passed onProgress (http.ts's /v1/build route currently
		// doesn't, since the response has no log field to collect one into,
		// unlike deploy()) : a build in progress was otherwise completely
		// invisible from the agent's own console/journal, same gap deploy()
		// had, see logLine's own docstring.
		const prefix = `build ${input.tag}`;
		const push = (line: string) => {
			logLine(prefix, line);
			onProgress?.(line);
		};

		const volumeName = `homerun-agent-build-${crypto.randomUUID().slice(0, 8)}`;
		let commit: string | null = null;

		try {
			await this.#ensureGitImage(push);
			await d.createVolume({
				Labels: { [MANAGED_LABEL]: "true" },
				Name: volumeName,
			});

			const cloneUrl = authenticatedCloneUrl(input.gitUrl, input.credential);
			push(`Cloning ${redactCloneUrl(cloneUrl)} (${ref})...`);
			commit = await this.#checkout(
				{ cloneUrl, commit: input.commit, ref, volumeName },
				push,
			);

			await runBuilder({
				bakeFile: input.bakeFile,
				bakeTarget: input.bakeTarget,
				buildContext: input.buildContext,
				cacheRegistry: input.push
					? {
							password: input.push.password,
							registryUrl: input.push.registryUrl,
							username: input.push.username,
						}
					: null,
				dockerfilePath: input.dockerfilePath,
				docker: d,
				method: input.buildMethod ?? "dockerfile",
				push,
				repoDir: REPO_DIR,
				socketPath: config.dockerSocketPath,
				tag: input.tag,
				volumeName,
				workspace: WORKSPACE,
			});

			if (input.push) {
				push(`Pushing to ${input.push.tag}...`);
				await this.#pushImage(input.tag, input.push);
			}

			return { commit, success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { commit, error: redactCloneUrl(message), success: false };
		} finally {
			await d
				.getVolume(volumeName)
				.remove({ force: true })
				.catch(() => {
					// Best-effort cleanup, same as the main app's own buildFromGit.
				});
		}
	}

	/**
	 * Opens a `docker save` tarball stream of a local image, for the main app
	 * to load onto its own daemon when a build has no cache registry to
	 * publish through.
	 *
	 * @returns null when the image doesn't exist on this daemon.
	 */
	async saveImage(ref: string): Promise<Readable | null> {
		const image = this.getDocker().getImage(ref);
		try {
			await image.inspect();
		} catch {
			return null;
		}
		logLine("save", ref);
		return (await image.get()) as unknown as Readable;
	}

	/** Same repo/tag splitting and tag-then-push shape as the main app's `docker/containers.ts`'s `pushImage`, kept in sync by hand (see `buildFromGit`'s docstring). */
	async #pushImage(
		localTag: string,
		push: NonNullable<BuildInput["push"]>,
	): Promise<void> {
		const d = this.getDocker();
		const lastColon = push.tag.lastIndexOf(":");
		const lastSlash = push.tag.lastIndexOf("/");
		const [repo, tag] =
			lastColon === -1 || lastColon < lastSlash
				? [push.tag, "latest"]
				: [push.tag.slice(0, lastColon), push.tag.slice(lastColon + 1)];

		await d.getImage(localTag).tag({ repo, tag });
		const authconfig = {
			password: push.password,
			serveraddress: push.registryUrl,
			username: push.username,
		};
		const stream = await d.getImage(`${repo}:${tag}`).push({ authconfig, tag });
		await new Promise<void>((resolvePromise, reject) => {
			d.modem.followProgress(stream, (err: Error | null) =>
				err ? reject(err) : resolvePromise(),
			);
		});
	}
}

export const DockerService = new AgentDockerService();
