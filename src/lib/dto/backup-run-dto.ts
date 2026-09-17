import {
	and,
	count,
	desc,
	eq,
	inArray,
	isNull,
	or,
	type SQL,
} from "drizzle-orm";
import type { BackupRunKind } from "$lib/revision-config";
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
	/**
	 * Inserts a new in-progress run for a volume, stamped as started now with
	 * no outcome yet : a backup by default, or a restore of `options.key`.
	 */
	static async create(
		volumeId: string,
		options: { key?: string | null; kind?: BackupRunKind } = {},
	): Promise<BackupRunDTO> {
		const row: BackupRun = {
			error: null,
			finishedAt: null,
			id: crypto.randomUUID(),
			key: options.key ?? null,
			kind: options.kind ?? "backup",
			sizeBytes: null,
			startedAt: new Date(),
			success: null,
			volumeId,
		};
		await db.insert(backupRun).values(row);
		return new BackupRunDTO(row);
	}

	/**
	 * Records a run's outcome and finish time, updating both the row and this
	 * instance.
	 */
	async finish(result: {
		error?: string;
		key?: string;
		sizeBytes?: number;
		success: boolean;
	}): Promise<void> {
		const patch = {
			error: result.error ?? null,
			finishedAt: new Date(),
			key: result.key ?? this.row.key,
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
	 * Every run across every volume, newest first, with
	 * the volume's own name joined in : for the dashboard Backups page,
	 * which lists across volumes rather than one volume at a time.
	 */
	static async listRecent(
		limit = 50,
	): Promise<Array<{ run: BackupRunDTO; volumeName: string }>> {
		const rows = await db
			.select({ row: backupRun, volumeName: storageVolume.name })
			.from(backupRun)
			.innerJoin(storageVolume, eq(backupRun.volumeId, storageVolume.id))
			.orderBy(desc(backupRun.startedAt))
			.limit(limit);
		return rows.map((r) => ({
			run: new BackupRunDTO(r.row),
			volumeName: r.volumeName,
		}));
	}

	/** One page of `listRecent`, searched/filtered server-side, plus the unpaged total : this history grows without bound, so the page can't just load "the newest 50" and filter those client-side. */
	static async listPaged(
		query: ListQuery,
	): Promise<PagedResult<{ run: BackupRunDTO; volumeName: string }>> {
		const conditions: SQL[] = [];
		const search = searchCondition(query.q, [
			storageVolume.name,
			backupRun.error,
			backupRun.key,
		]);
		if (search) {
			conditions.push(search);
		}
		const kinds = query.filters.kind;
		if (kinds && kinds.length > 0) {
			conditions.push(inArray(backupRun.kind, kinds as BackupRunKind[]));
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
