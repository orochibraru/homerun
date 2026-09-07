import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Docker from "dockerode";
import { config } from "./config";
import type { BuildInput } from "./schemas";

const execFileAsync = promisify(execFile);

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

	getDocker(): Docker {
		if (!this.#docker) {
			this.#docker = new Docker({ socketPath: config.dockerSocketPath });
		}
		return this.#docker;
	}

	/** Ensures the shared network exists : mirrors the main app's `ensureProjectNetwork`, just one flat network here since an agent host has no notion of "projects". */
	/**
	 * Clones a git repo at a ref and builds its Dockerfile into a local
	 * image tagged `input.tag`, optionally pushing it to a registry
	 * afterward : see `buildInputSchema`'s docstring for the full picture
	 * (why no cache-from pull, when `push` matters). Mirrors the main app's
	 * `docker/git-build.ts`'s `buildFromGit`, this is a from-scratch,
	 * self-contained implementation (the agent has no access to the main
	 * app's source tree, same "keep the two in sync by hand" precedent as
	 * `deploy()`/`createAndStartContainer` already document).
	 */
	async buildFromGit(
		input: BuildInput,
		onProgress?: (line: string) => void,
	): Promise<{ error?: string; success: boolean }> {
		const ref = input.gitRef || "main";
		const dir = await mkdtemp(join(tmpdir(), "homerun-agent-build-"));
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

		try {
			push(`Cloning ${input.gitUrl} (${ref})...`);
			await execFileAsync("git", [
				"clone",
				"--depth",
				"1",
				"--branch",
				ref,
				"--single-branch",
				input.gitUrl,
				dir,
			]);

			const contextDir = input.buildContext
				? join(dir, input.buildContext)
				: dir;
			const dockerfile = input.dockerfilePath || "Dockerfile";

			push(`Building ${dockerfile}...`);
			const stream = await d.buildImage(
				{ context: contextDir, src: ["."] },
				{ dockerfile, rm: true, t: input.tag },
			);

			await new Promise<void>((resolvePromise, reject) => {
				let lastStatus = "";
				d.modem.followProgress(
					stream,
					(err: Error | null) => (err ? reject(err) : resolvePromise()),
					(event: { stream?: string; error?: string }) => {
						if (event.error) {
							reject(new Error(event.error));
							return;
						}
						const text = event.stream?.trim();
						if (text && text !== lastStatus) {
							lastStatus = text;
							push(text);
						}
					},
				);
			});

			if (input.push) {
				push(`Pushing to ${input.push.tag}...`);
				await this.#pushImage(input.tag, input.push);
			}

			return { success: true };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { error: message, success: false };
		} finally {
			await rm(dir, { force: true, recursive: true }).catch(() => {
				// Best-effort cleanup, same as the main app's own buildFromGit.
			});
		}
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
