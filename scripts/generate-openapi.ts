import { buildOpenApiDocument } from "../src/lib/openapi/build";

// Regenerates the openapi.json snapshot at the repo root from the same
// buildOpenApiDocument() the live /api/v1/openapi.json route serves. Run as
// part of `bun run build` (see package.json) rather than from inside
// hooks.server.ts's init() : init() only runs when SvelteKit's server
// handles its first request, which never happens during `vite build` for
// this app (no prerendered routes), so a `building`-gated branch in there
// is dead code.
//
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

Bun.spawnSync(["bun", "fmt", "openapi.json"], {
	stderr: "inherit",
	stdout: "inherit",
});

console.log("Wrote openapi.json");
