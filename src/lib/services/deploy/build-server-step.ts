import {
	type BuildSlot,
	buildServerCandidates,
	pickBuildServer,
} from "#lib/build-servers.js";
import { reserveBuildHost } from "#lib/dto/build-slot-dto.js";
import type { DeploymentDTO } from "#lib/dto/deployment-dto.js";
import type { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import type { ServiceDTO } from "#lib/dto/service-dto.js";
import { isDeployCancelled } from "./status-check-step.ts";

export const BUILD_SLOT_POLL_MS = 5000;

interface BuildServerContext {
	dep: DeploymentDTO;
	jobId: string;
	settings: InstanceSettingsDTO;
	svc: ServiceDTO;
}

/**
 * Picks the build server a git build runs on and holds one of its build
 * slots for the deploy job until the job stops running: the pinned server,
 * or the least busy registered one when the service takes any free server
 * or the instance doesn't build on this host. While every candidate is at
 * its concurrent-build limit (its own, else the instance's), waits and logs
 * that it's waiting.
 *
 * @returns The reserved host id, or null to build on this host.
 * @throws When the deploy is cancelled while waiting for a slot.
 */
export async function acquireBuildServer(
	ctx: BuildServerContext,
): Promise<string | null> {
	const { dep, jobId, settings, svc } = ctx;
	const servers = await RemoteHostDTO.listBuildServers();
	const candidates = buildServerCandidates({
		buildOnHost: settings.buildOnHost,
		choice: {
			buildServerAny: svc.toJSON().buildServerAny,
			buildServerRemoteHostId: svc.buildServerRemoteHostId,
		},
		serverIds: servers.map((s) => s.id),
	});
	if (candidates.length === 0) {
		return null;
	}
	const limits = new Map(
		servers.map((s) => [
			s.id,
			s.maxConcurrentBuilds ?? settings.buildConcurrency,
		]),
	);
	const names = new Map(servers.map((s) => [s.id, s.name]));
	const reserve = () =>
		reserveBuildHost(jobId, (active) =>
			pickBuildServer(
				candidates.map(
					(id): BuildSlot => ({
						active: active.get(id) ?? 0,
						id,
						limit: limits.get(id) ?? settings.buildConcurrency,
					}),
				),
			),
		);
	let hostId = await reserve();
	if (!hostId) {
		await dep.appendLog(
			candidates.length === 1
				? `${names.get(candidates[0] ?? "") ?? "The build server"} is running as many builds as it's allowed, waiting for a free slot.`
				: "Every build server is running as many builds as it's allowed, waiting for a free slot.",
		);
	}
	while (!hostId) {
		// oxlint-disable-next-line no-await-in-loop -- polling until a slot frees
		if (await isDeployCancelled({ dep, svc })) {
			throw new Error(
				"The deploy was cancelled while waiting for a build slot.",
			);
		}
		// oxlint-disable-next-line no-await-in-loop -- polling until a slot frees
		await Bun.sleep(BUILD_SLOT_POLL_MS);
		// oxlint-disable-next-line no-await-in-loop -- each attempt has to see the slots the previous one found full
		hostId = await reserve();
	}
	await dep.appendLog(`Building on ${names.get(hostId) ?? "a build server"}.`);
	return hostId;
}
