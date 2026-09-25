import { describe, expect, test } from "bun:test";
import { desc, sql } from "drizzle-orm";
import { PgDialect, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
	BASE_SORTS,
	STACK_SORTS,
	sortKeysOf,
} from "../../../src/lib/list-sorts";
import {
	DEFAULT_PER_PAGE,
	narrowFilter,
	parseListQuery,
	searchCondition,
	sortOrder,
} from "../../../src/lib/server/list-query";

const url = (query: string) => new URL(`https://homerun.test/services${query}`);

describe("parseListQuery", () => {
	test("defaults to page one of the default size with nothing active", () => {
		expect(parseListQuery(url(""))).toEqual({
			active: false,
			filters: {},
			limit: DEFAULT_PER_PAGE,
			offset: 0,
			page: 1,
			perPage: DEFAULT_PER_PAGE,
			q: "",
			sort: null,
		});
	});

	test("reads an allowed sort key, descending with a leading minus", () => {
		const options = { sortKeys: ["name", "created"] };
		expect(parseListQuery(url("?sort=name"), options).sort).toEqual({
			desc: false,
			key: "name",
		});
		expect(parseListQuery(url("?sort=-created"), options).sort).toEqual({
			desc: true,
			key: "created",
		});
		expect(parseListQuery(url("?sort=password"), options).sort).toBeNull();
		expect(parseListQuery(url("?sort=name")).sort).toBeNull();
	});

	test("turns page and perPage into an offset", () => {
		const query = parseListQuery(url("?page=3&perPage=10"));
		expect(query).toMatchObject({ limit: 10, offset: 20, page: 3 });
	});

	test("caps perPage at 100 and ignores junk, zero and negative values", () => {
		expect(parseListQuery(url("?perPage=5000")).perPage).toBe(100);
		expect(parseListQuery(url("?perPage=abc")).perPage).toBe(DEFAULT_PER_PAGE);
		expect(parseListQuery(url("?perPage=0")).perPage).toBe(DEFAULT_PER_PAGE);
		expect(parseListQuery(url("?page=-2")).page).toBe(1);
		expect(parseListQuery(url("?page=999999")).page).toBe(100_000);
	});

	test("honours a custom page param and default size", () => {
		const query = parseListQuery(url("?page=9&jobsPage=2"), {
			pageParam: "jobsPage",
			perPage: 50,
		});
		expect(query).toMatchObject({ offset: 50, page: 2, perPage: 50 });
	});

	test("trims the search and marks the query active", () => {
		const query = parseListQuery(url("?q=%20%20web%20"));
		expect(query.q).toBe("web");
		expect(query.active).toBe(true);
		expect(parseListQuery(url("?q=%20%20")).active).toBe(false);
	});

	test("reads only the declared filters, split on commas, blanks dropped", () => {
		const query = parseListQuery(
			url("?status=running,%20failed,,&kind=&other=x"),
			{ filterKeys: ["status", "kind"] },
		);
		expect(query.filters).toEqual({ status: ["running", "failed"] });
		expect(query.active).toBe(true);
	});
});

describe("searchCondition", () => {
	const table = pgTable("svc", { name: text("name"), slug: text("slug") });
	const render = (q: string, columns = [table.name, table.slug]) => {
		const condition = searchCondition(q, columns);
		return condition ? new PgDialect().sqlToQuery(condition) : undefined;
	};

	test("is skipped for an empty search or no columns", () => {
		expect(render("")).toBeUndefined();
		expect(render("web", [])).toBeUndefined();
	});

	test("ORs a case-insensitive match over every column", () => {
		const query = render("web");
		expect(query?.sql).toBe('("svc"."name" ilike $1 or "svc"."slug" ilike $2)');
		expect(query?.params).toEqual(["%web%", "%web%"]);
	});

	test("escapes LIKE wildcards and backslashes in the search", () => {
		expect(render("50%_a\\b", [table.name])?.params).toEqual([
			"%50\\%\\_a\\\\b%",
		]);
	});
});

describe("narrowFilter", () => {
	const allowed = ["running", "stopped"] as const;

	test("keeps only allowed values", () => {
		expect(narrowFilter(["running", "bogus", "stopped"], allowed)).toEqual([
			"running",
			"stopped",
		]);
	});

	test("is empty for a missing or empty filter", () => {
		expect(narrowFilter(undefined, allowed)).toEqual([]);
		expect(narrowFilter([], allowed)).toEqual([]);
	});
});

describe("sortOrder", () => {
	const table = pgTable("svc", {
		createdAt: timestamp("created_at"),
		name: text("name"),
	});
	const columns = { created: table.createdAt, name: table.name };
	const fallback = desc(table.createdAt);
	const render = (sort: Parameters<typeof sortOrder>[0]) =>
		new PgDialect().sqlToQuery(
			sql.join(sortOrder(sort, columns, fallback), sql`, `),
		).sql;

	test("falls back to the list's own order without a known sort", () => {
		expect(render(null)).toBe('"svc"."created_at" desc');
		expect(render({ desc: false, key: "services" })).toBe(
			'"svc"."created_at" desc',
		);
	});

	test("sorts text case-insensitively and keeps the fallback as a tie-break", () => {
		expect(render({ desc: false, key: "name" })).toBe(
			'lower("svc"."name") asc, "svc"."created_at" desc',
		);
		expect(render({ desc: true, key: "created" })).toBe(
			'"svc"."created_at" desc, "svc"."created_at" desc',
		);
	});
});

describe("sortKeysOf", () => {
	test("lists each key once, without the descending minus", () => {
		expect(sortKeysOf(STACK_SORTS).sort()).toEqual([
			"created",
			"name",
			"services",
			"updated",
		]);
		expect(sortKeysOf(BASE_SORTS)).not.toContain("services");
	});
});
