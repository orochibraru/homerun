import { ilike, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const DEFAULT_PER_PAGE = 25;

const MAX_PER_PAGE = 100;

export interface ListQuery {
	active: boolean;
	filters: Record<string, string[]>;
	limit: number;
	offset: number;
	page: number;
	perPage: number;
	q: string;
}

export interface PagedResult<T> {
	items: T[];
	page: number;
	perPage: number;
	total: number;
}

function positiveInt(
	raw: string | null,
	fallback: number,
	max: number,
): number {
	const parsed = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return fallback;
	}
	return Math.min(parsed, max);
}

export function parseListQuery(
	url: URL,
	options: { filterKeys?: string[]; pageParam?: string; perPage?: number } = {},
): ListQuery {
	const pageParam = options.pageParam ?? "page";
	const perPage = positiveInt(
		url.searchParams.get("perPage"),
		options.perPage ?? DEFAULT_PER_PAGE,
		MAX_PER_PAGE,
	);
	const page = positiveInt(url.searchParams.get(pageParam), 1, 100_000);

	const filters: Record<string, string[]> = {};
	for (const key of options.filterKeys ?? []) {
		const raw = url.searchParams.get(key);
		const values = raw
			? raw
					.split(",")
					.map((v) => v.trim())
					.filter(Boolean)
			: [];
		if (values.length > 0) {
			filters[key] = values;
		}
	}

	const q = (url.searchParams.get("q") ?? "").trim();

	return {
		active: Boolean(q) || Object.keys(filters).length > 0,
		filters,
		limit: perPage,
		offset: (page - 1) * perPage,
		page,
		perPage,
		q,
	};
}

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function searchCondition(
	q: string,
	columns: AnyPgColumn[],
): SQL | undefined {
	if (!q || columns.length === 0) {
		return undefined;
	}
	const pattern = `%${escapeLike(q)}%`;
	return or(...columns.map((column) => ilike(column, pattern)));
}

export function narrowFilter<T extends string>(
	values: string[] | undefined,
	allowed: readonly T[],
): T[] {
	if (!values || values.length === 0) {
		return [];
	}
	const permitted = new Set<string>(allowed);
	return values.filter((value): value is T => permitted.has(value));
}
