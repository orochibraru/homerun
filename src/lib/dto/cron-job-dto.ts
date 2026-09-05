import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type CronJob, cronJob } from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import { BaseDTO } from "./base-dto";

export interface NewCronJobInput {
	command?: string | null;
	description?: string | null;
	enabled: boolean;
	envVars: Record<string, string>;
	image?: string | null;
	kind: "image" | "exec";
	name: string;
	registryPasswordEnc?: string | null;
	registryUrl?: string | null;
	registryUsername?: string | null;
	schedule: string;
	tag?: string | null;
	timeoutSeconds: number;
	userId: string;
}

export type CronJobUpdateInput = Partial<
	Pick<
		CronJob,
		| "command"
		| "description"
		| "enabled"
		| "envVars"
		| "image"
		| "kind"
		| "lastRunAt"
		| "name"
		| "registryPasswordEnc"
		| "registryUrl"
		| "registryUsername"
		| "schedule"
		| "tag"
		| "timeoutSeconds"
	>
>;

export class CronJobDTO extends BaseDTO<CronJob> {
	static async get(id: string, userId: string): Promise<CronJobDTO | null> {
		const [row] = await db
			.select()
			.from(cronJob)
			.where(and(eq(cronJob.id, id), eq(cronJob.userId, userId)))
			.limit(1);
		return row ? new CronJobDTO(row) : null;
	}

	static async list(userId: string): Promise<CronJobDTO[]> {
		const rows = await db
			.select()
			.from(cronJob)
			.where(eq(cronJob.userId, userId))
			.orderBy(desc(cronJob.createdAt));
		return rows.map((row) => new CronJobDTO(row));
	}

	static async listPaged(
		userId: string,
		query: ListQuery,
	): Promise<PagedResult<CronJobDTO>> {
		const conditions: SQL[] = [eq(cronJob.userId, userId)];
		const search = searchCondition(query.q, [
			cronJob.name,
			cronJob.description,
			cronJob.image,
			cronJob.command,
		]);
		if (search) {
			conditions.push(search);
		}
		const kinds = query.filters.kind;
		if (kinds && kinds.length > 0) {
			conditions.push(
				inArray(
					cronJob.kind,
					kinds.filter((k): k is "image" | "exec" =>
						["image", "exec"].includes(k),
					),
				),
			);
		}
		const enabled = query.filters.enabled;
		if (enabled && enabled.length === 1) {
			conditions.push(eq(cronJob.enabled, enabled[0] === "on"));
		}
		const where = and(...conditions);

		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(cronJob)
				.where(where)
				.orderBy(desc(cronJob.createdAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(cronJob).where(where),
		]);

		return {
			items: rows.map((row) => new CronJobDTO(row)),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	static async listEnabled(): Promise<CronJobDTO[]> {
		const rows = await db
			.select()
			.from(cronJob)
			.where(eq(cronJob.enabled, true));
		return rows.map((row) => new CronJobDTO(row));
	}

	static async create(input: NewCronJobInput): Promise<CronJobDTO> {
		const now = new Date();
		const row: CronJob = {
			command: input.command ?? null,
			createdAt: now,
			description: input.description ?? null,
			enabled: input.enabled,
			envVars: input.envVars,
			id: crypto.randomUUID(),
			image: input.image ?? null,
			kind: input.kind,
			lastRunAt: null,
			name: input.name,
			registryPasswordEnc: input.registryPasswordEnc ?? null,
			registryUrl: input.registryUrl ?? null,
			registryUsername: input.registryUsername ?? null,
			schedule: input.schedule,
			tag: input.tag ?? "latest",
			timeoutSeconds: input.timeoutSeconds,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(cronJob).values(row);
		return new CronJobDTO(row);
	}

	async update(input: CronJobUpdateInput): Promise<void> {
		await db.update(cronJob).set(input).where(eq(cronJob.id, this.row.id));
		Object.assign(this.row, input);
	}

	async delete(): Promise<void> {
		await db.delete(cronJob).where(eq(cronJob.id, this.row.id));
	}

	get id(): string {
		return this.row.id;
	}
	get userId(): string {
		return this.row.userId;
	}
	get name(): string {
		return this.row.name;
	}
	get kind(): CronJob["kind"] {
		return this.row.kind;
	}
	get schedule(): string {
		return this.row.schedule;
	}
	get enabled(): boolean {
		return this.row.enabled;
	}
	get lastRunAt(): Date | null {
		return this.row.lastRunAt;
	}
	get image(): string | null {
		return this.row.image;
	}
	get tag(): string | null {
		return this.row.tag;
	}
	get command(): string | null {
		return this.row.command;
	}
	get envVars(): Record<string, string> {
		return this.row.envVars ?? {};
	}
	get timeoutSeconds(): number {
		return this.row.timeoutSeconds;
	}
	get registryUrl(): string | null {
		return this.row.registryUrl;
	}
	get registryUsername(): string | null {
		return this.row.registryUsername;
	}
	get registryPasswordEnc(): string | null {
		return this.row.registryPasswordEnc;
	}
}
