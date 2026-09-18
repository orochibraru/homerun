import type { JobDTO } from "$lib/dto/job-dto";
import type { JobResult } from "../handlers.ts";

/**
 * A job type the Go worker executes. `prepare` runs in the app on claim and
 * returns the spec the executor gets (encrypted at rest, so secrets may go in
 * it); `finalize` runs in the app once the executor has reported back, and its
 * return value or throw drives the usual succeed/retry/fail bookkeeping.
 */
export interface WorkerJob {
	finalize: (
		job: JobDTO,
		result: Record<string, unknown> | null,
		error: string | null,
	) => Promise<JobResult>;
	prepare: (job: JobDTO) => Promise<Record<string, unknown>>;
}
