import { JobDTO } from "#lib/dto/job-dto.js";
import type { JobType } from "#lib/types.js";
import { NotificationChannelService } from "../notification-channel.service.ts";
import { ObjectStorageService } from "../object-storage.service.ts";
import { RegistryService } from "../registry.service.ts";
import {
	type CoreServiceJob,
	coreServiceJobPayload,
	notificationDeliveryJobPayload,
} from "./payloads.ts";

export type JobResult = Record<string, unknown> | null;
type JobHandler = (job: JobDTO) => Promise<JobResult>;

async function runNotificationDelivery(entry: JobDTO): Promise<JobResult> {
	const { channelId, message } = notificationDeliveryJobPayload.parse(
		entry.payload,
	);
	return await NotificationChannelService.retryDelivery(channelId, message);
}

const coreServiceSteps: Record<
	CoreServiceJob["action"],
	{ done: string; start: string }
> = {
	disableBuiltinStore: {
		done: "Built-in object store stopped. Its volumes are kept.",
		start: "Stopping the built-in object store's container.",
	},
	enableBuiltinStore: {
		done: "Built-in object store is up.",
		start: "Starting the built-in object store and waiting for it to answer.",
	},
	publishBuiltinStore: {
		done: "Built-in object store reconfigured.",
		start: "Reconfiguring the built-in object store's Traefik route.",
	},
	publishRegistry: {
		done: "Docker registry reconfigured.",
		start: "Reconfiguring the Docker registry's Traefik route.",
	},
	setRegistryAuth: {
		done: "Docker registry auth updated.",
		start: "Rewriting the registry's credentials and recreating its container.",
	},
};

/** Runs one core service change (the built-in object store, the Docker registry), logging its start and end to the job. */
async function runCoreService(entry: JobDTO): Promise<JobResult> {
	const payload = coreServiceJobPayload.parse(entry.payload);
	const steps = coreServiceSteps[payload.action];
	await JobDTO.appendLog(entry.id, steps.start);
	switch (payload.action) {
		case "enableBuiltinStore":
			await ObjectStorageService.enableBuiltin(payload.userId);
			break;
		case "disableBuiltinStore":
			await ObjectStorageService.disableBuiltin();
			break;
		case "publishBuiltinStore":
			await ObjectStorageService.setBuiltinPublicHost(payload.host);
			break;
		case "setRegistryAuth":
			await RegistryService.setAuthEnabled(payload.enabled);
			break;
		case "publishRegistry":
			await RegistryService.setPublicHost(payload.host);
			break;
	}
	await JobDTO.appendLog(entry.id, steps.done);
	return { action: payload.action };
}

export const jobHandlers: Partial<Record<JobType, JobHandler>> = {
	core_service: runCoreService,
	notification_delivery: runNotificationDelivery,
};
