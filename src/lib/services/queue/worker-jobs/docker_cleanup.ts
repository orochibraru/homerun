import type { JobDTO } from "$lib/dto/job-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { STACK_NETWORK_PREFIX } from "../../docker/networks.ts";
import { ImageMirrorGcService } from "../../image-mirror-gc.service.ts";
import { RevisionService } from "../../revision.service.ts";
import {
	type DockerCleanupAction,
	dockerCleanupJobPayload,
} from "../payloads.ts";
import type { WorkerJob } from "./types.ts";

/** The retention lists and targets one cleanup action needs, resolved from the database and app settings. */
async function actionSpec(
	action: DockerCleanupAction,
): Promise<Record<string, unknown>> {
	switch (action) {
		case "pruneImages":
		case "pruneSystem":
			return { keepImageIds: await RevisionService.retainedImageIds() };
		case "pruneVolumes":
			return {
				keepVolumeNames: await ServiceVolumeDTO.mountedVolumeNames(),
			};
		case "reclaimStackNetworks":
			return {
				liveStackIds: [...(await StackDTO.allIds())],
				stackNetworkPrefix: STACK_NETWORK_PREFIX,
			};
		case "pruneMirror":
			return { mirror: await ImageMirrorGcService.spec() };
		default:
			return {};
	}
}

export const dockerCleanupWorkerJob: WorkerJob | null = {
	/** Passes the executor's summary through as the job result, or fails the job with the executor's error. */
	finalize: (_job, result, error) => {
		if (error !== null) {
			return Promise.reject(new Error(error));
		}
		return Promise.resolve(result);
	},
	/** Resolves the action and its retention lists (retained revision images, mounted volumes, live stacks, the mirror keep set) for the Go executor. */
	prepare: async (job: JobDTO) => {
		const { action, all } = dockerCleanupJobPayload.parse(job.payload);
		return { action, all, ...(await actionSpec(action)) };
	},
};
