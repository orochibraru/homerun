import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const INDEPENDENT = new Set(["@better-auth/utils"]);
const RESOLVED_RE =
	/"[^"]*": \["((?:@better-auth\/[a-z-]+)|better-auth)@([^"]+)"/g;

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
const version: string = manifest.dependencies["better-auth"];

function family(name: string): boolean {
	return (
		(name === "better-auth" || name.startsWith("@better-auth/")) &&
		!INDEPENDENT.has(name)
	);
}

const resolved = [...lock.matchAll(RESOLVED_RE)]
	.map((match) => ({ name: match[1] ?? "", version: match[2] ?? "" }))
	.filter((entry) => family(entry.name));

test("better-auth is pinned to an exact version", () => {
	expect(version).toMatch(/^\d+\.\d+\.\d+$/);
});

test("every better-auth package in package.json is on better-auth's version", () => {
	const declared = Object.entries<string>({
		...manifest.dependencies,
		...manifest.devDependencies,
	}).filter(([name]) => family(name));
	expect(declared.filter(([, range]) => range !== version)).toEqual([]);
});

test("every better-auth package the lockfile resolves is overridden to follow better-auth", () => {
	const names = [...new Set(resolved.map((entry) => entry.name))].filter(
		(name) => name !== "better-auth",
	);
	expect(names.length).toBeGreaterThan(0);
	expect(
		names.filter((name) => manifest.overrides?.[name] !== "$better-auth"),
	).toEqual([]);
});

test("the lockfile resolves one version across the whole better-auth family", () => {
	expect(resolved.filter((entry) => entry.version !== version)).toEqual([]);
});
