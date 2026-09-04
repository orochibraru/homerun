import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Docker from "dockerode";
import { config } from "./config";
import type { BuildInput, DeployInput } from "./schemas";

export type { DeployInput };

const execFileAsync = promisify(execFile);

/** Same convention as the main app's docker/labels.ts : kept identical on purpose so both sides read the same way. */
export const MANAGED_LABEL = "homerun.managed";
export const SERVICE_ID_LABEL = "homerun.service.id";

export type PortProtocol = DeployInput["portProtocol"];
export type NetworkMode = DeployInput["networkMode"];

export interface DeployResult {
	containerId: string;
	log: string[];
}

/**
 * Every operation's progress lines used to only ever accumulate into the
 * array/callback the HTTP response eventually returns, never printed
 * anywhere : a deploy or build in progress was completely invisible from
 * the agent's own console/journal, real gap this closes (see the same
 * prefix convention `console.log`s in `index.ts`'s boot banner use).
 */
function logLine(prefix: string, line: string): void {
	console.log(`[${prefix}] ${line}`);
}

export class ContainerNotFoundError extends Error {}

export interface ContainerStatus {
	id: string;
	// The container's exit code when it isn't running, null while running :
	// the main app's own ContainerStatus enum needs this to tell a clean
	// stop apart from a crash (see agent-client.service.ts's inspectStatus).
	exitCode: number | null;
	state: string;
	status: string;
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
	async ensureNetwork(): Promise<void> {
		const d = this.getDocker();
		const networks = await d.listNetworks({
			filters: JSON.stringify({ name: [config.dockerNetworkName] }),
		});
		if (networks.some((n) => n.Name === config.dockerNetworkName)) {
			return;
		}
		await d.createNetwork({
			CheckDuplicate: true,
			Name: config.dockerNetworkName,
		});
	}

	/** Finds the previous container for this serviceId by label, not by name (names carry a random suffix so a redeploy never collides) : same pattern as the main app's `findServiceContainer`. */
	async findServiceContainer(
		serviceId: string,
	): Promise<Docker.ContainerInfo | null> {
		const d = this.getDocker();
		const containers = await d.listContainers({
			all: true,
			filters: JSON.stringify({
				label: [`${MANAGED_LABEL}=true`, `${SERVICE_ID_LABEL}=${serviceId}`],
			}),
		});
		return containers[0] ?? null;
	}

	listManagedContainers(): Promise<Docker.ContainerInfo[]> {
		const d = this.getDocker();
		return d.listContainers({
			all: true,
			filters: JSON.stringify({ label: [`${MANAGED_LABEL}=true`] }),
		});
	}

	/** Pull (if needed) → remove the previous container for this service → create → start. The one entry point the HTTP layer calls. */
	async deploy(input: DeployInput): Promise<DeployResult> {
		const d = this.getDocker();
		const log: string[] = [];
		const prefix = `deploy ${input.slug}`;
		const push = (line: string) => {
			log.push(line);
			logLine(prefix, line);
		};

		if (input.skipPull) {
			push(`Using local image ${input.image}:${input.tag} (just built).`);
		} else {
			push(`Pulling ${input.image}:${input.tag}...`);
			await this.#pullImage(input.image, input.tag, input.registryAuth, push);
		}

		const previous = await this.findServiceContainer(input.serviceId);
		if (previous) {
			push(`Removing previous container ${previous.Id.slice(0, 12)}...`);
			const c = d.getContainer(previous.Id);
			await c.stop({ t: 10 }).catch(() => undefined);
			await c.remove({ force: true }).catch(() => undefined);
		}

		const isHost = input.networkMode === "host";
		const name = `homerun-agent-${input.slug}-${crypto.randomUUID().slice(0, 8)}`;

		push(`Creating ${name}...`);
		const container = await d.createContainer({
			Env: input.envVars.map((e) => `${e.key}=${e.value}`),
			ExposedPorts: input.containerPort
				? this.#exposedPorts(input.containerPort, input.portProtocol)
				: undefined,
			HostConfig: {
				Memory: input.memoryLimitMb
					? input.memoryLimitMb * 1024 * 1024
					: undefined,
				NanoCpus: input.cpuLimit
					? Math.round(input.cpuLimit * 1_000_000_000)
					: undefined,
				NetworkMode: isHost ? "host" : config.dockerNetworkName,
				RestartPolicy: { Name: input.restartPolicy },
			},
			Image: `${input.image}:${input.tag}`,
			Labels: {
				[MANAGED_LABEL]: "true",
				[SERVICE_ID_LABEL]: input.serviceId,
				"homerun.agent": "true",
			},
			// Omitted entirely in host mode : see the main app's CLAUDE.md "Network
			// mode" section for why: combining NetworkMode:"host" with an explicit
			// NetworkingConfig doesn't error, it silently attaches to the named
			// network instead of real host networking. Verified there; assumed to
			// hold here too since it's the same Docker API/daemon behavior.
			NetworkingConfig: isHost
				? undefined
				: {
						EndpointsConfig: {
							[config.dockerNetworkName]: { Aliases: [input.slug] },
						},
					},
			name,
		});

		await container.start();
		push(`Started ${container.id.slice(0, 12)}.`);
		return { containerId: container.id, log };
	}

	async startContainer(id: string): Promise<void> {
		await this.getDocker().getContainer(id).start();
		logLine("containers", `Started ${id.slice(0, 12)}.`);
	}

	async stopContainer(id: string): Promise<void> {
		await this.getDocker().getContainer(id).stop({ t: 10 });
		logLine("containers", `Stopped ${id.slice(0, 12)}.`);
	}

	async restartContainer(id: string): Promise<void> {
		await this.getDocker().getContainer(id).restart({ t: 10 });
		logLine("containers", `Restarted ${id.slice(0, 12)}.`);
	}

	async removeContainer(id: string): Promise<void> {
		const c = this.getDocker().getContainer(id);
		await c.stop({ t: 10 }).catch(() => undefined);
		await c.remove({ force: true });
		logLine("containers", `Removed ${id.slice(0, 12)}.`);
	}

	async inspectStatus(id: string): Promise<ContainerStatus> {
		let info: Awaited<ReturnType<Docker.Container["inspect"]>>;
		try {
			info = await this.getDocker().getContainer(id).inspect();
		} catch (error) {
			if ((error as { statusCode?: number } | null)?.statusCode === 404) {
				throw new ContainerNotFoundError(`No such container: ${id}`);
			}
			throw error;
		}
		return {
			exitCode: info.State.Running ? null : info.State.ExitCode,
			id: info.Id,
			state: info.State.Status,
			status: info.State.Running ? "running" : info.State.Status,
		};
	}

	/** A ReadableStream of raw log chunks : the HTTP route pipes this straight through as the response body, same shape as the main app's `streamLogs`. */
	async streamLogs(
		id: string,
		follow: boolean,
	): Promise<ReadableStream<Uint8Array>> {
		const container = this.getDocker().getContainer(id);

		if (!follow) {
			// The non-follow overload resolves a plain Buffer, not a stream :
			// wrap it in a single-chunk ReadableStream so callers get one shape
			// regardless of `follow`.
			const buffer = await container.logs({
				follow: false,
				stderr: true,
				stdout: true,
				tail: 200,
			});
			return new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array(buffer));
					controller.close();
				},
			});
		}

		const dockerStream = await container.logs({
			follow: true,
			stderr: true,
			stdout: true,
			tail: 200,
		});
		// Real, tested-in-review finding : the stream ending naturally (the
		// container's own `end` event, e.g. it stopped) and `cancel()` being
		// invoked by Bun's own Response-body cleanup can both fire for the
		// same request (verified live : a real "GET .../logs" that already
		// returned 200 still triggered `cancel()` afterward). Destroying the
		// underlying duplex socket a second time throws deep in Bun's
		// Node-compat socket layer ("Invalid state: Reader released",
		// node:net's closeSocketHandle) : uncaught, since it happens inside
		// a stream-teardown callback with nothing above it to catch it,
		// which crashed the whole agent process, not just this one request.
		// `ended` skips the redundant destroy, and the try/catch is defense
		// in depth against any other ordering this Bun-runtime quirk can hit
		// (matches this app's own precedent for a load-bearing but
		// undocumented Bun socket behavior, see the main app's Terminal
		// feature).
		let ended = false;
		return new ReadableStream<Uint8Array>({
			cancel() {
				if (ended) {
					return;
				}
				try {
					// @ts-expect-error : dockerode's stream is a duplex; destroy exists at runtime even if not in its types.
					dockerStream.destroy?.();
				} catch (err) {
					console.warn(
						`[containers] Couldn't cleanly cancel a log stream for ${id.slice(0, 12)}`,
						err,
					);
				}
			},
			start(controller) {
				dockerStream.on("data", (chunk: Buffer) =>
					controller.enqueue(new Uint8Array(chunk)),
				);
				dockerStream.on("end", () => {
					ended = true;
					controller.close();
				});
				dockerStream.on("error", (err: Error) => {
					ended = true;
					controller.error(err);
				});
			},
		});
	}

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

	#exposedPorts(port: number, protocol: PortProtocol): Record<string, object> {
		const protocols = protocol === "both" ? ["tcp", "udp"] : [protocol];
		const out: Record<string, object> = {};
		for (const p of protocols) {
			out[`${port}/${p}`] = {};
		}
		return out;
	}

	async #pullImage(
		image: string,
		tag: string,
		auth?: DeployInput["registryAuth"] | null,
		onLine?: (line: string) => void,
	): Promise<void> {
		const d = this.getDocker();
		const ref = `${image}:${tag}`;
		await new Promise<void>((resolve, reject) => {
			d.pull(ref, { authconfig: auth ?? undefined }, (err, stream) => {
				if (err || !stream) {
					reject(err ?? new Error("pull failed: no stream"));
					return;
				}
				let lastStatus = "";
				d.modem.followProgress(
					stream,
					(finalErr) => (finalErr ? reject(finalErr) : resolve()),
					(event: { status?: string; id?: string }) => {
						const line = event.id
							? `${event.status} ${event.id}`
							: event.status;
						if (line && line !== lastStatus) {
							lastStatus = line;
							onLine?.(line);
						}
					},
				);
			});
		});
	}
}

export const DockerService = new AgentDockerService();
