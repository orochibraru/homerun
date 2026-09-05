import { JobDTO, type NewJobInput } from "$lib/dto/job-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Queue");

const WAIT_POLL_MS = 250;
const WAIT_TIMEOUT_MS = 30 * 60 * 1000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class QueueServiceClass {
	async enqueue(input: NewJobInput): Promise<JobDTO> {
		if (input.dedupeKey) {
			const existing = await JobDTO.findQueued(input.type, input.dedupeKey);
			if (existing) {
				logger.info(
					`Job coalesced into an already-queued one: type=${input.type} dedupe=${input.dedupeKey} job=${existing.id}`,
				);
				return existing;
			}
		}

		const created = await JobDTO.create(input);
		if (created) {
			logger.info(
				`Job queued: type=${input.type} job=${created.id} title="${input.title}" user=${input.userId}`,
			);
			return created;
		}

		const raced =
			input.dedupeKey && (await JobDTO.findQueued(input.type, input.dedupeKey));
		if (!raced) {
			throw new Error("Couldn't queue the job.");
		}
		return raced;
	}

	async wait(jobId: string, timeoutMs = WAIT_TIMEOUT_MS): Promise<JobDTO> {
		const deadline = Date.now() + timeoutMs;
		let current = await JobDTO.get(jobId);
		while (current && current.status !== "succeeded") {
			if (current.status === "failed" || current.status === "cancelled") {
				return current;
			}
			if (Date.now() > deadline) {
				throw new Error("Timed out waiting for the queued job to finish.");
			}
			// biome-ignore lint/performance/noAwaitInLoops: polling one job's terminal status is sequential by definition
			await sleep(WAIT_POLL_MS);
			current = await JobDTO.get(jobId);
		}
		if (!current) {
			throw new Error("The queued job disappeared before it finished.");
		}
		return current;
	}

	listActive(userId: string): Promise<JobDTO[]> {
		return JobDTO.listActive(userId);
	}

	listRecent(
		userId: string,
	): Promise<Array<{ job: JobDTO; serviceSlug: string | null }>> {
		return JobDTO.listRecent(userId);
	}
}

export const QueueService = new QueueServiceClass();
