import { describe, expect, test } from "bun:test";
import { permissionsForRole } from "../../../src/lib/permissions";
import {
	filterPages,
	groupResults,
	matchesSearch,
	SEARCH_PAGES,
	type SearchResult,
} from "../../../src/lib/search";

describe("matchesSearch", () => {
	test("matches case-insensitively on any field", () => {
		expect(matchesSearch("GIT", ["nope", "GitHub"])).toBe(true);
	});

	test("ignores null fields and blank queries", () => {
		expect(matchesSearch("x", [null, undefined])).toBe(false);
		expect(matchesSearch("   ", ["anything"])).toBe(false);
	});
});

describe("filterPages", () => {
	const developer = permissionsForRole("developer", null);
	const admin = permissionsForRole("admin", null);

	test("hides pages a developer can't read", () => {
		const hrefs = filterPages(SEARCH_PAGES, "", developer).map((p) => p.href);
		expect(hrefs).toContain("/services");
		expect(hrefs).not.toContain("/settings");
		expect(hrefs).not.toContain("/users");
	});

	test("shows settings pages to an admin", () => {
		const hrefs = filterPages(SEARCH_PAGES, "smtp", admin).map((p) => p.href);
		expect(hrefs).toEqual(["/settings/email"]);
	});

	test("matches on keywords, not only the label", () => {
		const hrefs = filterPages(SEARCH_PAGES, "dark mode", developer).map(
			(p) => p.href,
		);
		expect(hrefs).toEqual(["/profile/appearance"]);
	});

	test("finds the stacks page", () => {
		const hrefs = filterPages(SEARCH_PAGES, "stacks", developer).map(
			(p) => p.href,
		);
		expect(hrefs).toContain("/stacks");
	});

	test("never lists a page twice", () => {
		const hrefs = SEARCH_PAGES.map((p) => p.href);
		expect(new Set(hrefs).size).toBe(hrefs.length);
	});
});

describe("groupResults", () => {
	test("groups by kind in first-seen order with the UI heading", () => {
		const result = (kind: SearchResult["kind"], id: string): SearchResult => ({
			detail: null,
			href: `/${id}`,
			id,
			kind,
			label: id,
		});
		const groups = groupResults([
			result("service", "a"),
			result("stack", "b"),
			result("service", "c"),
		]);
		expect(groups.map((g) => g.heading)).toEqual(["Services", "Stacks"]);
		expect(groups[0]?.results.map((r) => r.id)).toEqual(["a", "c"]);
	});
});
