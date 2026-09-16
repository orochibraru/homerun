import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type StorageVolume, storageVolume } from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import { BaseDTO } from "./base-dto";

export interface NewStorageVolumeInput {
	description?: string | null;
	kind: "bind" | "volume";
	name: string;
	source: string;
	userId: string;
}

export type StorageVolumeUpdateInput = Partial<
	Pick<
		StorageVolume,
		| "backupEnabled"
		| "backupLastRunAt"
		| "backupPrefix"
		| "backupSchedule"
		| "s3DestinationId"
	>
>;

/** Wraps the `storage_volume` table : see ServiceDTO for the pattern this follows. */
export class StorageVolumeDTO extends BaseDTO<StorageVolume> {
	/**
	 * Loads one storage volume by id, scoped to its owner; null when missing or
	 * owned by someone else.
	 */
	static async get(
		id: string,
		userId: string,
	): Promise<StorageVolumeDTO | null> {
		const [row] = await db
			.select()
			.from(storageVolume)
			.where(and(eq(storageVolume.id, id), eq(storageVolume.userId, userId)))
			.limit(1);
		return row ? new StorageVolumeDTO(row) : null;
	}

	/** Every storage volume the user owns, newest first. */
	static async list(userId: string): Promise<StorageVolumeDTO[]> {
		const rows = await db
			.select()
			.from(storageVolume)
			.where(eq(storageVolume.userId, userId))
			.orderBy(desc(storageVolume.createdAt));
		return rows.map((row) => new StorageVolumeDTO(row));
	}

	/** One page of `list`, searched/filtered server-side, plus the unpaged total. */
	static async listPaged(
		userId: string,
		query: ListQuery,
	): Promise<PagedResult<StorageVolumeDTO>> {
		const conditions: SQL[] = [eq(storageVolume.userId, userId)];
		const search = searchCondition(query.q, [
			storageVolume.name,
			storageVolume.source,
			storageVolume.description,
		]);
		if (search) {
			conditions.push(search);
		}
		const kinds = query.filters.kind;
		if (kinds && kinds.length > 0) {
			conditions.push(inArray(storageVolume.kind, kinds));
		}
		const backup = query.filters.backup;
		if (backup && backup.length === 1) {
			conditions.push(eq(storageVolume.backupEnabled, backup[0] === "on"));
		}
		const where = and(...conditions);

		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(storageVolume)
				.where(where)
				.orderBy(desc(storageVolume.createdAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(storageVolume).where(where),
		]);

		return {
			items: rows.map((row) => new StorageVolumeDTO(row)),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/** Every volume (across all users) with scheduled backups turned on : for the scheduler tick, same pattern as ServiceDTO.listCronEnabled. */
	static async listBackupEnabled(): Promise<StorageVolumeDTO[]> {
		const rows = await db
			.select()
			.from(storageVolume)
			.where(eq(storageVolume.backupEnabled, true));
		return rows.map((row) => new StorageVolumeDTO(row));
	}

	/**
	 * Up to `limit` of the user's volumes whose name, source or description
	 * matches `q`, newest first, for global search.
	 */
	static async search(
		userId: string,
		q: string,
		limit: number,
	): Promise<StorageVolumeDTO[]> {
		const rows = await db
			.select()
			.from(storageVolume)
			.where(
				and(
					eq(storageVolume.userId, userId),
					searchCondition(q, [
						storageVolume.name,
						storageVolume.source,
						storageVolume.description,
					]),
				),
			)
			.orderBy(desc(storageVolume.createdAt))
			.limit(limit);
		return rows.map((row) => new StorageVolumeDTO(row));
	}

	/**
	 * Inserts a new volume record with backups off. Only the row : the Docker
	 * volume or host path isn't touched.
	 */
	static async create(input: NewStorageVolumeInput): Promise<StorageVolumeDTO> {
		const now = new Date();
		const row: StorageVolume = {
			backupEnabled: false,
			backupLastRunAt: null,
			backupPrefix: null,
			backupSchedule: null,
			createdAt: now,
			description: input.description ?? null,
			id: crypto.randomUUID(),
			kind: input.kind,
			name: input.name,
			s3DestinationId: null,
			source: input.source,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(storageVolume).values(row);
		return new StorageVolumeDTO(row);
	}

	/**
	 * Writes the given backup fields to the row and mirrors them onto this
	 * instance.
	 */
	async update(input: StorageVolumeUpdateInput): Promise<void> {
		await db
			.update(storageVolume)
			.set(input)
			.where(eq(storageVolume.id, this.row.id));
		Object.assign(this.row, input);
	}

	/** Row-only delete : the `service_volume` FK is `onDelete: cascade`, so any mounts referencing this volume go with it. */
	async delete(): Promise<void> {
		await db.delete(storageVolume).where(eq(storageVolume.id, this.row.id));
	}

	/** The volume's id. */
	get id(): string {
		return this.row.id;
	}
	/** The id of the user who owns the volume. */
	get userId(): string {
		return this.row.userId;
	}
	/** The volume's display name. */
	get name(): string {
		return this.row.name;
	}
	/** Whether it is a host bind mount or a named Docker volume. */
	get kind(): StorageVolume["kind"] {
		return this.row.kind;
	}
	/** The host path for a bind mount, or the Docker volume name. */
	get source(): string {
		return this.row.source;
	}
	/** Whether scheduled S3 backups are on for this volume. */
	get backupEnabled(): boolean {
		return this.row.backupEnabled;
	}
	/** The backup cron expression, if one is set. */
	get backupSchedule(): string | null {
		return this.row.backupSchedule;
	}
	/** When the last scheduled backup started, null if never. */
	get backupLastRunAt(): Date | null {
		return this.row.backupLastRunAt;
	}
	/** The key prefix backups are uploaded under, if one is set. */
	get backupPrefix(): string | null {
		return this.row.backupPrefix;
	}
	/** The S3 destination backups go to, if one is chosen. */
	get s3DestinationId(): string | null {
		return this.row.s3DestinationId;
	}
}
