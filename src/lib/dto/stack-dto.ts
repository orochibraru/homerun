import { and, count, desc, eq, inArray, ne, type SQL, sql } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { deployment, type Stack, service, stack } from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import { DockerService } from "$lib/services/docker.service";
import { BaseDTO } from "./base-dto";
import { ServiceDTO } from "./service-dto";

export interface NewStackInput {
	description?: string | null;
	name: string;
	slug: string;
	userId: string;
}

export type StackUpdateInput = Partial<
	Pick<Stack, "description" | "name" | "slug">
>;

/** Wraps the `stack` table : see ServiceDTO for the pattern this follows. */
export class StackDTO extends BaseDTO<Stack> {
	static async get(id: string, userId: string): Promise<StackDTO | null> {
		const [row] = await db
			.select()
			.from(stack)
			.where(and(eq(stack.id, id), eq(stack.userId, userId)))
			.limit(1);
		return row ? new StackDTO(row) : null;
	}

	/** Every stack id on the instance, across all users : for reconciling against what Docker actually has (see DockerService.findOrphanStackNetworks). */
	static async allIds(): Promise<Set<string>> {
		const rows = await db.select({ id: stack.id }).from(stack);
		return new Set(rows.map((row) => row.id));
	}

	static async list(userId: string): Promise<StackDTO[]> {
		const rows = await db
			.select()
			.from(stack)
			.where(eq(stack.userId, userId))
			.orderBy(desc(stack.createdAt));
		return rows.map((row) => new StackDTO(row));
	}

	/** Same as `list`, plus each stack's member-service count, for the stacks gallery. */
	static async listWithServiceCounts(
		userId: string,
	): Promise<Array<{ stack: StackDTO; serviceCount: number }>> {
		const rows = await db
			.select({
				row: stack,
				serviceCount: sql<number>`count(${service.id})`,
			})
			.from(stack)
			.leftJoin(service, eq(service.stackId, stack.id))
			.where(eq(stack.userId, userId))
			.groupBy(stack.id)
			.orderBy(desc(stack.createdAt));
		return rows.map((r) => ({
			stack: new StackDTO(r.row),
			serviceCount: r.serviceCount,
		}));
	}

	/** One page of `listWithServiceCounts`, searched server-side, plus the unpaged total. */
	static async listWithServiceCountsPaged(
		userId: string,
		query: ListQuery,
	): Promise<PagedResult<{ stack: StackDTO; serviceCount: number }>> {
		const conditions: SQL[] = [eq(stack.userId, userId)];
		const search = searchCondition(query.q, [
			stack.name,
			stack.slug,
			stack.description,
		]);
		if (search) {
			conditions.push(search);
		}
		const where = and(...conditions);

		const [rows, totals] = await Promise.all([
			db
				.select({
					row: stack,
					serviceCount: sql<number>`count(${service.id})`,
				})
				.from(stack)
				.leftJoin(service, eq(service.stackId, stack.id))
				.where(where)
				.groupBy(stack.id)
				.orderBy(desc(stack.createdAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(stack).where(where),
		]);

		return {
			items: rows.map((r) => ({
				stack: new StackDTO(r.row),
				serviceCount: r.serviceCount,
			})),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/** Whether `slug` is already taken by a *different* stack (for uniqueness checks on create/update). */
	static async slugTaken(slug: string, excludeId?: string): Promise<boolean> {
		const where = excludeId
			? and(eq(stack.slug, slug), ne(stack.id, excludeId))
			: eq(stack.slug, slug);
		const [row] = await db.select().from(stack).where(where).limit(1);
		return Boolean(row);
	}

	static async search(
		userId: string,
		q: string,
		limit: number,
	): Promise<StackDTO[]> {
		const rows = await db
			.select()
			.from(stack)
			.where(
				and(
					eq(stack.userId, userId),
					searchCondition(q, [stack.name, stack.slug, stack.description]),
				),
			)
			.orderBy(desc(stack.createdAt))
			.limit(limit);
		return rows.map((row) => new StackDTO(row));
	}

	static async create(input: NewStackInput): Promise<StackDTO> {
		const now = new Date();
		const row: Stack = {
			createdAt: now,
			description: input.description ?? null,
			id: crypto.randomUUID(),
			name: input.name,
			slug: input.slug,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(stack).values(row);
		await DockerService.ensureStackNetwork(row.id);
		return new StackDTO(row);
	}

	async update(input: StackUpdateInput): Promise<void> {
		await db.update(stack).set(input).where(eq(stack.id, this.row.id));
		Object.assign(this.row, input);
	}

	/** Row-only delete : does not touch member services/containers. Use `cascadeDelete` for that. */
	async delete(): Promise<void> {
		await db.delete(stack).where(eq(stack.id, this.row.id));
	}

	/**
	 * Deletes this stack and everything in it : stops/removes every member
	 * service's container, deletes their deployment history, deletes the
	 * services, then the stack itself. Same explicit-cleanup precedent as
	 * account deletion (src/lib/services/auth.ts's beforeDelete hook): DB-level
	 * cascade alone would leak running containers.
	 */
	async cascadeDelete(): Promise<void> {
		const services = await ServiceDTO.listByStack(this.row.id, this.row.userId);

		await Promise.all(
			services
				.filter((svc) => svc.containerId)
				.map((svc) =>
					DockerService.removeContainer(svc.containerId as string, {
						force: true,
					}).catch(() => {
						// Already gone on the host : proceed with deleting the record.
					}),
				),
		);

		const serviceIds = services.map((svc) => svc.id);
		if (serviceIds.length > 0) {
			await db
				.delete(deployment)
				.where(inArray(deployment.serviceId, serviceIds));
		}
		await db.delete(service).where(eq(service.stackId, this.row.id));
		await this.delete();
		await DockerService.removeStackNetwork(this.row.id);
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
