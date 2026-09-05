import { and, count, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type BackupRun,
	backupRun,
	storageVolume,
} from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import { BaseDTO } from "./base-dto";

/** Wraps the `backup_run` table : see ServiceDTO for the pattern this follows. */
export class BackupRunDTO extends BaseDTO<BackupRun> {
	static async create(volumeId: string): Promise<BackupRunDTO> {
		const row: BackupRun = {
			error: null,
			finishedAt: null,
			id: crypto.randomUUID(),
			sizeBytes: null,
			startedAt: new Date(),
			success: null,
			volumeId,
		};
		await db.insert(backupRun).values(row);
		return new BackupRunDTO(row);
	}

	async finish(result: {
		error?: string;
		sizeBytes?: number;
		success: boolean;
	}): Promise<void> {
		const patch = {
			error: result.error ?? null,
			finishedAt: new Date(),
			sizeBytes: result.sizeBytes ?? null,
			success: result.success,
		};
		await db.update(backupRun).set(patch).where(eq(backupRun.id, this.row.id));
		Object.assign(this.row, patch);
	}

	/** Most recent runs for one volume, newest first. */
	static async listForVolume(
		volumeId: string,
		limit = 20,
	): Promise<BackupRunDTO[]> {
		const rows = await db
			.select()
			.from(backupRun)
			.where(eq(backupRun.volumeId, volumeId))
			.orderBy(desc(backupRun.startedAt))
			.limit(limit);
		return rows.map((row) => new BackupRunDTO(row));
	}

	/**
	 * Every run across every one of this user's volumes, newest first, with
	 * the volume's own name joined in : for the dashboard Backups page,
	 * which lists across volumes rather than one volume at a time.
	 */
	static async listForUser(
		userId: string,
		limit = 50,
	): Promise<Array<{ run: BackupRunDTO; volumeName: string }>> {
		const rows = await db
			.select({ row: backupRun, volumeName: storageVolume.name })
			.from(backupRun)
			.innerJoin(storageVolume, eq(backupRun.volumeId, storageVolume.id))
			.where(eq(storageVolume.userId, userId))
			.orderBy(desc(backupRun.startedAt))
			.limit(limit);
		return rows.map((r) => ({
			run: new BackupRunDTO(r.row),
			volumeName: r.volumeName,
		}));
	}

	/** One page of `listForUser`, searched/filtered server-side, plus the unpaged total : this history grows without bound, so the page can't just load "the newest 50" and filter those client-side. */
	static async listForUserPaged(
		userId: string,
		query: ListQuery,
	): Promise<PagedResult<{ run: BackupRunDTO; volumeName: string }>> {
		const conditions: SQL[] = [eq(storageVolume.userId, userId)];
		const search = searchCondition(query.q, [
			storageVolume.name,
			backupRun.error,
		]);
		if (search) {
			conditions.push(search);
		}
		const outcomes = query.filters.outcome;
		if (outcomes && outcomes.length > 0) {
			const parts: SQL[] = [];
			if (outcomes.includes("running")) {
				parts.push(isNull(backupRun.success));
			}
			if (outcomes.includes("success")) {
				parts.push(eq(backupRun.success, true));
			}
			if (outcomes.includes("failed")) {
				parts.push(eq(backupRun.success, false));
			}
			const combined = or(...parts);
			if (combined) {
				conditions.push(combined);
			}
		}
		const where = and(...conditions);

		const [rows, totals] = await Promise.all([
			db
				.select({ row: backupRun, volumeName: storageVolume.name })
				.from(backupRun)
				.innerJoin(storageVolume, eq(backupRun.volumeId, storageVolume.id))
				.where(where)
				.orderBy(desc(backupRun.startedAt))
				.limit(query.limit)
				.offset(query.offset),
			db
				.select({ total: count() })
				.from(backupRun)
				.innerJoin(storageVolume, eq(backupRun.volumeId, storageVolume.id))
				.where(where),
		]);

		return {
			items: rows.map((r) => ({
				run: new BackupRunDTO(r.row),
				volumeName: r.volumeName,
			})),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}
}
