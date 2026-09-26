import {
	and,
	asc,
	count,
	eq,
	inArray,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type Template, template } from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
	sortOrder,
} from "$lib/server/list-query";
import { hasIconImage } from "$lib/service-icon";
import {
	runtimeOptionsFrom,
	type ServiceRuntimeOptions,
} from "$lib/service-runtime";
import { BaseDTO } from "./base-dto";

export interface NewTemplateInput extends Partial<ServiceRuntimeOptions> {
	category?: string | null;
	containerPort: number;
	cpuLimit?: string | null;
	description?: string | null;
	envVars: Record<string, string>;
	healthcheckCommand?: string | null;
	icon?: string | null;
	image: string;
	memoryLimitMb?: number | null;
	name: string;
	ownerId: string;
	restartPolicy: string;
	sourceUrl?: string | null;
	tag: string;
	tags?: string[];
	websiteUrl?: string | null;
}

/** Matches `q` against any one of a template's tags, which `searchCondition` can't do : they're a text[], not a text column. */
function tagSearchCondition(q: string): SQL | undefined {
	const term = q.trim();
	if (!term) {
		return undefined;
	}
	return sql`array_to_string(${template.tags}, ' ') ILIKE ${`%${term}%`}`;
}

/** Wraps the `template` table : see ServiceDTO for the pattern this follows. */
export class TemplateDTO extends BaseDTO<Template> {
	/** A built-in or custom template by id : for deploy-from-template. */
	static async get(id: string): Promise<TemplateDTO | null> {
		const [row] = await db
			.select()
			.from(template)
			.where(eq(template.id, id))
			.limit(1);
		return row ? new TemplateDTO(row) : null;
	}

	/** Every built-in and custom template : the templates gallery splits the two itself. */
	static async list(): Promise<TemplateDTO[]> {
		const rows = await db.select().from(template);
		return rows.map((row) => new TemplateDTO(row));
	}

	/** One page of either the built-in catalog or the instance's custom templates, searched/filtered server-side. */
	static async listPaged(
		kind: "builtin" | "custom",
		query: ListQuery,
	): Promise<PagedResult<TemplateDTO>> {
		const conditions: SQL[] = [
			kind === "builtin"
				? isNull(template.ownerId)
				: isNotNull(template.ownerId),
		];
		const search = or(
			searchCondition(query.q, [
				template.name,
				template.description,
				template.image,
			]),
			tagSearchCondition(query.q),
		);
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
				.orderBy(
					...sortOrder(
						query.sort,
						{
							created: template.createdAt,
							name: template.name,
							updated: template.updatedAt,
						},
						asc(template.name),
					),
				)
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

	/**
	 * The icon library a service can pick from: every built-in template's
	 * icon (a bundled file or a `di:` Dashboard Icon) with that template's
	 * name, one entry per icon, sorted by name.
	 */
	static async listBundledIcons(): Promise<{ icon: string; name: string }[]> {
		const rows = await db
			.select({ icon: template.icon, name: template.name })
			.from(template)
			.where(and(isNull(template.ownerId), isNotNull(template.icon)))
			.orderBy(asc(template.name));
		const seen = new Set<string>();
		const icons: { icon: string; name: string }[] = [];
		for (const row of rows) {
			if (
				hasIconImage(row.icon) &&
				!row.icon.startsWith("data:") &&
				!seen.has(row.icon)
			) {
				seen.add(row.icon);
				icons.push({ icon: row.icon, name: row.name });
			}
		}
		return icons;
	}

	/** Every category present across built-in and custom templates, for the gallery's filter pills. */
	static async listCategories(): Promise<string[]> {
		const rows = await db
			.selectDistinct({ category: template.category })
			.from(template);
		return rows
			.map((r) => r.category)
			.filter((c): c is string => Boolean(c))
			.sort();
	}

	/**
	 * Up to `limit` built-in or custom templates whose name, description, image
	 * or search tags match `q`, sorted by name, for global search.
	 */
	static async search(q: string, limit: number): Promise<TemplateDTO[]> {
		const rows = await db
			.select()
			.from(template)
			.where(
				or(
					searchCondition(q, [
						template.name,
						template.description,
						template.image,
					]),
					tagSearchCondition(q),
				),
			)
			.orderBy(asc(template.name))
			.limit(limit);
		return rows.map((row) => new TemplateDTO(row));
	}

	/** Inserts a new custom template created by `input.ownerId`. */
	static async create(input: NewTemplateInput): Promise<TemplateDTO> {
		const now = new Date();
		const row: Template = {
			...runtimeOptionsFrom(input),
			category: input.category ?? null,
			containerPort: input.containerPort,
			cpuLimit: input.cpuLimit ?? null,
			createdAt: now,
			description: input.description ?? null,
			envVars: input.envVars,
			healthcheckCommand: input.healthcheckCommand ?? null,
			icon: input.icon ?? null,
			id: crypto.randomUUID(),
			image: input.image,
			memoryLimitMb: input.memoryLimitMb ?? null,
			name: input.name,
			ownerId: input.ownerId,
			restartPolicy: input.restartPolicy,
			sourceUrl: input.sourceUrl ?? null,
			tag: input.tag,
			tags: input.tags ?? [],
			updatedAt: now,
			websiteUrl: input.websiteUrl ?? null,
		};
		await db.insert(template).values(row);
		return new TemplateDTO(row);
	}

	/** The template's id. */
	get id(): string {
		return this.row.id;
	}
	/**
	 * The healthcheck command services created from the template start with, if
	 * any.
	 */
	get healthcheckCommand(): string | null {
		return this.row.healthcheckCommand;
	}
	/** The id of the user who created the template, null for a built-in. */
	get ownerId(): string | null {
		return this.row.ownerId;
	}
	/** The command, entrypoint, env files, labels and host access services created from the template start with. */
	get runtimeOptions(): ServiceRuntimeOptions {
		return runtimeOptionsFrom(this.row);
	}
	/** The template's display name. */
	get name(): string {
		return this.row.name;
	}
	/** Whether the template ships with Homerun rather than being user-created. */
	get isBuiltin(): boolean {
		return this.row.ownerId === null;
	}
}
