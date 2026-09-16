import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type StatusPage,
	service,
	statusPage,
	statusPageService,
} from "$lib/server/db/schema";
import { searchCondition } from "$lib/server/list-query";
import type { StatusPageScope } from "$lib/types";
import { BaseDTO } from "./base-dto";

export interface NewStatusPageInput {
	description?: string | null;
	isPublic?: boolean;
	name: string;
	stackId?: string | null;
	scope: StatusPageScope;
	slug: string;
	userId: string;
}

export type StatusPageUpdateInput = Partial<
	Pick<
		StatusPage,
		"description" | "isPublic" | "name" | "stackId" | "scope" | "slug"
	>
>;

export class StatusPageDTO extends BaseDTO<StatusPage> {
	static async get(id: string, userId: string): Promise<StatusPageDTO | null> {
		const [row] = await db
			.select()
			.from(statusPage)
			.where(and(eq(statusPage.id, id), eq(statusPage.userId, userId)))
			.limit(1);
		return row ? new StatusPageDTO(row) : null;
	}

	static async getPublicBySlug(slug: string): Promise<StatusPageDTO | null> {
		const [row] = await db
			.select()
			.from(statusPage)
			.where(and(eq(statusPage.slug, slug), eq(statusPage.isPublic, true)))
			.limit(1);
		return row ? new StatusPageDTO(row) : null;
	}

	static async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
		const [row] = await db
			.select({ id: statusPage.id })
			.from(statusPage)
			.where(eq(statusPage.slug, slug))
			.limit(1);
		return row !== undefined && row.id !== exceptId;
	}

	static async list(userId: string): Promise<StatusPageDTO[]> {
		const rows = await db
			.select()
			.from(statusPage)
			.where(eq(statusPage.userId, userId))
			.orderBy(asc(statusPage.name));
		return rows.map((row) => new StatusPageDTO(row));
	}

	static async search(
		userId: string,
		q: string,
		limit: number,
	): Promise<StatusPageDTO[]> {
		const rows = await db
			.select()
			.from(statusPage)
			.where(
				and(
					eq(statusPage.userId, userId),
					searchCondition(q, [
						statusPage.name,
						statusPage.slug,
						statusPage.description,
					]),
				),
			)
			.orderBy(asc(statusPage.name))
			.limit(limit);
		return rows.map((row) => new StatusPageDTO(row));
	}

	static async create(input: NewStatusPageInput): Promise<StatusPageDTO> {
		const now = new Date();
		const row: StatusPage = {
			createdAt: now,
			description: input.description ?? null,
			id: crypto.randomUUID(),
			isPublic: input.isPublic ?? false,
			name: input.name,
			stackId: input.stackId ?? null,
			scope: input.scope,
			slug: input.slug,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(statusPage).values(row);
		return new StatusPageDTO(row);
	}

	async update(input: StatusPageUpdateInput): Promise<void> {
		await db
			.update(statusPage)
			.set(input)
			.where(eq(statusPage.id, this.row.id));
		Object.assign(this.row, input);
	}

	async delete(): Promise<void> {
		await db.delete(statusPage).where(eq(statusPage.id, this.row.id));
	}

	async serviceIds(): Promise<string[]> {
		if (this.row.scope === "global") {
			const rows = await db
				.select({ id: service.id })
				.from(service)
				.where(eq(service.userId, this.row.userId));
			return rows.map((r) => r.id);
		}
		if (this.row.scope === "stack") {
			if (!this.row.stackId) {
				return [];
			}
			const rows = await db
				.select({ id: service.id })
				.from(service)
				.where(
					and(
						eq(service.userId, this.row.userId),
						eq(service.stackId, this.row.stackId),
					),
				);
			return rows.map((r) => r.id);
		}
		const rows = await db
			.select({ id: statusPageService.serviceId })
			.from(statusPageService)
			.where(eq(statusPageService.statusPageId, this.row.id));
		return rows.map((r) => r.id);
	}

	async setServiceIds(serviceIds: string[]): Promise<void> {
		await db
			.delete(statusPageService)
			.where(eq(statusPageService.statusPageId, this.row.id));
		if (serviceIds.length === 0) {
			return;
		}
		await db.insert(statusPageService).values(
			serviceIds.map((serviceId) => ({
				id: crypto.randomUUID(),
				serviceId,
				statusPageId: this.row.id,
			})),
		);
	}

	static async listCovering(
		userId: string,
		serviceId: string,
		stackId: string | null,
	): Promise<StatusPageDTO[]> {
		const pages = await StatusPageDTO.list(userId);
		if (pages.length === 0) {
			return [];
		}
		const customIds = await db
			.select({ id: statusPageService.statusPageId })
			.from(statusPageService)
			.where(
				and(
					eq(statusPageService.serviceId, serviceId),
					inArray(
						statusPageService.statusPageId,
						pages.map((p) => p.id),
					),
				),
			);
		const custom = new Set(customIds.map((r) => r.id));
		return pages.filter((page) => {
			if (page.scope === "global") {
				return true;
			}
			if (page.scope === "stack") {
				return stackId !== null && page.stackId === stackId;
			}
			return custom.has(page.id);
		});
	}

	get id(): string {
		return this.row.id;
	}
	get name(): string {
		return this.row.name;
	}
	get slug(): string {
		return this.row.slug;
	}
	get scope(): StatusPageScope {
		return this.row.scope;
	}
	get stackId(): string | null {
		return this.row.stackId;
	}
	get isPublic(): boolean {
		return this.row.isPublic;
	}
	get userId(): string {
		return this.row.userId;
	}
}
