import { fail } from "@sveltejs/kit";
import { Logger } from "$lib/logger";
import type { DockerCleanupAction } from "./queue/payloads.ts";
import { QueueService } from "./queue.service.ts";

const logger = new Logger("DockerCleanup");

const titles: Record<DockerCleanupAction, string> = {
	pruneBuildCache: "Prune build cache",
	pruneContainers: "Prune stopped containers",
	pruneImages: "Prune images",
	pruneNetworks: "Prune unused networks",
	pruneSystem: "Clean up Docker host",
	pruneVolumes: "Prune unused volumes",
};

const failureMessages: Record<DockerCleanupAction, string> = {
	pruneBuildCache: "Failed to prune build cache.",
	pruneContainers: "Failed to prune containers.",
	pruneImages: "Failed to prune images.",
	pruneNetworks: "Failed to prune networks.",
	pruneSystem: "Failed to run system prune.",
	pruneVolumes: "Failed to prune volumes.",
};

/**
 * Every prune runs as an `exclusive` queue job : a host-wide prune racing a
 * running build is how a just-pulled layer or a half-built image gets swept
 * out from under it. The queue holds the prune until nothing else is
 * running, and holds everything else back while it runs (see
 * JobDTO.claimNext). The caller still waits for the outcome, since the
 * Docker Cleanup page renders the reclaimed-space summary it returns.
 */
export async function runQueuedCleanup(
	action: DockerCleanupAction,
	all: boolean,
	userId: string,
) {
	const entry = await QueueService.enqueue({
		dedupeKey: `docker-cleanup:${action}`,
		exclusive: true,
		payload: { action, all },
		priority: 10,
		title: titles[action],
		type: "docker_cleanup",
		userId,
	});
	const finished = await QueueService.wait(entry.id);

	if (finished.status !== "succeeded") {
		logger.error(`${failureMessages[action]} job=${entry.id}`, finished.error);
		return fail(500, {
			action,
			error: finished.error ?? failureMessages[action],
		});
	}

	logger.info(`${action} run by user=${userId} job=${entry.id}`);
	return { action, result: finished.result, success: true };
}
