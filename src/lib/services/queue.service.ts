import { JobDTO, type NewJobInput } from "$lib/dto/job-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Queue");

const WAIT_POLL_MS = 250;
const WAIT_TIMEOUT_MS = 30 * 60 * 1000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class QueueServiceClass {
	/**
	 * Creates a job row for the worker to pick up. When `input.dedupeKey` is
	 * set and a job of the same type/key is already queued, returns that
	 * existing job instead of creating a duplicate (also covering the race
	 * where two callers insert concurrently and only one `create` wins).
	 * @throws When creation fails and no queued job with the same dedupe key
	 * can be found either.
	 */
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

	/**
	 * Polls the job every `WAIT_POLL_MS` until it reaches a terminal status
	 * (succeeded/failed/cancelled) and returns it.
	 * @throws When `timeoutMs` elapses first, or the job row disappears.
	 */
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

	/** Lists the user's queued/running jobs. */
	listActive(userId: string): Promise<JobDTO[]> {
		return JobDTO.listActive(userId);
	}

	/** Lists the user's recently finished jobs, each paired with the slug of the service it deployed (if any). */
	listRecent(
		userId: string,
	): Promise<Array<{ job: JobDTO; serviceSlug: string | null }>> {
		return JobDTO.listRecent(userId);
	}
}

export const QueueService = new QueueServiceClass();
