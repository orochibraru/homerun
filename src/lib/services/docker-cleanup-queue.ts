import type { JobDTO } from "#lib/dto/job-dto.js";
import { Logger } from "#lib/logger.js";
import type { DockerCleanupAction } from "./queue/payloads.ts";
import { QueueService } from "./queue.service.ts";

const logger = new Logger("DockerCleanup");

const titles: Record<DockerCleanupAction, string> = {
	pruneBuildCache: "Prune build cache",
	reclaimStackNetworks: "Reclaim orphaned stack networks",
	pruneContainers: "Prune stopped containers",
	pruneImages: "Prune images",
	pruneMirror: "Clean up the image mirror",
	pruneNetworks: "Prune unused networks",
	pruneSystem: "Clean up Docker host",
	pruneVolumes: "Prune unused volumes",
};

/**
 * Every prune runs as an `exclusive` queue job : a host-wide prune racing a
 * running build is how a just-pulled layer or a half-built image gets swept
 * out from under it. The queue holds the prune until nothing else is
 * running, and holds everything else back while it runs (see
 * JobDTO.claimNext).
 */
export function enqueueCleanup(
	action: DockerCleanupAction,
	all: boolean,
	userId: string,
): Promise<JobDTO> {
	return QueueService.enqueue({
		dedupeKey: `docker-cleanup:${action}`,
		exclusive: true,
		payload: { action, all },
		priority: 10,
		title: titles[action],
		type: "docker_cleanup",
		userId,
	});
}

/**
 * Queues a cleanup job and returns at once with its id, in a SvelteKit
 * action-shaped result: the cleanup runs in the background and its outcome
 * (what it reclaimed) is on the job's own page.
 */
export async function queueCleanup(
	action: DockerCleanupAction,
	all: boolean,
	userId: string,
) {
	const entry = await enqueueCleanup(action, all, userId);
	logger.info(`${action} queued by user=${userId} job=${entry.id}`);
	return { action, jobId: entry.id, success: true };
}
