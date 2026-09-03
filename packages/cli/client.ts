import process from "node:process";
import createClient from "openapi-fetch";
import { ConfigStore } from "./config";
import type { paths } from "./generated/openapi-types";

export interface ClientConfig {
	baseUrl: string;
	apiKey: string;
}

/** Real class purely for consistency with every other cli/ module : neither method carries instance state of its own, both just read `ConfigStore`. */
class CliClientFactory {
	/**
	 * Resolves in order: `overrides.baseUrl`/`overrides.apiKey` (index.ts
	 * passes commander's already-parsed `--base-url`/`--api-key` global
	 * options here), then `HOMERUN_BASE_URL`/`HOMERUN_API_KEY` env vars, then
	 * the config file `homerun login` writes (see config.ts). Returns `null`
	 * rather than throwing when either piece is still missing : the caller
	 * (index.ts) treats that as "not logged in" and points at
	 * `homerun login`, rather than surfacing a raw error.
	 */
	resolveConfig(
		overrides: { baseUrl?: string; apiKey?: string } = {},
	): ClientConfig | null {
		let baseUrl = overrides.baseUrl || process.env.HOMERUN_BASE_URL || "";
		let apiKey = overrides.apiKey || process.env.HOMERUN_API_KEY || "";

		if (!(baseUrl && apiKey)) {
			const stored = ConfigStore.readStoredConfig();
			baseUrl = baseUrl || stored?.baseUrl || "";
			apiKey = apiKey || stored?.apiKey || "";
		}

		if (!(baseUrl && apiKey)) {
			return null;
		}
		return { apiKey, baseUrl: baseUrl.replace(/\/$/, "") };
	}

	/** `x-api-key` is the header hooks.server.ts checks first for a non-cookie caller : see CLAUDE.md's Auth section. */
	makeClient(config: ClientConfig) {
		return createClient<paths>({
			baseUrl: `${config.baseUrl}/api/v1`,
			headers: { "x-api-key": config.apiKey },
		});
	}
}

export const ClientFactory = new CliClientFactory();
