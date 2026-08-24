import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import type { ContainerStatus } from "$lib/types";
import { AgentClientService } from "./agent-client.service.ts";
import { DockerService } from "./docker.service.ts";

/**
 * The one place every already-deployed service's start/stop/restart/
 * remove/logs routes through, docker (local or remote) *or* agent alike :
 * resolves `RemoteHostDTO.resolveTarget(remoteHostId, userId)` and branches
 * to `DockerService` or `AgentClientService` accordingly, so none of the
 * ~10 call sites (Overview page actions, REST API service actions, the
 * Settings danger-zone delete, the Logs tab) have to know which one a given
 * service actually needs. Deploying (create+start, or build) is a bigger
 * pipeline with its own state (deployment rows, git builds, swarm) and
 * stays in `deploy.service.ts`, this is only for a service that's already
 * running somewhere.
 */
class ServiceLifecycleServiceClass {
	async start(
		containerId: string,
		remoteHostId: string | null,
		userId: string,
	): Promise<void> {
		const target = await RemoteHostDTO.resolveTarget(remoteHostId, userId);
		if (target.kind === "agent") {
			await AgentClientService.startContainer(target.connection, containerId);
			return;
		}
		await DockerService.startContainer(
			containerId,
			target.kind === "docker" ? target.connection : undefined,
		);
	}

	async stop(
		containerId: string,
		remoteHostId: string | null,
		userId: string,
	): Promise<void> {
		const target = await RemoteHostDTO.resolveTarget(remoteHostId, userId);
		if (target.kind === "agent") {
			await AgentClientService.stopContainer(target.connection, containerId);
			return;
		}
		await DockerService.stopContainer(
			containerId,
			target.kind === "docker" ? target.connection : undefined,
		);
	}

	async restart(
		containerId: string,
		remoteHostId: string | null,
		userId: string,
	): Promise<void> {
		const target = await RemoteHostDTO.resolveTarget(remoteHostId, userId);
		if (target.kind === "agent") {
			await AgentClientService.restartContainer(target.connection, containerId);
			return;
		}
		await DockerService.restartContainer(
			containerId,
			target.kind === "docker" ? target.connection : undefined,
		);
	}

	/** Always force-removes, same as every existing call site already did (and the agent's own removeContainer, which has no non-force mode). */
	async remove(
		containerId: string,
		remoteHostId: string | null,
		userId: string,
	): Promise<void> {
		const target = await RemoteHostDTO.resolveTarget(remoteHostId, userId);
		if (target.kind === "agent") {
			await AgentClientService.removeContainer(target.connection, containerId);
			return;
		}
		await DockerService.removeContainer(
			containerId,
			{ force: true },
			target.kind === "docker" ? target.connection : undefined,
		);
	}

	async status(
		containerId: string,
		remoteHostId: string | null,
		userId: string,
	): Promise<ContainerStatus> {
		const target = await RemoteHostDTO.resolveTarget(remoteHostId, userId);
		if (target.kind === "agent") {
			return AgentClientService.inspectStatus(target.connection, containerId);
		}
		return DockerService.inspectStatus(
			containerId,
			target.kind === "docker" ? target.connection : undefined,
		);
	}

	/** Always follow-mode : the only shape this app actually uses (see `docker/containers.ts`'s `streamLogs` and its one call site, the Logs tab's `+server.ts`). */
	async streamLogs(
		containerId: string,
		remoteHostId: string | null,
		userId: string,
	): Promise<ReadableStream<Uint8Array>> {
		const target = await RemoteHostDTO.resolveTarget(remoteHostId, userId);
		if (target.kind === "agent") {
			return AgentClientService.streamLogs(
				target.connection,
				containerId,
				true,
			);
		}
		return DockerService.streamLogs(
			containerId,
			{ follow: true, tail: 200 },
			target.kind === "docker" ? target.connection : undefined,
		);
	}
}

export const ServiceLifecycleService = new ServiceLifecycleServiceClass();
