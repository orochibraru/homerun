import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

test("docs/config.json lists every docs page exactly once", () => {
	const docs = join(process.cwd(), "docs");
	const config: { categories: { pages: { slug: string }[] }[] } = JSON.parse(
		readFileSync(join(docs, "config.json"), "utf8"),
	);
	const listed = config.categories.flatMap((c) => c.pages.map((p) => p.slug));
	const pages = readdirSync(docs)
		.filter((f) => f.endsWith(".md") && f !== "README.md")
		.map((f) => f.slice(0, -3));
	expect(listed.toSorted()).toEqual(pages.toSorted());
});
