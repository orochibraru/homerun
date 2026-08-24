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
	 * Resolves in order: `--base-url`/`--api-key` flags, then
	 * `HOMERUN_BASE_URL`/`HOMERUN_API_KEY` env vars, then the config file
	 * `homerun login` writes (see config.ts). Returns `null` rather than
	 * throwing when either piece is still missing : the caller (index.ts)
	 * treats that as "not logged in" and points at `homerun login`, rather
	 * than surfacing a raw error.
	 */
	resolveConfig(argv: string[]): ClientConfig | null {
		let baseUrl = process.env.HOMERUN_BASE_URL ?? "";
		let apiKey = process.env.HOMERUN_API_KEY ?? "";

		for (let i = 0; i < argv.length; i += 1) {
			if (argv[i] === "--base-url") {
				baseUrl = argv[i + 1] ?? baseUrl;
			} else if (argv[i] === "--api-key") {
				apiKey = argv[i + 1] ?? apiKey;
			}
		}

		if (!baseUrl || !apiKey) {
			const stored = ConfigStore.readStoredConfig();
			baseUrl = baseUrl || stored?.baseUrl || "";
			apiKey = apiKey || stored?.apiKey || "";
		}

		if (!baseUrl || !apiKey) {
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
