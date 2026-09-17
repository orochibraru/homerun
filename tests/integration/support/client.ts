import createClient from "openapi-fetch";
import { nativeFetch } from "./config";
import type { paths } from "./openapi-types";

/** Typed against the app's own OpenAPI document (`bun run gen` regenerates `openapi-types.ts` from `openapi.json`), so a REST API shape change breaks this suite rather than slipping through. `fetch: nativeFetch` is load-bearing, see config.ts's own docstring. `origin` is per-run (a random port), not a static constant, see port.ts/setup.ts. */
export function makeApiClient(apiKey: string, origin: string) {
	return createClient<paths>({
		baseUrl: `${origin}/api/v1`,
		fetch: nativeFetch,
		headers: { "x-api-key": apiKey },
	});
}

export type ApiClient = ReturnType<typeof makeApiClient>;
