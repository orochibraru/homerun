import { asc, eq } from "drizzle-orm";
import { db } from "#lib/server/db/lib.js";
import {
	type IacProject,
	type IacStateLock,
	iacProject,
	iacStateLock,
	user,
} from "#lib/server/db/schema.js";
import { BaseDTO } from "./base-dto";

export interface NewIacProjectInput {
	bucket: string;
	name: string;
	prefix: string;
	slug: string;
	storeId: string;
	userId: string;
}

export interface StateLockView {
	createdAt: Date;
	info: Record<string, unknown> | null;
	lockId: string;
	userName: string | null;
}

/** Wraps the `iac_project` table: one Terraform state, kept in a bucket, with its lock. */
export class IacProjectDTO extends BaseDTO<IacProject> {
	/** Loads one project by id; null when missing. */
	static async get(id: string): Promise<IacProjectDTO | null> {
		const [row] = await db
			.select()
			.from(iacProject)
			.where(eq(iacProject.id, id))
			.limit(1);
		return row ? new IacProjectDTO(row) : null;
	}

	/** Whether a project already uses `slug`. */
	static async slugTaken(slug: string): Promise<boolean> {
		const [row] = await db
			.select({ id: iacProject.id })
			.from(iacProject)
			.where(eq(iacProject.slug, slug))
			.limit(1);
		return Boolean(row);
	}

	/** Every project, by name. */
	static async list(): Promise<IacProjectDTO[]> {
		const rows = await db
			.select()
			.from(iacProject)
			.orderBy(asc(iacProject.name));
		return rows.map((row) => new IacProjectDTO(row));
	}

	/** Inserts a project. */
	static async create(input: NewIacProjectInput): Promise<IacProjectDTO> {
		const row: IacProject = {
			...input,
			createdAt: new Date(),
			id: crypto.randomUUID(),
		};
		await db.insert(iacProject).values(row);
		return new IacProjectDTO(row);
	}

	/** Deletes the project and its version and lock rows; the state objects stay in the bucket. */
	async delete(): Promise<void> {
		await db.delete(iacProject).where(eq(iacProject.id, this.row.id));
	}

	/**
	 * Takes the project's lock for `lockId` when nobody holds it, in one
	 * statement so two concurrent `terraform apply`s can't both win.
	 *
	 * @returns The lock that's now held: this one when taken, the existing
	 *   holder's otherwise.
	 */
	async lock(input: {
		info: Record<string, unknown> | null;
		lockId: string;
		userId: string | null;
	}): Promise<IacStateLock> {
		const row: IacStateLock = {
			createdAt: new Date(),
			info: input.info,
			lockId: input.lockId,
			projectId: this.row.id,
			userId: input.userId,
		};
		const [taken] = await db
			.insert(iacStateLock)
			.values(row)
			.onConflictDoNothing()
			.returning();
		return taken ?? ((await this.currentLock()) as IacStateLock);
	}

	/** The lock row, or null while the state is unlocked. */
	async currentLock(): Promise<IacStateLock | null> {
		const [row] = await db
			.select()
			.from(iacStateLock)
			.where(eq(iacStateLock.projectId, this.row.id))
			.limit(1);
		return row ?? null;
	}

	/** The lock with the name of whoever took it, for a page. */
	async lockView(): Promise<StateLockView | null> {
		const [row] = await db
			.select({
				createdAt: iacStateLock.createdAt,
				info: iacStateLock.info,
				lockId: iacStateLock.lockId,
				userName: user.name,
			})
			.from(iacStateLock)
			.leftJoin(user, eq(iacStateLock.userId, user.id))
			.where(eq(iacStateLock.projectId, this.row.id))
			.limit(1);
		return row ?? null;
	}

	/** Drops the lock, whoever holds it. */
	async unlock(): Promise<void> {
		await db
			.delete(iacStateLock)
			.where(eq(iacStateLock.projectId, this.row.id));
	}

	/** The project's id. */
	get id(): string {
		return this.row.id;
	}
	/** The project's display name. */
	get name(): string {
		return this.row.name;
	}
	/** The project's slug, its folder in the bucket. */
	get slug(): string {
		return this.row.slug;
	}
	/** The store holding the state. */
	get storeId(): string {
		return this.row.storeId;
	}
	/** The bucket holding the state. */
	get bucket(): string {
		return this.row.bucket;
	}
	/** The folder inside the bucket that project folders sit under; may be empty. */
	get prefix(): string {
		return this.row.prefix;
	}
}
