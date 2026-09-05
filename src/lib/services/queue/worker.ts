import { JobDTO } from "$lib/dto/job-dto";
import { Logger } from "$lib/logger";
import { BaseScheduler } from "../cron/base-scheduler.ts";
import { jobHandlers } from "./handlers.ts";

const POLL_MS = 1000;
const MAX_CONCURRENT_JOBS = 3;
const RETRY_BASE_MS = 10_000;

class JobWorkerClass extends BaseScheduler {
	protected readonly logger = new Logger("Queue");
	protected readonly label = "Queue";
	protected readonly intervalMs = POLL_MS;
	readonly #inFlight = new Set<string>();
	#orphanCheck: Promise<void> | null = null;

	protected async tick(): Promise<void> {
		await this.#recoverOrphans();
		await this.#pump();
	}

	async #recoverOrphans(): Promise<void> {
		this.#orphanCheck ??= this.#requeueOrphans();
		await this.#orphanCheck;
	}

	async #requeueOrphans(): Promise<void> {
		const requeued = await JobDTO.requeueOrphaned();
		if (requeued > 0) {
			this.logger.warn(
				`Requeued ${requeued} job(s) left running by a previous process.`,
			);
		}
	}

	async #pump(): Promise<void> {
		if (this.#inFlight.size >= MAX_CONCURRENT_JOBS) {
			return;
		}
		const claimed = await JobDTO.claimNext();
		if (!claimed) {
			return;
		}
		this.#dispatch(claimed);
		await this.#pump();
	}

	#dispatch(entry: JobDTO): void {
		this.#inFlight.add(entry.id);
		this.logger.info(
			`Job started: type=${entry.type} job=${entry.id} attempt=${entry.attempts}/${entry.maxAttempts}`,
		);
		this.runJob(entry)
			.catch((err) => this.logger.error("Job bookkeeping failed", err))
			.finally(() => this.#inFlight.delete(entry.id));
	}

	async runJob(entry: JobDTO): Promise<void> {
		try {
			const result = await jobHandlers[entry.type](entry);
			await entry.markSucceeded(result);
			this.logger.info(`Job succeeded: type=${entry.type} job=${entry.id}`);
		} catch (err) {
			await this.#recordFailure(entry, err);
		}
	}

	async #recordFailure(entry: JobDTO, err: unknown): Promise<void> {
		const message = err instanceof Error ? err.message : String(err);

		if (entry.attempts < entry.maxAttempts) {
			const runAt = new Date(Date.now() + RETRY_BASE_MS * 2 ** entry.attempts);
			await entry.scheduleRetry(message, runAt);
			this.logger.warn(
				`Job failed, retrying at ${runAt.toISOString()}: type=${entry.type} job=${entry.id} : ${message}`,
			);
			return;
		}

		await entry.markFailed(message);
		await JobDTO.cancelDependents(
			entry.id,
			`Cancelled because "${entry.title}" failed.`,
		);
		this.logger.error(
			`Job failed: type=${entry.type} job=${entry.id} : ${message}`,
		);
	}
}

export const JobWorker = new JobWorkerClass();
