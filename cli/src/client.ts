import createClient from "openapi-fetch";
import type { paths } from "./generated/openapi-types";

export interface ClientConfig {
	baseUrl: string;
	apiKey: string;
}

export function resolveConfig(argv: string[]): ClientConfig {
	let baseUrl = process.env.HOMERUN_BASE_URL ?? "";
	let apiKey = process.env.HOMERUN_API_KEY ?? "";

	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--base-url") {
			baseUrl = argv[i + 1] ?? baseUrl;
		} else if (argv[i] === "--api-key") {
			apiKey = argv[i + 1] ?? apiKey;
		}
	}

	if (!baseUrl) {
		throw new Error(
			"Missing base URL — pass --base-url or set HOMERUN_BASE_URL.",
		);
	}
	if (!apiKey) {
		throw new Error("Missing API key — pass --api-key or set HOMERUN_API_KEY.");
	}
	return { apiKey, baseUrl: baseUrl.replace(/\/$/, "") };
}

/** `x-api-key` is the header hooks.server.ts checks first for a non-cookie caller — see CLAUDE.md's Auth section. */
export function makeClient(config: ClientConfig) {
	return createClient<paths>({
		baseUrl: `${config.baseUrl}/api/v1`,
		headers: { "x-api-key": config.apiKey },
	});
}
