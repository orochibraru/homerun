import { JobDTO } from "$lib/dto/job-dto";
import { BaseScheduler } from "../cron/base-scheduler.ts";
import { jobHandlers } from "./handlers.ts";

const POLL_MS = 1000;
const MAX_CONCURRENT_JOBS = 3;
const RETRY_BASE_MS = 10_000;

const holdState = globalThis as unknown as { __job_worker_held?: boolean };

class JobWorkerClass extends BaseScheduler {
	protected readonly label = "Queue";
	protected readonly intervalMs = POLL_MS;
	readonly #inFlight = new Set<string>();
	#orphanCheck: Promise<void> | null = null;

	/** Whether the worker is held (see `hold()`): true means no new jobs will be claimed, held state is process-global and HMR-safe. */
	get held(): boolean {
		return holdState.__job_worker_held === true;
	}

	/** Whether at least one job is currently running in this process. */
	get busy(): boolean {
		return this.#inFlight.size > 0;
	}

	/** Stops the worker from claiming new jobs (already-running jobs finish normally). Used around operations that must not race a deploy, e.g. self-update. */
	hold(): void {
		holdState.__job_worker_held = true;
		this.logger.warn("Job worker held: no new jobs will start.");
	}

	/** Reverses `hold()`, letting the worker resume claiming jobs. */
	release(): void {
		holdState.__job_worker_held = false;
		this.logger.info("Job worker released.");
	}

	/** Recovers orphaned jobs from a previous process, then pumps as many queued jobs as capacity allows. No-op while held. */
	protected async tick(): Promise<void> {
		if (this.held) {
			return;
		}
		await this.#recoverOrphans();
		await this.#pump();
	}

	/** Runs `#requeueOrphans` at most once per process lifetime, caching the in-flight promise so concurrent ticks don't requeue twice. */
	async #recoverOrphans(): Promise<void> {
		this.#orphanCheck ??= this.#requeueOrphans();
		await this.#orphanCheck;
	}

	/** Requeues jobs left stuck in "running" by a previous process that died mid-job (`JobDTO.requeueOrphaned`), logging how many. */
	async #requeueOrphans(): Promise<void> {
		const requeued = await JobDTO.requeueOrphaned();
		if (requeued > 0) {
			this.logger.warn(
				`Requeued ${requeued} job(s) left running by a previous process.`,
			);
		}
	}

	/** Claims and dispatches queued jobs one at a time, recursively, until `MAX_CONCURRENT_JOBS` in-flight jobs are running or the queue is empty. No-op while held. */
	async #pump(): Promise<void> {
		if (this.held || this.#inFlight.size >= MAX_CONCURRENT_JOBS) {
			return;
		}
		const claimed = await JobDTO.claimNext();
		if (!claimed) {
			return;
		}
		this.#dispatch(claimed);
		await this.#pump();
	}

	/** Tracks `entry` as in-flight and starts `runJob` for it, removing it from `#inFlight` on settlement regardless of outcome. */
	#dispatch(entry: JobDTO): void {
		this.#inFlight.add(entry.id);
		this.logger.info(
			`Job started: type=${entry.type} job=${entry.id} attempt=${entry.attempts}/${entry.maxAttempts}`,
		);
		this.runJob(entry)
			.catch((err) => this.logger.error("Job bookkeeping failed", err))
			.finally(() => this.#inFlight.delete(entry.id));
	}

	/** Runs `entry` through its type's handler (`jobHandlers`), marking it succeeded with the handler's result or delegating to `#recordFailure` on error. Never throws. */
	async runJob(entry: JobDTO): Promise<void> {
		try {
			const result = await jobHandlers[entry.type](entry);
			await entry.markSucceeded(result);
			this.logger.info(`Job succeeded: type=${entry.type} job=${entry.id}`);
		} catch (err) {
			await this.#recordFailure(entry, err);
		}
	}

	/** Schedules an exponential-backoff retry if `entry` has attempts left, otherwise marks it failed and cancels any dependent jobs. */
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
