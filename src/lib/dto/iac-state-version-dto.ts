import { and, desc, eq } from "drizzle-orm";
import { db } from "#lib/server/db/lib.js";
import {
	type IacStateVersion,
	iacStateVersion,
	user,
} from "#lib/server/db/schema.js";
import { BaseDTO } from "./base-dto";

export interface StateVersionView {
	createdAt: Date;
	id: string;
	rollbackOfId: string | null;
	serial: number;
	sizeBytes: number;
	userName: string | null;
}

/** Wraps the `iac_state_version` table: one written Terraform state, its body kept in the bucket. */
export class IacStateVersionDTO extends BaseDTO<IacStateVersion> {
	/** One version of a project; null when missing. */
	static async get(
		projectId: string,
		id: string,
	): Promise<IacStateVersionDTO | null> {
		const [row] = await db
			.select()
			.from(iacStateVersion)
			.where(
				and(
					eq(iacStateVersion.projectId, projectId),
					eq(iacStateVersion.id, id),
				),
			)
			.limit(1);
		return row ? new IacStateVersionDTO(row) : null;
	}

	/** The project's newest version, or null before its first write. */
	static async latest(projectId: string): Promise<IacStateVersionDTO | null> {
		const [row] = await db
			.select()
			.from(iacStateVersion)
			.where(eq(iacStateVersion.projectId, projectId))
			.orderBy(desc(iacStateVersion.createdAt))
			.limit(1);
		return row ? new IacStateVersionDTO(row) : null;
	}

	/** The version written just before `version`, or null for the first one. */
	static async previous(
		version: IacStateVersionDTO,
	): Promise<IacStateVersionDTO | null> {
		const rows = await db
			.select()
			.from(iacStateVersion)
			.where(eq(iacStateVersion.projectId, version.projectId))
			.orderBy(desc(iacStateVersion.createdAt));
		const index = rows.findIndex((row) => row.id === version.id);
		const row = index === -1 ? undefined : rows[index + 1];
		return row ? new IacStateVersionDTO(row) : null;
	}

	/** Up to `limit` versions of a project, newest first, with who wrote each. */
	static async history(
		projectId: string,
		limit = 100,
	): Promise<StateVersionView[]> {
		return await db
			.select({
				createdAt: iacStateVersion.createdAt,
				id: iacStateVersion.id,
				rollbackOfId: iacStateVersion.rollbackOfId,
				serial: iacStateVersion.serial,
				sizeBytes: iacStateVersion.sizeBytes,
				userName: user.name,
			})
			.from(iacStateVersion)
			.leftJoin(user, eq(iacStateVersion.userId, user.id))
			.where(eq(iacStateVersion.projectId, projectId))
			.orderBy(desc(iacStateVersion.createdAt))
			.limit(limit);
	}

	/** Records a version whose body is already in the bucket. */
	static async create(row: IacStateVersion): Promise<IacStateVersionDTO> {
		await db.insert(iacStateVersion).values(row);
		return new IacStateVersionDTO(row);
	}

	/** The version's id. */
	get id(): string {
		return this.row.id;
	}
	/** The project it belongs to. */
	get projectId(): string {
		return this.row.projectId;
	}
	/** Terraform's serial for this state. */
	get serial(): number {
		return this.row.serial;
	}
	/** Terraform's lineage for this state. */
	get lineage(): string | null {
		return this.row.lineage;
	}
	/** Where the body sits in the project's bucket. */
	get objectKey(): string {
		return this.row.objectKey;
	}
	/** The body's MD5, hex. */
	get md5(): string {
		return this.row.md5;
	}
}
