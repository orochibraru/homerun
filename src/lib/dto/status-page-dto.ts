import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "#lib/server/db/lib.js";
import {
	type StatusPage,
	service,
	statusPage,
	statusPageService,
} from "#lib/server/db/schema.js";
import { searchCondition } from "#lib/server/list-query.js";
import {
	resolveStatusPageMembers,
	type StatusPageMember,
	type StatusPagePick,
} from "#lib/status-page-members.js";
import type { StatusPageScope } from "#lib/types.js";
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
	/** Loads one status page by id; null when missing. */
	static async get(id: string): Promise<StatusPageDTO | null> {
		const [row] = await db
			.select()
			.from(statusPage)
			.where(eq(statusPage.id, id))
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

	/** Every status page on the instance, sorted by name. */
	static async list(): Promise<StatusPageDTO[]> {
		const rows = await db
			.select()
			.from(statusPage)
			.orderBy(asc(statusPage.name));
		return rows.map((row) => new StatusPageDTO(row));
	}

	/**
	 * Up to `limit` status pages whose name, slug or description matches `q`,
	 * for global search.
	 */
	static async search(q: string, limit: number): Promise<StatusPageDTO[]> {
		const rows = await db
			.select()
			.from(statusPage)
			.where(
				searchCondition(q, [
					statusPage.name,
					statusPage.slug,
					statusPage.description,
				]),
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
	 * The services this page shows, newest first, resolved from its scope on
	 * every call : every service on the instance, the services in its stack
	 * (none when no stack is set), or its hand-picked list with each pick's
	 * previews and canary right after it when the pick includes them. Pass
	 * the page's `picks` when they're already loaded, to skip reading them
	 * again.
	 */
	async members(picks?: StatusPagePick[]): Promise<StatusPageMember[]> {
		if (this.row.scope === "stack" && !this.row.stackId) {
			return [];
		}
		const custom =
			this.row.scope === "custom" ? (picks ?? (await this.picks())) : null;
		if (custom?.length === 0) {
			return [];
		}
		const picked = custom?.map((pick) => pick.serviceId) ?? [];
		const withChildren =
			custom
				?.filter((pick) => pick.includeChildren)
				.map((pick) => pick.serviceId) ?? [];
		const services = await db
			.select({
				channelCanary: service.channelCanary,
				id: service.id,
				name: service.name,
				previewParentId: service.previewParentId,
				previewPrNumber: service.previewPrNumber,
			})
			.from(service)
			.where(
				custom
					? withChildren.length > 0
						? or(
								inArray(service.id, picked),
								inArray(service.previewParentId, withChildren),
							)
						: inArray(service.id, picked)
					: this.row.scope === "stack" && this.row.stackId
						? eq(service.stackId, this.row.stackId)
						: undefined,
			)
			.orderBy(desc(service.createdAt));
		if (!custom) {
			return services.map((svc) => ({
				childOf: null,
				id: svc.id,
				name: svc.name,
			}));
		}
		return resolveStatusPageMembers(custom, services);
	}

	/** The ids of the services this page shows, see `members`. */
	async serviceIds(): Promise<string[]> {
		return (await this.members()).map((member) => member.id);
	}

	/**
	 * The page's hand-picked services and whether each one brings its previews
	 * and canary along; only read for a custom-scope page.
	 */
	async picks(): Promise<StatusPagePick[]> {
		const rows = await db
			.select({
				includeChildren: statusPageService.includeChildren,
				serviceId: statusPageService.serviceId,
			})
			.from(statusPageService)
			.where(eq(statusPageService.statusPageId, this.row.id));
		return rows;
	}

	/**
	 * Replaces the page's hand-picked service list; only read for a custom-scope
	 * page.
	 */
	async setPicks(picks: StatusPagePick[]): Promise<void> {
		await db
			.delete(statusPageService)
			.where(eq(statusPageService.statusPageId, this.row.id));
		if (picks.length === 0) {
			return;
		}
		await db.insert(statusPageService).values(
			picks.map((pick) => ({
				id: crypto.randomUUID(),
				includeChildren: pick.includeChildren,
				serviceId: pick.serviceId,
				statusPageId: this.row.id,
			})),
		);
	}

	/**
	 * The status pages that show a given service : every global page, stack
	 * pages for the service's stack, and custom pages that picked it.
	 */
	static async listCovering(
		serviceId: string,
		stackId: string | null,
	): Promise<StatusPageDTO[]> {
		const pages = await StatusPageDTO.list();
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
	/** The id of the user who created the page. */
	get userId(): string {
		return this.row.userId;
	}
}
