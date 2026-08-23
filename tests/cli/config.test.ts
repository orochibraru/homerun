import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
	clearStoredConfig,
	configPath,
	readStoredConfig,
	writeStoredConfig,
} from "../../cli/config";

/**
 * cli/config.ts resolves `CONFIG_DIR`/`CONFIG_FILE` from `os.homedir()` once,
 * at module load, so this suite relies on bunfig.toml's
 * `[test].preload`d tests/support/homedir-preload.ts, which mocks
 * `os.homedir()` to a scratch directory before any test file's own imports
 * run, see that file and tests/README.md. This guard fails loudly rather
 * than silently touching a real home directory if that invariant is ever
 * broken (e.g. the preload entry gets removed from bunfig.toml, or someone
 * runs bun test with a different `--cwd` where bunfig.toml isn't picked up).
 */
if (!homedir().startsWith(tmpdir())) {
	throw new Error(
		"os.homedir() isn't mocked to a scratch directory : refusing to risk " +
			`writing to the real ${configPath()}. Check that bunfig.toml's ` +
			"[test].preload still includes tests/support/homedir-preload.ts, " +
			"and that this run picked up this repo's bunfig.toml (e.g. no " +
			"unexpected --cwd).",
	);
}

describe("readStoredConfig", () => {
	afterEach(() => {
		clearStoredConfig();
	});

	test("returns null when no config file exists", () => {
		clearStoredConfig();
		expect(readStoredConfig()).toBeNull();
	});

	test("returns null for malformed JSON", () => {
		mkdirSync(configPath().replace(/\/config\.json$/, ""), {
			recursive: true,
		});
		writeFileSync(configPath(), "{ not json");
		expect(readStoredConfig()).toBeNull();
	});

	test("returns null when required fields are missing or the wrong type", () => {
		mkdirSync(configPath().replace(/\/config\.json$/, ""), {
			recursive: true,
		});
		writeFileSync(configPath(), JSON.stringify({ apiKey: 42 }));
		expect(readStoredConfig()).toBeNull();
	});

	test("returns the parsed config when valid", () => {
		writeStoredConfig({ apiKey: "key-123", baseUrl: "https://h.example.com" });
		expect(readStoredConfig()).toEqual({
			apiKey: "key-123",
			baseUrl: "https://h.example.com",
		});
	});
});

describe("writeStoredConfig", () => {
	afterEach(() => {
		clearStoredConfig();
	});

	test("creates the config directory and file with owner-only permissions", () => {
		writeStoredConfig({ apiKey: "secret", baseUrl: "https://h.example.com" });

		expect(existsSync(configPath())).toBe(true);
		const fileMode = statSync(configPath()).mode & 0o777;
		expect(fileMode).toBe(0o600);
	});

	test("overwrites a previously-stored config", () => {
		writeStoredConfig({ apiKey: "first", baseUrl: "https://one.example.com" });
		writeStoredConfig({
			apiKey: "second",
			baseUrl: "https://two.example.com",
		});
		expect(readStoredConfig()).toEqual({
			apiKey: "second",
			baseUrl: "https://two.example.com",
		});
	});
});

describe("clearStoredConfig", () => {
	test("removes an existing config file", () => {
		writeStoredConfig({ apiKey: "k", baseUrl: "https://h.example.com" });
		clearStoredConfig();
		expect(existsSync(configPath())).toBe(false);
	});

	test("is a no-op when there's nothing to clear", () => {
		clearStoredConfig();
		expect(() => clearStoredConfig()).not.toThrow();
	});
});

describe("configPath", () => {
	test("lives under the config dir, in the (fake, per this run) home directory", () => {
		expect(configPath()).toContain("/.config/homerun/config.json");
	});
});
