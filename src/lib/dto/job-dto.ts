import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	inArray,
	isNull,
	lt,
	lte,
	ne,
	notExists,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "$lib/server/db/lib";
import { type Job, job, service } from "$lib/server/db/schema";
import { decryptSecret, encryptSecret } from "$lib/services/secrets";
import type { JobStage, JobStatus, JobType } from "$lib/types";
import { BaseDTO } from "./base-dto";

const TERMINAL_STATUSES: JobStatus[] = ["succeeded", "failed", "cancelled"];
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_PROBABILITY = 0.02;

export interface NewJobInput {
	dedupeKey?: string | null;
	dependsOnJobId?: string | null;
	exclusive?: boolean;
	lockKey?: string | null;
	maxAttempts?: number;
	payload: Record<string, unknown>;
	priority?: number;
	runAt?: Date;
	serviceId?: string | null;
	title: string;
	type: JobType;
	userId: string;
}

const one = { one: sql`1` };

const CLEARED_STAGE = {
	executorError: null,
	executorResult: null,
	heartbeatAt: null,
	spec: null,
	stage: null,
	workerId: null,
} satisfies Partial<Job>;

function dependencySatisfied() {
	const dependency = alias(job, "dependency");
	return notExists(
		db
			.select(one)
			.from(dependency)
			.where(
				and(
					eq(dependency.id, job.dependsOnJobId),
					ne(dependency.status, "succeeded"),
				),
			),
	);
}

function lockFree() {
	const lockHolder = alias(job, "lock_holder");
	return notExists(
		db
			.select(one)
			.from(lockHolder)
			.where(
				and(
					eq(lockHolder.status, "running"),
					eq(lockHolder.lockKey, job.lockKey),
				),
			),
	);
}

function exclusivityRespected() {
	const running = alias(job, "running_job");
	return notExists(
		db
			.select(one)
			.from(running)
			.where(
				and(
					eq(running.status, "running"),
					or(eq(running.exclusive, true), eq(job.exclusive, true)),
				),
			),
	);
}

/**
 * SQL condition that stops a non-exclusive job from being claimed while an
 * exclusive job is already due, so the exclusive one isn't starved by a steady
 * stream of shared work.
 */
function noExclusiveBarrierAhead(now: Date) {
	const barrier = alias(job, "barrier");
	return or(
		eq(job.exclusive, true),
		notExists(
			db
				.select(one)
				.from(barrier)
				.where(
					and(
						eq(barrier.status, "queued"),
						eq(barrier.exclusive, true),
						lte(barrier.runAt, now),
					),
				),
		),
	);
}

function claimableCondition(now: Date) {
	return and(
		eq(job.status, "queued"),
		lte(job.runAt, now),
		dependencySatisfied(),
		lockFree(),
		exclusivityRespected(),
		noExclusiveBarrierAhead(now),
	);
}

/**
 * Wraps the `job` table : the persistent background job queue, claimed by the
 * worker with row locks.
 */
export class JobDTO extends BaseDTO<Job> {
	/**
	 * Loads one job by id, unscoped : callers must check ownership themselves.
	 */
	static async get(id: string): Promise<JobDTO | null> {
		const [row] = await db.select().from(job).where(eq(job.id, id)).limit(1);
		return row ? new JobDTO(row) : null;
	}

	/**
	 * The progress logs of these jobs, keyed by job id, in one query. Null ids
	 * (a row that predates its job link) are skipped.
	 */
	static async logsFor(ids: (string | null)[]): Promise<Map<string, string>> {
		const wanted = ids.filter((id): id is string => id !== null);
		if (wanted.length === 0) {
			return new Map();
		}
		const rows = await db
			.select({ id: job.id, log: job.log })
			.from(job)
			.where(inArray(job.id, wanted));
		return new Map(rows.map((row) => [row.id, row.log]));
	}

	/**
	 * The queued (not yet running) job of this type with this dedupe key, if any.
	 */
	static async findQueued(
		type: JobType,
		dedupeKey: string,
	): Promise<JobDTO | null> {
		const [row] = await db
			.select()
			.from(job)
			.where(
				and(
					eq(job.type, type),
					eq(job.dedupeKey, dedupeKey),
					eq(job.status, "queued"),
				),
			)
			.limit(1);
		return row ? new JobDTO(row) : null;
	}

	/** The queued or running job of this type with this dedupe key, if any. */
	static async findActive(
		type: JobType,
		dedupeKey: string,
	): Promise<JobDTO | null> {
		const [row] = await db
			.select()
			.from(job)
			.where(
				and(
					eq(job.type, type),
					eq(job.dedupeKey, dedupeKey),
					inArray(job.status, ["queued", "running"]),
				),
			)
			.limit(1);
		return row ? new JobDTO(row) : null;
	}

	/**
	 * Enqueues a job, and on roughly 2% of writes prunes finished jobs older than
	 * a week.
	 *
	 * @returns The new job, or null when a queued job with the same type and
	 * dedupe key already exists.
	 */
	static async create(input: NewJobInput): Promise<JobDTO | null> {
		const now = new Date();
		const row: Job = {
			attempts: 0,
			createdAt: now,
			dedupeKey: input.dedupeKey ?? null,
			dependsOnJobId: input.dependsOnJobId ?? null,
			error: null,
			exclusive: input.exclusive ?? false,
			executorError: null,
			executorResult: null,
			finishedAt: null,
			heartbeatAt: null,
			id: crypto.randomUUID(),
			lockKey: input.lockKey ?? null,
			log: "",
			maxAttempts: input.maxAttempts ?? 1,
			payload: input.payload,
			priority: input.priority ?? 0,
			result: null,
			runAt: input.runAt ?? now,
			serviceId: input.serviceId ?? null,
			spec: null,
			stage: null,
			startedAt: null,
			status: "queued",
			title: input.title,
			type: input.type,
			userId: input.userId,
			workerId: null,
		};

		const [inserted] = await db
			.insert(job)
			.values(row)
			.onConflictDoNothing()
			.returning();

		if (Math.random() < PRUNE_PROBABILITY) {
			await JobDTO.prune();
		}
		return inserted ? new JobDTO(inserted) : null;
	}

	/**
	 * Atomically claims the highest-priority due job whose dependency has
	 * succeeded, whose lock key is free and whose exclusivity rules allow it,
	 * marking it running and bumping its attempt count. Uses `FOR UPDATE SKIP
	 * LOCKED`, so concurrent workers never claim the same job.
	 *
	 * @returns The claimed job, or null when nothing is claimable.
	 */
	static async claimNext(): Promise<JobDTO | null> {
		const now = new Date();

		return await db.transaction(async (tx) => {
			const [candidate] = await tx
				.select()
				.from(job)
				.where(claimableCondition(now))
				.orderBy(desc(job.priority), asc(job.runAt), asc(job.createdAt))
				.limit(1)
				.for("update", { skipLocked: true });

			if (!candidate) {
				return null;
			}

			const claimed = {
				...candidate,
				attempts: candidate.attempts + 1,
				startedAt: new Date(),
				status: "running" as const,
			};
			await tx
				.update(job)
				.set({
					attempts: claimed.attempts,
					startedAt: claimed.startedAt,
					status: claimed.status,
				})
				.where(eq(job.id, candidate.id));
			return new JobDTO(claimed);
		});
	}

	/**
	 * Instance-wide counts of queued-or-running deploys and of jobs running right
	 * now, for the activity indicator.
	 */
	static async activitySummary(): Promise<{
		pendingDeploys: number;
		running: number;
	}> {
		const [[deploys], [running]] = await Promise.all([
			db
				.select({ total: count() })
				.from(job)
				.where(
					and(
						eq(job.type, "deploy"),
						inArray(job.status, ["queued", "running"]),
					),
				),
			db.select({ total: count() }).from(job).where(eq(job.status, "running")),
		]);
		return {
			pendingDeploys: deploys?.total ?? 0,
			running: running?.total ?? 0,
		};
	}

	/**
	 * Counts jobs of any of the given types currently in any of the given
	 * statuses.
	 */
	static async countByTypes(
		types: JobType[],
		statuses: JobStatus[],
	): Promise<number> {
		const [row] = await db
			.select({ total: count() })
			.from(job)
			.where(and(inArray(job.type, types), inArray(job.status, statuses)));
		return row?.total ?? 0;
	}

	/**
	 * Recovers jobs a previous app process died in the middle of: a running job
	 * with no stage or still in `prepare` goes back to the queue, one caught
	 * mid-`finalizing` goes back to `finalize`. Jobs in `execute` are left
	 * alone, the Go worker's lease owns them. An orphan whose dedupe key is
	 * already taken by a queued job, or by a newer orphan, is cancelled instead
	 * of requeued, since two queued twins violate the queued dedupe index.
	 *
	 * @returns How many jobs were requeued.
	 */
	static async requeueOrphaned(): Promise<number> {
		await db
			.update(job)
			.set({ stage: "finalize" })
			.where(and(eq(job.status, "running"), eq(job.stage, "finalizing")));
		const orphaned = and(
			eq(job.status, "running"),
			or(isNull(job.stage), eq(job.stage, "prepare")),
		);
		const twin = alias(job, "twin");
		await db
			.update(job)
			.set({
				...CLEARED_STAGE,
				error: "Superseded by a newer job for the same target.",
				finishedAt: new Date(),
				status: "cancelled",
			})
			.where(
				and(
					orphaned,
					exists(
						db
							.select({ id: twin.id })
							.from(twin)
							.where(
								and(
									eq(twin.type, job.type),
									eq(twin.dedupeKey, job.dedupeKey),
									ne(twin.id, job.id),
									or(
										eq(twin.status, "queued"),
										and(
											eq(twin.status, "running"),
											or(isNull(twin.stage), eq(twin.stage, "prepare")),
											sql`${twin.createdAt} > ${job.createdAt}`,
										),
									),
								),
							),
					),
				),
			);
		const rows = await db
			.update(job)
			.set({ ...CLEARED_STAGE, startedAt: null, status: "queued" })
			.where(orphaned)
			.returning({ id: job.id });
		return rows.length;
	}

	/**
	 * Claims one job the Go worker has finished executing (stage `finalize`),
	 * moving it to `finalizing` so no other claimer picks it up.
	 */
	static async claimFinalize(): Promise<JobDTO | null> {
		return await db.transaction(async (tx) => {
			const [candidate] = await tx
				.select()
				.from(job)
				.where(and(eq(job.status, "running"), eq(job.stage, "finalize")))
				.orderBy(desc(job.priority), asc(job.createdAt))
				.limit(1)
				.for("update", { skipLocked: true });
			if (!candidate) {
				return null;
			}
			await tx
				.update(job)
				.set({ stage: "finalizing" })
				.where(eq(job.id, candidate.id));
			return new JobDTO({ ...candidate, stage: "finalizing" });
		});
	}

	/**
	 * Jobs waiting in `execute` with no live Go worker: never leased and handed
	 * over before `since`, or with a heartbeat older than two minutes.
	 */
	static async listStalledExecutions(since: Date): Promise<JobDTO[]> {
		const rows = await db
			.select()
			.from(job)
			.where(
				and(
					eq(job.status, "running"),
					eq(job.stage, "execute"),
					or(
						and(isNull(job.heartbeatAt), lt(job.startedAt, since)),
						lt(job.heartbeatAt, since),
					),
				),
			);
		return rows.map((row) => new JobDTO(row));
	}

	/**
	 * Cancels every queued or running job that depends on `jobId`, directly or
	 * transitively, recording `reason` as their error.
	 */
	static async cancelDependents(jobId: string, reason: string): Promise<void> {
		let frontier = [jobId];
		while (frontier.length > 0) {
			// oxlint-disable-next-line no-await-in-loop -- each level of the dependency chain is only known once the previous one is cancelled
			const cancelled = await db
				.update(job)
				.set({ error: reason, finishedAt: new Date(), status: "cancelled" })
				.where(
					and(
						inArray(job.dependsOnJobId, frontier),
						inArray(job.status, ["queued", "running"]),
					),
				)
				.returning({ id: job.id });
			frontier = cancelled.map((row) => row.id);
		}
	}

	/**
	 * Cancels the queued or running job carrying `deploymentId` in its payload,
	 * and anything waiting on it. A queued job never starts; one the Go worker
	 * is executing loses its lease on the next heartbeat, which cancels the
	 * build or pull and drops its result.
	 *
	 * @returns Whether a job was cancelled.
	 */
	static async cancelForDeployment(
		deploymentId: string,
		reason: string,
	): Promise<boolean> {
		const cancelled = await db
			.update(job)
			.set({
				...CLEARED_STAGE,
				error: reason,
				finishedAt: new Date(),
				status: "cancelled",
			})
			.where(
				and(
					sql`${job.payload}->>'deploymentId' = ${deploymentId}`,
					inArray(job.status, ["queued", "running"]),
				),
			)
			.returning({ id: job.id });
		await Promise.all(
			cancelled.map((row) => JobDTO.cancelDependents(row.id, reason)),
		);
		return cancelled.length > 0;
	}

	/**
	 * Up to 50 running and queued jobs, running first, then by priority and
	 * age.
	 */
	static async listActive(): Promise<JobDTO[]> {
		const rows = await db
			.select()
			.from(job)
			.where(inArray(job.status, ["running", "queued"]))
			.orderBy(desc(job.status), desc(job.priority), asc(job.createdAt))
			.limit(50);
		return rows.map((row) => new JobDTO(row));
	}

	/**
	 * The most recently finished jobs (succeeded, failed or cancelled), each
	 * with its service's slug when it has one.
	 */
	static async listRecent(
		limit = 15,
	): Promise<Array<{ job: JobDTO; serviceSlug: string | null }>> {
		const rows = await db
			.select({ row: job, serviceSlug: service.slug })
			.from(job)
			.leftJoin(service, eq(job.serviceId, service.id))
			.where(inArray(job.status, TERMINAL_STATUSES))
			.orderBy(desc(job.finishedAt))
			.limit(limit);
		return rows.map((r) => ({
			job: new JobDTO(r.row),
			serviceSlug: r.serviceSlug,
		}));
	}

	/** Deletes finished jobs that finished more than a week ago. */
	static async prune(): Promise<void> {
		await db
			.delete(job)
			.where(
				and(
					inArray(job.status, TERMINAL_STATUSES),
					lt(job.finishedAt, new Date(Date.now() - RETENTION_MS)),
				),
			);
	}

	/** Writes the given fields to the row and mirrors them onto this instance. */
	private async update(input: Partial<Job>): Promise<void> {
		await db.update(job).set(input).where(eq(job.id, this.row.id));
		Object.assign(this.row, input);
	}

	/** Marks the job succeeded now, storing its result and dropping its spec. */
	async markSucceeded(result: Record<string, unknown> | null): Promise<void> {
		await this.update({
			finishedAt: new Date(),
			result,
			spec: null,
			stage: null,
			status: "succeeded",
		});
	}

	/** Marks the job failed now, storing the error message and dropping its spec. */
	async markFailed(error: string): Promise<void> {
		await this.update({
			error,
			finishedAt: new Date(),
			spec: null,
			stage: null,
			status: "failed",
		});
	}

	/**
	 * Puts the job back in the queue to run again at `runAt`, keeping the last
	 * error for display and clearing everything the previous attempt's stages
	 * left behind.
	 */
	async scheduleRetry(error: string, runAt: Date): Promise<void> {
		await this.update({
			...CLEARED_STAGE,
			error,
			runAt,
			startedAt: null,
			status: "queued",
		});
	}

	/**
	 * Hands a claimed job to the Go worker: stores `spec` encrypted and moves
	 * the job to the `execute` stage, still `running`.
	 */
	async handOff(spec: Record<string, unknown>): Promise<void> {
		await this.update({
			...CLEARED_STAGE,
			spec: encryptSecret(JSON.stringify(spec)),
			stage: "execute",
		});
	}

	/**
	 * The spec `handOff` stored, decrypted, or null when there is none or it
	 * can't be decrypted.
	 */
	decryptSpec(): Record<string, unknown> | null {
		const plaintext = this.row.spec ? decryptSecret(this.row.spec) : null;
		return plaintext
			? (JSON.parse(plaintext) as Record<string, unknown>)
			: null;
	}

	/** How many times the job has been claimed so far. */
	get attempts(): number {
		return this.row.attempts;
	}
	/** The Go executor's error message, null when it succeeded or hasn't run. */
	get executorError(): string | null {
		return this.row.executorError;
	}
	/** What the Go executor returned, null until it has run. */
	get executorResult(): Record<string, unknown> | null {
		return this.row.executorResult;
	}
	/** Output lines the Go executor appended, newline-separated. */
	get log(): string {
		return this.row.log;
	}
	/** Where a Go-executed job is in the prepare/execute/finalize protocol, null for an in-process job. */
	get stage(): JobStage | null {
		return this.row.stage;
	}
	/** When the job was claimed, null while queued. */
	get startedAt(): Date | null {
		return this.row.startedAt;
	}
	/** The last error message, null when it hasn't failed. */
	get error(): string | null {
		return this.row.error;
	}
	/** The job's id. */
	get id(): string {
		return this.row.id;
	}
	/** How many attempts the job gets before it is marked failed for good. */
	get maxAttempts(): number {
		return this.row.maxAttempts;
	}
	/** The job-type-specific input the handler runs with. */
	get payload(): Record<string, unknown> {
		return this.row.payload;
	}
	/** The handler's result, null until it succeeds. */
	get result(): Record<string, unknown> | null {
		return this.row.result;
	}
	/** The job's current queue status. */
	get status(): JobStatus {
		return this.row.status;
	}
	/** The human-readable title shown in the job queue. */
	get title(): string {
		return this.row.title;
	}
	/** Which handler runs the job. */
	get type(): JobType {
		return this.row.type;
	}
	/** The id of the user the job was enqueued for. */
	get userId(): string {
		return this.row.userId;
	}
}
