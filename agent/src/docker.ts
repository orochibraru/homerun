import Docker from "dockerode";
import { config } from "./config";
import type { DeployInput } from "./schemas";

export type { DeployInput };

/** Same convention as the main app's docker/labels.ts — kept identical on purpose so both sides read the same way. */
export const MANAGED_LABEL = "homerun.managed";
export const SERVICE_ID_LABEL = "homerun.service.id";

let docker: Docker | null = null;

/** HMR isn't a concern here (this is a long-running standalone binary, not a dev server), but a lazy singleton still avoids reopening the socket per-request. */
export function getDocker(): Docker {
	if (!docker) {
		docker = new Docker({ socketPath: config.dockerSocketPath });
	}
	return docker;
}

export type PortProtocol = DeployInput["portProtocol"];
export type NetworkMode = DeployInput["networkMode"];

export interface DeployResult {
	containerId: string;
	log: string[];
}

/** Ensures the shared network exists — mirrors the main app's `ensureProjectNetwork`, just one flat network here since an agent host has no notion of "projects". */
export async function ensureNetwork(): Promise<void> {
	const d = getDocker();
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

function exposedPorts(
	port: number,
	protocol: PortProtocol,
): Record<string, object> {
	const protocols = protocol === "both" ? ["tcp", "udp"] : [protocol];
	const out: Record<string, object> = {};
	for (const p of protocols) {
		out[`${port}/${p}`] = {};
	}
	return out;
}

/** Finds the previous container for this serviceId by label, not by name (names carry a random suffix so a redeploy never collides) — same pattern as the main app's `findServiceContainer`. */
export async function findServiceContainer(
	serviceId: string,
): Promise<Docker.ContainerInfo | null> {
	const d = getDocker();
	const containers = await d.listContainers({
		all: true,
		filters: JSON.stringify({
			label: [`${MANAGED_LABEL}=true`, `${SERVICE_ID_LABEL}=${serviceId}`],
		}),
	});
	return containers[0] ?? null;
}

export async function listManagedContainers(): Promise<Docker.ContainerInfo[]> {
	const d = getDocker();
	return d.listContainers({
		all: true,
		filters: JSON.stringify({ label: [`${MANAGED_LABEL}=true`] }),
	});
}

async function pullImage(
	image: string,
	tag: string,
	auth?: DeployInput["registryAuth"] | null,
	log?: string[],
): Promise<void> {
	const d = getDocker();
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
					const line = event.id ? `${event.status} ${event.id}` : event.status;
					if (line && line !== lastStatus) {
						lastStatus = line;
						log?.push(line);
					}
				},
			);
		});
	});
}

/** Pull (if needed) → remove the previous container for this service → create → start. The one entry point the HTTP layer calls. */
export async function deploy(input: DeployInput): Promise<DeployResult> {
	const d = getDocker();
	const log: string[] = [];

	log.push(`Pulling ${input.image}:${input.tag}...`);
	await pullImage(input.image, input.tag, input.registryAuth, log);

	const previous = await findServiceContainer(input.serviceId);
	if (previous) {
		log.push(`Removing previous container ${previous.Id.slice(0, 12)}...`);
		const c = d.getContainer(previous.Id);
		await c.stop({ t: 10 }).catch(() => undefined);
		await c.remove({ force: true }).catch(() => undefined);
	}

	const isHost = input.networkMode === "host";
	const name = `homerun-agent-${input.slug}-${crypto.randomUUID().slice(0, 8)}`;

	log.push(`Creating ${name}...`);
	const container = await d.createContainer({
		Env: input.envVars.map((e) => `${e.key}=${e.value}`),
		ExposedPorts: input.containerPort
			? exposedPorts(input.containerPort, input.portProtocol)
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
		// Omitted entirely in host mode — see the main app's CLAUDE.md "Network
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
	log.push(`Started ${container.id.slice(0, 12)}.`);
	return { containerId: container.id, log };
}

export async function startContainer(id: string): Promise<void> {
	await getDocker().getContainer(id).start();
}

export async function stopContainer(id: string): Promise<void> {
	await getDocker().getContainer(id).stop({ t: 10 });
}

export async function restartContainer(id: string): Promise<void> {
	await getDocker().getContainer(id).restart({ t: 10 });
}

export async function removeContainer(id: string): Promise<void> {
	const c = getDocker().getContainer(id);
	await c.stop({ t: 10 }).catch(() => undefined);
	await c.remove({ force: true });
}

export interface ContainerStatus {
	id: string;
	state: string;
	status: string;
}

export async function inspectStatus(id: string): Promise<ContainerStatus> {
	const info = await getDocker().getContainer(id).inspect();
	return {
		id: info.Id,
		state: info.State.Status,
		status: info.State.Running ? "running" : info.State.Status,
	};
}

/** A ReadableStream of raw log chunks — the HTTP route pipes this straight through as the response body, same shape as the main app's `streamLogs`. */
export async function streamLogs(
	id: string,
	follow: boolean,
): Promise<ReadableStream<Uint8Array>> {
	const container = getDocker().getContainer(id);

	if (!follow) {
		// The non-follow overload resolves a plain Buffer, not a stream —
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
	return new ReadableStream<Uint8Array>({
		cancel() {
			// @ts-expect-error — dockerode's stream is a duplex; destroy exists at runtime even if not in its types.
			dockerStream.destroy?.();
		},
		start(controller) {
			dockerStream.on("data", (chunk: Buffer) =>
				controller.enqueue(new Uint8Array(chunk)),
			);
			dockerStream.on("end", () => controller.close());
			dockerStream.on("error", (err: Error) => controller.error(err));
		},
	});
}
