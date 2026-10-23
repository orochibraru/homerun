/** Thrown by a job's prepare step to put the job back in the queue until `runAt`, without counting it as a failed attempt. */
export class JobDeferredError extends Error {
	override name = "JobDeferredError";
	readonly runAt: Date;

	/** @param runAt When the job may be claimed again. */
	constructor(message: string, runAt: Date) {
		super(message);
		this.runAt = runAt;
	}
}
