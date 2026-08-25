import createClient from "openapi-fetch";
import type { paths } from "../../../packages/cli/generated/openapi-types";
import { nativeFetch } from "./config";

/** Same shape as cli/client.ts's makeClient : reuses the CLI's own generated OpenAPI types rather than hand-rolling a second client, so a REST API shape change breaks this suite the same way it'd break the CLI. `fetch: nativeFetch` is load-bearing, see config.ts's own docstring. `origin` is per-run (a random port), not a static constant, see port.ts/setup.ts. */
export function makeApiClient(apiKey: string, origin: string) {
	return createClient<paths>({
		baseUrl: `${origin}/api/v1`,
		fetch: nativeFetch,
		headers: { "x-api-key": apiKey },
	});
}

export type ApiClient = ReturnType<typeof makeApiClient>;
