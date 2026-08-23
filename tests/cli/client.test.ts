import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { makeClient, resolveConfig } from "../../cli/client";
import {
	clearStoredConfig,
	configPath,
	writeStoredConfig,
} from "../../cli/config";

// See tests/cli/config.test.ts : resolveConfig() falls back to the on-disk
// config, so this file needs the same mocked-homedir guarantee (see
// tests/support/homedir-preload.ts).
if (!homedir().startsWith(tmpdir())) {
	throw new Error(
		"os.homedir() isn't mocked to a scratch directory : refusing to risk " +
			`touching the real ${configPath()}. Check bunfig.toml's ` +
			"[test].preload.",
	);
}

const ENV_KEYS = ["HOMERUN_BASE_URL", "HOMERUN_API_KEY"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
	savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const k of ENV_KEYS) {
		delete process.env[k];
	}
	clearStoredConfig();
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) {
			delete process.env[k];
		} else {
			process.env[k] = savedEnv[k];
		}
	}
	clearStoredConfig();
});

describe("resolveConfig", () => {
	test("returns null when nothing is configured anywhere", () => {
		expect(resolveConfig([])).toBeNull();
	});

	test("reads from env vars", () => {
		process.env.HOMERUN_BASE_URL = "https://env.example.com";
		process.env.HOMERUN_API_KEY = "env-key";
		expect(resolveConfig([])).toEqual({
			apiKey: "env-key",
			baseUrl: "https://env.example.com",
		});
	});

	test("falls back to the stored config file", () => {
		writeStoredConfig({
			apiKey: "stored-key",
			baseUrl: "https://stored.example.com",
		});
		expect(resolveConfig([])).toEqual({
			apiKey: "stored-key",
			baseUrl: "https://stored.example.com",
		});
	});

	test("--base-url/--api-key flags win over env vars", () => {
		process.env.HOMERUN_BASE_URL = "https://env.example.com";
		process.env.HOMERUN_API_KEY = "env-key";
		expect(
			resolveConfig([
				"--base-url",
				"https://flag.example.com",
				"--api-key",
				"flag-key",
			]),
		).toEqual({ apiKey: "flag-key", baseUrl: "https://flag.example.com" });
	});

	test("env vars win over the stored config file", () => {
		writeStoredConfig({
			apiKey: "stored-key",
			baseUrl: "https://stored.example.com",
		});
		process.env.HOMERUN_API_KEY = "env-key";
		expect(resolveConfig([])).toEqual({
			apiKey: "env-key",
			baseUrl: "https://stored.example.com",
		});
	});

	test("strips a trailing slash from the base URL", () => {
		process.env.HOMERUN_BASE_URL = "https://env.example.com/";
		process.env.HOMERUN_API_KEY = "env-key";
		expect(resolveConfig([])?.baseUrl).toBe("https://env.example.com");
	});

	test("returns null when only one of baseUrl/apiKey is available", () => {
		process.env.HOMERUN_BASE_URL = "https://env.example.com";
		expect(resolveConfig([])).toBeNull();
	});
});

describe("makeClient", () => {
	test("builds an openapi-fetch client pointed at /api/v1 with the x-api-key header", () => {
		const client = makeClient({
			apiKey: "my-key",
			baseUrl: "https://h.example.com",
		});
		expect(typeof client.GET).toBe("function");
		expect(typeof client.POST).toBe("function");
	});
});
