import { and, desc, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type StorageVolume, storageVolume } from "$lib/server/db/schema";
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

	static async list(userId: string): Promise<StorageVolumeDTO[]> {
		const rows = await db
			.select()
			.from(storageVolume)
			.where(eq(storageVolume.userId, userId))
			.orderBy(desc(storageVolume.createdAt));
		return rows.map((row) => new StorageVolumeDTO(row));
	}

	/** Every volume (across all users) with scheduled backups turned on : for the scheduler tick, same pattern as ServiceDTO.listCronEnabled. */
	static async listBackupEnabled(): Promise<StorageVolumeDTO[]> {
		const rows = await db
			.select()
			.from(storageVolume)
			.where(eq(storageVolume.backupEnabled, true));
		return rows.map((row) => new StorageVolumeDTO(row));
	}

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

	get id(): string {
		return this.row.id;
	}
	get userId(): string {
		return this.row.userId;
	}
	get name(): string {
		return this.row.name;
	}
	get kind(): StorageVolume["kind"] {
		return this.row.kind;
	}
	get source(): string {
		return this.row.source;
	}
	get backupEnabled(): boolean {
		return this.row.backupEnabled;
	}
	get backupSchedule(): string | null {
		return this.row.backupSchedule;
	}
	get backupLastRunAt(): Date | null {
		return this.row.backupLastRunAt;
	}
	get backupPrefix(): string | null {
		return this.row.backupPrefix;
	}
	get s3DestinationId(): string | null {
		return this.row.s3DestinationId;
	}
}
