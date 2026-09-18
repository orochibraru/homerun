import type { JobDTO } from "$lib/dto/job-dto";
import type { JobType } from "$lib/types";
import { NotificationChannelService } from "../notification-channel.service.ts";
import { notificationDeliveryJobPayload } from "./payloads.ts";

export type JobResult = Record<string, unknown> | null;
type JobHandler = (job: JobDTO) => Promise<JobResult>;

async function runNotificationDelivery(entry: JobDTO): Promise<JobResult> {
	const { channelId, message } = notificationDeliveryJobPayload.parse(
		entry.payload,
	);
	return await NotificationChannelService.retryDelivery(channelId, message);
}

export const jobHandlers: Partial<Record<JobType, JobHandler>> = {
	notification_delivery: runNotificationDelivery,
};
