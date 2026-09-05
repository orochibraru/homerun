import {
	and,
	asc,
	desc,
	eq,
	inArray,
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
import type { JobStatus, JobType } from "$lib/types";
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

export class JobDTO extends BaseDTO<Job> {
	static async get(id: string): Promise<JobDTO | null> {
		const [row] = await db.select().from(job).where(eq(job.id, id)).limit(1);
		return row ? new JobDTO(row) : null;
	}

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

	static async create(input: NewJobInput): Promise<JobDTO | null> {
		const now = new Date();
		const row: Job = {
			attempts: 0,
			createdAt: now,
			dedupeKey: input.dedupeKey ?? null,
			dependsOnJobId: input.dependsOnJobId ?? null,
			error: null,
			exclusive: input.exclusive ?? false,
			finishedAt: null,
			id: crypto.randomUUID(),
			lockKey: input.lockKey ?? null,
			maxAttempts: input.maxAttempts ?? 1,
			payload: input.payload,
			priority: input.priority ?? 0,
			result: null,
			runAt: input.runAt ?? now,
			serviceId: input.serviceId ?? null,
			startedAt: null,
			status: "queued",
			title: input.title,
			type: input.type,
			userId: input.userId,
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

	static async requeueOrphaned(): Promise<number> {
		const rows = await db
			.update(job)
			.set({ startedAt: null, status: "queued" })
			.where(eq(job.status, "running"))
			.returning({ id: job.id });
		return rows.length;
	}

	static async cancelDependents(jobId: string, reason: string): Promise<void> {
		let frontier = [jobId];
		while (frontier.length > 0) {
			// biome-ignore lint/performance/noAwaitInLoops: each level of the dependency chain is only known once the previous one is cancelled
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

	static async listActive(userId: string): Promise<JobDTO[]> {
		const rows = await db
			.select()
			.from(job)
			.where(
				and(eq(job.userId, userId), inArray(job.status, ["running", "queued"])),
			)
			.orderBy(desc(job.status), desc(job.priority), asc(job.createdAt))
			.limit(50);
		return rows.map((row) => new JobDTO(row));
	}

	static async listRecent(
		userId: string,
		limit = 15,
	): Promise<Array<{ job: JobDTO; serviceSlug: string | null }>> {
		const rows = await db
			.select({ row: job, serviceSlug: service.slug })
			.from(job)
			.leftJoin(service, eq(job.serviceId, service.id))
			.where(
				and(eq(job.userId, userId), inArray(job.status, TERMINAL_STATUSES)),
			)
			.orderBy(desc(job.finishedAt))
			.limit(limit);
		return rows.map((r) => ({
			job: new JobDTO(r.row),
			serviceSlug: r.serviceSlug,
		}));
	}

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

	private async update(input: Partial<Job>): Promise<void> {
		await db.update(job).set(input).where(eq(job.id, this.row.id));
		Object.assign(this.row, input);
	}

	async markSucceeded(result: Record<string, unknown> | null): Promise<void> {
		await this.update({ finishedAt: new Date(), result, status: "succeeded" });
	}

	async markFailed(error: string): Promise<void> {
		await this.update({ error, finishedAt: new Date(), status: "failed" });
	}

	async scheduleRetry(error: string, runAt: Date): Promise<void> {
		await this.update({ error, runAt, startedAt: null, status: "queued" });
	}

	get attempts(): number {
		return this.row.attempts;
	}
	get error(): string | null {
		return this.row.error;
	}
	get id(): string {
		return this.row.id;
	}
	get maxAttempts(): number {
		return this.row.maxAttempts;
	}
	get payload(): Record<string, unknown> {
		return this.row.payload;
	}
	get result(): Record<string, unknown> | null {
		return this.row.result;
	}
	get status(): JobStatus {
		return this.row.status;
	}
	get title(): string {
		return this.row.title;
	}
	get type(): JobType {
		return this.row.type;
	}
	get userId(): string {
		return this.row.userId;
	}
}
