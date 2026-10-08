import type { JobDTO } from "#lib/dto/job-dto.js";
import type { CoreServiceJob } from "./queue/payloads.ts";
import { QueueService } from "./queue.service.ts";

const titles: Record<CoreServiceJob["action"], string> = {
	disableBuiltinStore: "Turn off the built-in object store",
	enableBuiltinStore: "Turn on the built-in object store",
	publishBuiltinStore: "Publish the built-in object store",
	publishRegistry: "Publish the Docker registry",
	setRegistryAuth: "Change the Docker registry's auth",
};

/**
 * Queues a change to a core service (the built-in object store, the Docker
 * registry) instead of running it in the request: recreating a container and
 * waiting for it to answer takes a while. Changes to the same service run one
 * at a time, in order.
 */
export async function enqueueCoreServiceJob(
	payload: CoreServiceJob,
	userId: string,
): Promise<JobDTO> {
	const target = payload.action.includes("Registry")
		? "registry"
		: "object-storage";
	return await QueueService.enqueue({
		lockKey: `core_service:${target}`,
		maxAttempts: 1,
		payload,
		title: titles[payload.action],
		type: "core_service",
		userId,
	});
}
