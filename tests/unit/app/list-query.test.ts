import { describe, expect, test } from "bun:test";
import { PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import {
	DEFAULT_PER_PAGE,
	narrowFilter,
	parseListQuery,
	searchCondition,
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
		});
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
