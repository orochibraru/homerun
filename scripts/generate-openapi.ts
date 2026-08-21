import { buildOpenApiDocument } from "../src/lib/openapi/build";

// Regenerates the openapi.json snapshot at the repo root from the same
// buildOpenApiDocument() the live /api/v1/openapi.json route serves. Run as
// part of `bun run build` (see package.json) rather than from inside
// hooks.server.ts's init() : init() only runs when SvelteKit's server
// handles its first request, which never happens during `vite build` for
// this app (no prerendered routes), so a `building`-gated branch in there
// is dead code.
const doc = buildOpenApiDocument("http://localhost:3000");
await Bun.write("openapi.json", JSON.stringify(doc, null, "\t"));
console.log("Wrote openapi.json");  
