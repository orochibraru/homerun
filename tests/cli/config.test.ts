import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { ConfigStore } from "../../cli/config";

/**
 * cli/config.ts's `ConfigStore` resolves its config dir/file from
 * `os.homedir()` once, at module load (construction time), so this suite
 * relies on bunfig.toml's `[test].preload`d tests/support/homedir-preload.ts,
 * which mocks `os.homedir()` to a scratch directory before any test file's
 * own imports run, see that file and tests/README.md. This guard fails
 * loudly rather than silently touching a real home directory if that
 * invariant is ever broken (e.g. the preload entry gets removed from
 * bunfig.toml, or someone runs bun test with a different `--cwd` where
 * bunfig.toml isn't picked up).
 */
if (!homedir().startsWith(tmpdir())) {
	throw new Error(
		"os.homedir() isn't mocked to a scratch directory : refusing to risk " +
			`writing to the real ${ConfigStore.configPath()}. Check that ` +
			"bunfig.toml's [test].preload still includes " +
			"tests/support/homedir-preload.ts, and that this run picked up " +
			"this repo's bunfig.toml (e.g. no unexpected --cwd).",
	);
}

describe("ConfigStore.readStoredConfig", () => {
	afterEach(() => {
		ConfigStore.clearStoredConfig();
	});

	test("returns null when no config file exists", () => {
		ConfigStore.clearStoredConfig();
		expect(ConfigStore.readStoredConfig()).toBeNull();
	});

	test("returns null for malformed JSON", () => {
		mkdirSync(ConfigStore.configPath().replace(/\/config\.json$/, ""), {
			recursive: true,
		});
		writeFileSync(ConfigStore.configPath(), "{ not json");
		expect(ConfigStore.readStoredConfig()).toBeNull();
	});

	test("returns null when required fields are missing or the wrong type", () => {
		mkdirSync(ConfigStore.configPath().replace(/\/config\.json$/, ""), {
			recursive: true,
		});
		writeFileSync(ConfigStore.configPath(), JSON.stringify({ apiKey: 42 }));
		expect(ConfigStore.readStoredConfig()).toBeNull();
	});

	test("returns the parsed config when valid", () => {
		ConfigStore.writeStoredConfig({
			apiKey: "key-123",
			baseUrl: "https://h.example.com",
		});
		expect(ConfigStore.readStoredConfig()).toEqual({
			apiKey: "key-123",
			baseUrl: "https://h.example.com",
		});
	});
});

describe("ConfigStore.writeStoredConfig", () => {
	afterEach(() => {
		ConfigStore.clearStoredConfig();
	});

	test("creates the config directory and file with owner-only permissions", () => {
		ConfigStore.writeStoredConfig({
			apiKey: "secret",
			baseUrl: "https://h.example.com",
		});

		expect(existsSync(ConfigStore.configPath())).toBe(true);
		const fileMode = statSync(ConfigStore.configPath()).mode & 0o777;
		expect(fileMode).toBe(0o600);
	});

	test("overwrites a previously-stored config", () => {
		ConfigStore.writeStoredConfig({
			apiKey: "first",
			baseUrl: "https://one.example.com",
		});
		ConfigStore.writeStoredConfig({
			apiKey: "second",
			baseUrl: "https://two.example.com",
		});
		expect(ConfigStore.readStoredConfig()).toEqual({
			apiKey: "second",
			baseUrl: "https://two.example.com",
		});
	});
});

describe("ConfigStore.clearStoredConfig", () => {
	test("removes an existing config file", () => {
		ConfigStore.writeStoredConfig({
			apiKey: "k",
			baseUrl: "https://h.example.com",
		});
		ConfigStore.clearStoredConfig();
		expect(existsSync(ConfigStore.configPath())).toBe(false);
	});

	test("is a no-op when there's nothing to clear", () => {
		ConfigStore.clearStoredConfig();
		expect(() => ConfigStore.clearStoredConfig()).not.toThrow();
	});
});

describe("ConfigStore.configPath", () => {
	test("lives under the config dir, in the (fake, per this run) home directory", () => {
		expect(ConfigStore.configPath()).toContain("/.config/homerun/config.json");
	});
});
