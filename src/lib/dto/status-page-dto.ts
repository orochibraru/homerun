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

/**
 * Wraps the `status_page` table : a status page showing the uptime of every
 * service, one stack's services, or a hand-picked set.
 */
export class StatusPageDTO extends BaseDTO<StatusPage> {
	/**
	 * Loads one status page by id, scoped to its owner; null when missing or
	 * owned by someone else.
	 */
	static async get(id: string, userId: string): Promise<StatusPageDTO | null> {
		const [row] = await db
			.select()
			.from(statusPage)
			.where(and(eq(statusPage.id, id), eq(statusPage.userId, userId)))
			.limit(1);
		return row ? new StatusPageDTO(row) : null;
	}

	/**
	 * Loads a status page by slug only when it is public, for the unauthenticated
	 * status page route.
	 */
	static async getPublicBySlug(slug: string): Promise<StatusPageDTO | null> {
		const [row] = await db
			.select()
			.from(statusPage)
			.where(and(eq(statusPage.slug, slug), eq(statusPage.isPublic, true)))
			.limit(1);
		return row ? new StatusPageDTO(row) : null;
	}

	/**
	 * Whether any status page on the instance other than `exceptId` already uses
	 * `slug`.
	 */
	static async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
		const [row] = await db
			.select({ id: statusPage.id })
			.from(statusPage)
			.where(eq(statusPage.slug, slug))
			.limit(1);
		return row !== undefined && row.id !== exceptId;
	}

	/** Every status page the user owns, sorted by name. */
	static async list(userId: string): Promise<StatusPageDTO[]> {
		const rows = await db
			.select()
			.from(statusPage)
			.where(eq(statusPage.userId, userId))
			.orderBy(asc(statusPage.name));
		return rows.map((row) => new StatusPageDTO(row));
	}

	/**
	 * Up to `limit` of the user's status pages whose name, slug or description
	 * matches `q`, for global search.
	 */
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

	/** Inserts a new status page, private unless told otherwise. */
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

	/** Writes the given fields to the row and mirrors them onto this instance. */
	async update(input: StatusPageUpdateInput): Promise<void> {
		await db
			.update(statusPage)
			.set(input)
			.where(eq(statusPage.id, this.row.id));
		Object.assign(this.row, input);
	}

	/** Deletes this status page row. */
	async delete(): Promise<void> {
		await db.delete(statusPage).where(eq(statusPage.id, this.row.id));
	}

	/**
	 * The ids of the services this page shows, resolved from its scope : all of
	 * the owner's services, the services in its stack (none when no stack is
	 * set), or its hand-picked list.
	 */
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

	/**
	 * Replaces the page's hand-picked service list; only read for a custom-scope
	 * page.
	 */
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

	/**
	 * The user's status pages that show a given service : every global page,
	 * stack pages for the service's stack, and custom pages that picked it.
	 */
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

	/** The status page's id. */
	get id(): string {
		return this.row.id;
	}
	/** The status page's display name. */
	get name(): string {
		return this.row.name;
	}
	/** The slug the page is served under. */
	get slug(): string {
		return this.row.slug;
	}
	/** Whether the page covers every service, one stack, or a hand-picked set. */
	get scope(): StatusPageScope {
		return this.row.scope;
	}
	/** The stack a stack-scoped page covers, otherwise null. */
	get stackId(): string | null {
		return this.row.stackId;
	}
	/** Whether the page is viewable without signing in. */
	get isPublic(): boolean {
		return this.row.isPublic;
	}
	/** The id of the user who owns the page. */
	get userId(): string {
		return this.row.userId;
	}
}
