import { z } from "zod";
import { query } from "$app/server";
import { StackDTO } from "$lib/dto/stack-dto";
import { requireAdmin, requireUser } from "$lib/server/remote-auth";
import type { CleanupPreview } from "$lib/services/docker/cleanup";
import type {
	InfraContainer,
	TraefikInfo,
} from "$lib/services/docker/core-services";
import type { OrphanNetwork } from "$lib/services/docker/networks";
import { DockerService } from "$lib/services/docker.service";
import {
	ImageMirrorGcService,
	type MirrorUsage,
} from "$lib/services/image-mirror-gc.service";
import { RevisionService } from "$lib/services/revision.service";

export interface InfraStatus {
	infra: InfraContainer[];
	traefik: TraefikInfo | null;
}

export const getCleanupPreview = query(async (): Promise<CleanupPreview> => {
	requireAdmin();
	return await DockerService.getCleanupPreview(
		await RevisionService.retainedImageIds(),
	);
});

/** Stack networks the daemon still has but no stack row does : the leak Docker's own network prune can't see while anything is attached. */
export const getOrphanStackNetworks = query(
	async (): Promise<OrphanNetwork[]> => {
		requireAdmin();
		return await DockerService.findOrphanStackNetworks(await StackDTO.allIds());
	},
);

export const getMirrorUsage = query(async (): Promise<MirrorUsage> => {
	requireAdmin();
	return await ImageMirrorGcService.usage();
});

export const getInfraStatus = query(async (): Promise<InfraStatus> => {
	requireAdmin();
	const [traefik, infra] = await Promise.all([
		DockerService.findTraefikContainer(),
		DockerService.listInfraContainers().catch(() => []),
	]);
	return { infra, traefik };
});

export const getUnknownHostVolumes = query(
	z.array(z.string()),
	async (known): Promise<string[]> => {
		requireUser();
		const names = await DockerService.listHostVolumes().catch(
			() => [] as string[],
		);
		const seen = new Set(known);
		return names.filter((name) => !seen.has(name));
	},
);
