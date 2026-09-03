import { buildOpenApiDocument } from "../src/lib/openapi/build";

// Regenerates the openapi.json snapshot at the repo root from the same
// buildOpenApiDocument() the live /api/v1/openapi.json route serves. Run as
// part of `bun run build` (see package.json) rather than from inside
// hooks.server.ts's init() : init() only runs when SvelteKit's server
// handles its first request, which never happens during `vite build` for
// this app (no prerendered routes), so a `building`-gated branch in there
// is dead code.
//
// Keys are sorted recursively before writing : biome.json's
// `assist.actions.source.useSortedKeys` enforces alphabetical key order on
// every JSON file in the repo, including this one, and this script now runs
// automatically on every integration-test run (tests/integration/support/
// setup.ts's own `bun run build:app` step), not just a one-off `bun run
// build` — an unsorted write here would leave the working tree lint-dirty
// after every test run, real friction this replaces.
function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	if (value !== null && typeof value === "object") {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
		}
		return sorted;
	}
	return value;
}

const doc = buildOpenApiDocument("http://localhost:3000");
await Bun.write("openapi.json", JSON.stringify(sortKeysDeep(doc), null, "\t"));

// Key order alone isn't enough to satisfy biome's own JSON formatter (it
// also collapses short arrays like `"enum": ["a", "b"]` onto one line,
// a width-based heuristic not worth hand-reproducing here) : shelling out
// to biome itself for a real formatting pass is what actually guarantees
// `bun run lint` stays clean after this script runs, rather than
// approximating its rules.
Bun.spawnSync(["bunx", "biome", "check", "--write", "openapi.json"], {
	stderr: "inherit",
	stdout: "inherit",
});

console.log("Wrote openapi.json");
