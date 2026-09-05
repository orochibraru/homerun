import {
	and,
	asc,
	count,
	eq,
	inArray,
	isNull,
	or,
	type SQL,
} from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type Template, template } from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import { BaseDTO } from "./base-dto";

export interface NewTemplateInput {
	category?: string | null;
	containerPort: number;
	cpuLimit?: string | null;
	description?: string | null;
	envVars: Record<string, string>;
	icon?: string | null;
	image: string;
	memoryLimitMb?: number | null;
	name: string;
	ownerId: string;
	restartPolicy: string;
	sourceUrl?: string | null;
	tag: string;
	websiteUrl?: string | null;
}

/** Wraps the `template` table : see ServiceDTO for the pattern this follows. */
export class TemplateDTO extends BaseDTO<Template> {
	/** A built-in (`ownerId` null) or a template owned by `userId` : for deploy-from-template. Never trust a route param alone. */
	static async usable(id: string, userId: string): Promise<TemplateDTO | null> {
		const [row] = await db
			.select()
			.from(template)
			.where(eq(template.id, id))
			.limit(1);
		if (!row) {
			return null;
		}
		if (row.ownerId !== null && row.ownerId !== userId) {
			return null;
		}
		return new TemplateDTO(row);
	}

	/** A template owned by `userId` (never a built-in) : for edit/delete. */
	static async owned(id: string, userId: string): Promise<TemplateDTO | null> {
		const [row] = await db
			.select()
			.from(template)
			.where(eq(template.id, id))
			.limit(1);
		return row && row.ownerId === userId ? new TemplateDTO(row) : null;
	}

	/** Every built-in plus everything `userId` owns : the templates gallery splits the two itself. */
	static async listForUser(userId: string): Promise<TemplateDTO[]> {
		const rows = await db
			.select()
			.from(template)
			.where(or(isNull(template.ownerId), eq(template.ownerId, userId)));
		return rows.map((row) => new TemplateDTO(row));
	}

	/** One page of either the built-in catalog or this user's own templates, searched/filtered server-side. */
	static async listPaged(
		userId: string,
		kind: "builtin" | "mine",
		query: ListQuery,
	): Promise<PagedResult<TemplateDTO>> {
		const conditions: SQL[] = [
			kind === "builtin"
				? isNull(template.ownerId)
				: eq(template.ownerId, userId),
		];
		const search = searchCondition(query.q, [
			template.name,
			template.description,
			template.image,
		]);
		if (search) {
			conditions.push(search);
		}
		const categories = query.filters.category;
		if (categories && categories.length > 0) {
			conditions.push(inArray(template.category, categories));
		}
		const where = and(...conditions);

		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(template)
				.where(where)
				.orderBy(asc(template.name))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(template).where(where),
		]);

		return {
			items: rows.map((row) => new TemplateDTO(row)),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/** Every category present across the built-ins plus this user's own templates, for the gallery's filter pills. */
	static async listCategories(userId: string): Promise<string[]> {
		const rows = await db
			.selectDistinct({ category: template.category })
			.from(template)
			.where(or(isNull(template.ownerId), eq(template.ownerId, userId)));
		return rows
			.map((r) => r.category)
			.filter((c): c is string => Boolean(c))
			.sort();
	}

	static async create(input: NewTemplateInput): Promise<TemplateDTO> {
		const now = new Date();
		const row: Template = {
			category: input.category ?? null,
			containerPort: input.containerPort,
			cpuLimit: input.cpuLimit ?? null,
			createdAt: now,
			description: input.description ?? null,
			envVars: input.envVars,
			icon: input.icon ?? null,
			id: crypto.randomUUID(),
			image: input.image,
			memoryLimitMb: input.memoryLimitMb ?? null,
			name: input.name,
			ownerId: input.ownerId,
			restartPolicy: input.restartPolicy,
			sourceUrl: input.sourceUrl ?? null,
			tag: input.tag,
			updatedAt: now,
			websiteUrl: input.websiteUrl ?? null,
		};
		await db.insert(template).values(row);
		return new TemplateDTO(row);
	}

	get id(): string {
		return this.row.id;
	}
	get ownerId(): string | null {
		return this.row.ownerId;
	}
	get name(): string {
		return this.row.name;
	}
	get isBuiltin(): boolean {
		return this.row.ownerId === null;
	}
}
