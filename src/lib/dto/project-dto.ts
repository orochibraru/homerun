import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	deployment,
	type Project,
	project,
	service,
} from "$lib/server/db/schema";
import {
	ensureProjectNetwork,
	removeProjectNetwork,
} from "$lib/server/docker/networks";
import { removeContainer } from "$lib/server/docker/service";
import { BaseDTO } from "./base-dto";
import { ServiceDTO } from "./service-dto";

export interface NewProjectInput {
	description?: string | null;
	name: string;
	slug: string;
	userId: string;
}

export type ProjectUpdateInput = Partial<
	Pick<Project, "description" | "name" | "slug">
>;

/** Wraps the `project` table — see ServiceDTO for the pattern this follows. */
export class ProjectDTO extends BaseDTO<Project> {
	static async get(id: string, userId: string): Promise<ProjectDTO | null> {
		const [row] = await db
			.select()
			.from(project)
			.where(and(eq(project.id, id), eq(project.userId, userId)))
			.limit(1);
		return row ? new ProjectDTO(row) : null;
	}

	static async list(userId: string): Promise<ProjectDTO[]> {
		const rows = await db
			.select()
			.from(project)
			.where(eq(project.userId, userId))
			.orderBy(desc(project.createdAt));
		return rows.map((row) => new ProjectDTO(row));
	}

	/** Same as `list`, plus each project's member-service count, for the projects gallery. */
	static async listWithServiceCounts(
		userId: string,
	): Promise<Array<{ project: ProjectDTO; serviceCount: number }>> {
		const rows = await db
			.select({
				row: project,
				serviceCount: sql<number>`count(${service.id})`,
			})
			.from(project)
			.leftJoin(service, eq(service.projectId, project.id))
			.where(eq(project.userId, userId))
			.groupBy(project.id)
			.orderBy(desc(project.createdAt));
		return rows.map((r) => ({
			project: new ProjectDTO(r.row),
			serviceCount: r.serviceCount,
		}));
	}

	/** Whether `slug` is already taken by a *different* project (for uniqueness checks on create/update). */
	static async slugTaken(slug: string, excludeId?: string): Promise<boolean> {
		const where = excludeId
			? and(eq(project.slug, slug), ne(project.id, excludeId))
			: eq(project.slug, slug);
		const [row] = await db.select().from(project).where(where).limit(1);
		return Boolean(row);
	}

	static async create(input: NewProjectInput): Promise<ProjectDTO> {
		const now = new Date();
		const row: Project = {
			createdAt: now,
			description: input.description ?? null,
			id: crypto.randomUUID(),
			name: input.name,
			slug: input.slug,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(project).values(row);
		await ensureProjectNetwork(row.id);
		return new ProjectDTO(row);
	}

	async update(input: ProjectUpdateInput): Promise<void> {
		await db.update(project).set(input).where(eq(project.id, this.row.id));
		Object.assign(this.row, input);
	}

	/** Row-only delete — does not touch member services/containers. Use `cascadeDelete` for that. */
	async delete(): Promise<void> {
		await db.delete(project).where(eq(project.id, this.row.id));
	}

	/**
	 * Deletes this project and everything in it — stops/removes every member
	 * service's container, deletes their deployment history, deletes the
	 * services, then the project itself. Same explicit-cleanup precedent as
	 * account deletion (src/lib/server/auth.ts's beforeDelete hook): DB-level
	 * cascade alone would leak running containers.
	 */
	async cascadeDelete(): Promise<void> {
		const services = await ServiceDTO.listByProject(
			this.row.id,
			this.row.userId,
		);

		await Promise.all(
			services
				.filter((svc) => svc.containerId)
				.map((svc) =>
					removeContainer(svc.containerId as string, { force: true }).catch(
						() => {
							// Already gone on the host — proceed with deleting the record.
						},
					),
				),
		);

		const serviceIds = services.map((svc) => svc.id);
		if (serviceIds.length > 0) {
			await db
				.delete(deployment)
				.where(inArray(deployment.serviceId, serviceIds));
		}
		await db.delete(service).where(eq(service.projectId, this.row.id));
		await this.delete();
		await removeProjectNetwork(this.row.id);
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
	get description(): string | null {
		return this.row.description;
	}
	get slug(): string {
		return this.row.slug;
	}
}
