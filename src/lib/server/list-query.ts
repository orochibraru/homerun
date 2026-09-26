import { asc, desc, ilike, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS } from "$lib/list-sorts";

export { DEFAULT_PER_PAGE };

const MAX_PER_PAGE = Math.max(...PER_PAGE_OPTIONS);

export interface ListSort {
	desc: boolean;
	key: string;
}

export interface ListQuery {
	active: boolean;
	filters: Record<string, string[]>;
	limit: number;
	offset: number;
	page: number;
	perPage: number;
	q: string;
	sort: ListSort | null;
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

/**
 * An account's saved page size when it's one of `PER_PAGE_OPTIONS`, otherwise
 * the instance default.
 */
export function resolvePerPage(value: number | null | undefined): number {
	return (
		PER_PAGE_OPTIONS.find((option) => option === value) ?? DEFAULT_PER_PAGE
	);
}

/**
 * Reads a list page's `page`, `perPage` (capped at 200), `q`, `sort` and
 * comma-separated filter params from the URL, falling back to defaults for
 * anything missing or invalid. `sort` is a key with an optional leading `-`
 * for descending (`name`, `-created`).
 *
 * @param options.filterKeys Query params to read as multi-value filters; any
 * other params are ignored.
 * @param options.pageParam Name of the page param, for pages that page more
 * than one list.
 * @param options.perPage Default page size when the URL doesn't set one,
 * ahead of `userPerPage`.
 * @param options.sortKeys Sort keys the list accepts; any other is ignored.
 * @param userPerPage The signed-in account's saved page size, used when
 * neither the URL nor `options.perPage` sets one; anything outside
 * `PER_PAGE_OPTIONS` falls back to the instance default.
 */
export function parseListQuery(
	url: URL,
	options: {
		filterKeys?: string[];
		pageParam?: string;
		perPage?: number;
		sortKeys?: string[];
	} = {},
	userPerPage?: number | null,
): ListQuery {
	const pageParam = options.pageParam ?? "page";
	const perPage = positiveInt(
		url.searchParams.get("perPage"),
		options.perPage ?? resolvePerPage(userPerPage),
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
	const rawSort = (url.searchParams.get("sort") ?? "").trim();
	const sortKey = rawSort.replace(/^-/, "");
	const sort =
		sortKey && options.sortKeys?.includes(sortKey)
			? { desc: rawSort.startsWith("-"), key: sortKey }
			: null;

	return {
		active: Boolean(q) || Object.keys(filters).length > 0,
		filters,
		limit: perPage,
		offset: (page - 1) * perPage,
		page,
		perPage,
		q,
		sort,
	};
}

/**
 * The ORDER BY for a list: the sort the URL asked for when `columns` knows its
 * key (a text column compared case-insensitively), then `fallback`, which is
 * also the whole order when nothing valid was asked for.
 */
export function sortOrder(
	sort: ListSort | null,
	columns: Record<string, AnyPgColumn | SQL>,
	fallback: SQL,
): SQL[] {
	const column = sort ? columns[sort.key] : undefined;
	if (!(sort && column)) {
		return [fallback];
	}
	const target =
		"columnType" in column && column.columnType === "PgText"
			? sql`lower(${column})`
			: column;
	return [sort.desc ? desc(target) : asc(target), fallback];
}

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * A case-insensitive substring match of `q` against any of the columns, with
 * LIKE wildcards in `q` escaped.
 *
 * @returns Undefined when `q` is empty, so callers can skip the condition.
 */
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

/**
 * Keeps only the filter values found in `allowed`, so values from the URL can
 * be used as a typed enum in a query.
 */
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
