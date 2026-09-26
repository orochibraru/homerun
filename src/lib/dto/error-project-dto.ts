import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type ErrorProject, errorProject } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export type ErrorProjectSettings = Partial<
	Pick<ErrorProject, "enabled" | "injectEnv" | "internalDsn">
>;

/** Wraps `error_project`: a service's error tracking switch, its numeric Sentry project id and the public key its DSN carries. */
export class ErrorProjectDTO extends BaseDTO<ErrorProject> {
	get id(): string {
		return this.row.id;
	}

	get projectId(): number {
		return this.row.projectId;
	}

	get publicKey(): string {
		return this.row.publicKey;
	}

	get serviceId(): string {
		return this.row.serviceId;
	}

	get enabled(): boolean {
		return this.row.enabled;
	}

	/** A service's project, or null when error tracking was never turned on for it. */
	static async getForService(
		serviceId: string,
	): Promise<ErrorProjectDTO | null> {
		const [row] = await db
			.select()
			.from(errorProject)
			.where(eq(errorProject.serviceId, serviceId))
			.limit(1);
		return row ? new ErrorProjectDTO(row) : null;
	}

	/** The project an ingest request's numeric id names, or null. */
	static async getByProjectId(
		projectId: number,
	): Promise<ErrorProjectDTO | null> {
		const [row] = await db
			.select()
			.from(errorProject)
			.where(eq(errorProject.projectId, projectId))
			.limit(1);
		return row ? new ErrorProjectDTO(row) : null;
	}

	/** Creates a service's project with a fresh random public key, enabled and injecting its env. */
	static async create(serviceId: string): Promise<ErrorProjectDTO> {
		const [row] = await db
			.insert(errorProject)
			.values({
				createdAt: new Date(),
				id: crypto.randomUUID(),
				publicKey: randomBytes(16).toString("hex"),
				serviceId,
			})
			.returning();
		return new ErrorProjectDTO(row);
	}

	/** Saves the project's switches. */
	async update(fields: ErrorProjectSettings): Promise<void> {
		const [row] = await db
			.update(errorProject)
			.set(fields)
			.where(eq(errorProject.id, this.row.id))
			.returning();
		Object.assign(this.row, row);
	}

	/** Replaces the public key, so every DSN handed out before stops being accepted. */
	async rotateKey(): Promise<void> {
		const [row] = await db
			.update(errorProject)
			.set({ publicKey: randomBytes(16).toString("hex") })
			.where(eq(errorProject.id, this.row.id))
			.returning();
		Object.assign(this.row, row);
	}
}
