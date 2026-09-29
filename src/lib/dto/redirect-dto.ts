import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type Redirect, redirect } from "$lib/server/db/schema";
import {
	type ListQuery,
	type PagedResult,
	searchCondition,
	sortOrder,
} from "$lib/server/list-query";
import { BaseDTO } from "./base-dto";

export interface RedirectFields {
	destination: string;
	enabled: boolean;
	keepPath: boolean;
	permanent: boolean;
	source: string;
}

/** Wraps the `redirect` table : see ServiceDTO for the pattern this follows. */
export class RedirectDTO extends BaseDTO<Redirect> {
	/** Loads one redirect by id; null when missing. */
	static async get(id: string): Promise<RedirectDTO | null> {
		const [row] = await db
			.select()
			.from(redirect)
			.where(eq(redirect.id, id))
			.limit(1);
		return row ? new RedirectDTO(row) : null;
	}

	/** Loads the redirect for an exact source; null when none. */
	static async getBySource(source: string): Promise<RedirectDTO | null> {
		const [row] = await db
			.select()
			.from(redirect)
			.where(eq(redirect.source, source))
			.limit(1);
		return row ? new RedirectDTO(row) : null;
	}

	/** Every redirect on the instance, newest first. */
	static async list(): Promise<RedirectDTO[]> {
		const rows = await db
			.select()
			.from(redirect)
			.orderBy(desc(redirect.createdAt));
		return rows.map((row) => new RedirectDTO(row));
	}

	/** One page of `list`, searched server-side, plus the unpaged total. */
	static async listPaged(query: ListQuery): Promise<PagedResult<RedirectDTO>> {
		const conditions: SQL[] = [];
		const search = searchCondition(query.q, [
			redirect.source,
			redirect.destination,
		]);
		if (search) {
			conditions.push(search);
		}
		const where = and(...conditions);

		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(redirect)
				.where(where)
				.orderBy(
					...sortOrder(
						query.sort,
						{
							created: redirect.createdAt,
							name: redirect.source,
							updated: redirect.updatedAt,
						},
						desc(redirect.createdAt),
					),
				)
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(redirect).where(where),
		]);

		return {
			items: rows.map((row) => new RedirectDTO(row)),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/** Inserts a new redirect. */
	static async create(
		input: RedirectFields & { userId: string },
	): Promise<RedirectDTO> {
		const now = new Date();
		const row: Redirect = {
			...input,
			createdAt: now,
			id: crypto.randomUUID(),
			updatedAt: now,
		};
		await db.insert(redirect).values(row);
		return new RedirectDTO(row);
	}

	/** Saves edited redirect fields. */
	async update(fields: RedirectFields): Promise<void> {
		const patch = { ...fields, updatedAt: new Date() };
		await db.update(redirect).set(patch).where(eq(redirect.id, this.row.id));
		Object.assign(this.row, patch);
	}

	/** Deletes this redirect row. */
	async delete(): Promise<void> {
		await db.delete(redirect).where(eq(redirect.id, this.row.id));
	}
}
