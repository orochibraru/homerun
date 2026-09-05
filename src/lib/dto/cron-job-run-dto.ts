import { desc, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type CronJobRun, cronJob, cronJobRun } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

const MAX_OUTPUT_CHARS = 64_000;

export interface CronJobRunResult {
	error?: string | null;
	exitCode?: number | null;
	output?: string;
	success: boolean;
}

export class CronJobRunDTO extends BaseDTO<CronJobRun> {
	static async create(cronJobId: string): Promise<CronJobRunDTO> {
		const row: CronJobRun = {
			cronJobId,
			error: null,
			exitCode: null,
			finishedAt: null,
			id: crypto.randomUUID(),
			output: "",
			startedAt: new Date(),
			success: null,
		};
		await db.insert(cronJobRun).values(row);
		return new CronJobRunDTO(row);
	}

	async finish(result: CronJobRunResult): Promise<void> {
		const output = result.output ?? "";
		const patch = {
			error: result.error ?? null,
			exitCode: result.exitCode ?? null,
			finishedAt: new Date(),
			output:
				output.length > MAX_OUTPUT_CHARS
					? output.slice(output.length - MAX_OUTPUT_CHARS)
					: output,
			success: result.success,
		};
		await db
			.update(cronJobRun)
			.set(patch)
			.where(eq(cronJobRun.id, this.row.id));
		Object.assign(this.row, patch);
	}

	static async listForJob(
		cronJobId: string,
		limit = 20,
	): Promise<CronJobRunDTO[]> {
		const rows = await db
			.select()
			.from(cronJobRun)
			.where(eq(cronJobRun.cronJobId, cronJobId))
			.orderBy(desc(cronJobRun.startedAt))
			.limit(limit);
		return rows.map((row) => new CronJobRunDTO(row));
	}

	static async listForUser(
		userId: string,
		limit = 20,
	): Promise<Array<{ jobName: string; run: CronJobRunDTO }>> {
		const rows = await db
			.select({ jobName: cronJob.name, row: cronJobRun })
			.from(cronJobRun)
			.innerJoin(cronJob, eq(cronJobRun.cronJobId, cronJob.id))
			.where(eq(cronJob.userId, userId))
			.orderBy(desc(cronJobRun.startedAt))
			.limit(limit);
		return rows.map((r) => ({
			jobName: r.jobName,
			run: new CronJobRunDTO(r.row),
		}));
	}

	get id(): string {
		return this.row.id;
	}
}
