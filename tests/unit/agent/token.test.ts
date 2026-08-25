import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../../../packages/agent/config";
import { TokenManager, tokensMatch } from "../../../packages/agent/token";

// `config` is a plain, mutable singleton object (not a module.module target):
// mocking "../../packages/agent/config" wholesale via mock.module would work *within*
// this file, but that mock is process-global and permanent (see
// tests/README.md), and every other test file that imports agent/config.ts
// -- directly (config.test.ts) or transitively (docker.test.ts) -- resolves
// to the exact same registry entry, regardless of file run order. Mutating
// the real object's own fields and restoring them afterward keeps the same
// per-test control without that cross-file collision.
const originalExplicitToken = config.explicitToken;
const originalTokenFile = config.tokenFile;

function mockConfig(overrides: Partial<typeof config>): void {
	Object.assign(config, overrides);
}

describe("tokensMatch", () => {
	test("identical strings match", () => {
		expect(tokensMatch("abc123", "abc123")).toBe(true);
	});

	test("different lengths never match", () => {
		expect(tokensMatch("short", "muchlonger")).toBe(false);
	});

	test("same length, different content does not match", () => {
		expect(tokensMatch("abcdef", "abcdeg")).toBe(false);
	});

	test("empty strings match each other", () => {
		expect(tokensMatch("", "")).toBe(true);
	});

	test("is case-sensitive", () => {
		expect(tokensMatch("Token", "token")).toBe(false);
	});
});

describe("resolveToken", () => {
	let workDir: string;

	afterEach(async () => {
		if (workDir) {
			await rm(workDir, { force: true, recursive: true });
		}
		config.explicitToken = originalExplicitToken;
		config.tokenFile = originalTokenFile;
	});

	test("an explicit env token always wins, without touching the filesystem", async () => {
		workDir = await mkdtemp(join(tmpdir(), "homerun-agent-token-"));
		const tokenFile = join(workDir, "does", "not", "exist", "token");
		mockConfig({ explicitToken: "my-explicit-token", tokenFile });

		const result = await TokenManager.resolveToken();

		expect(result).toEqual({ source: "env", token: "my-explicit-token" });
	});

	test("reads and trims a persisted token when no env token is set", async () => {
		workDir = await mkdtemp(join(tmpdir(), "homerun-agent-token-"));
		const tokenFile = join(workDir, "token");
		await Bun.write(tokenFile, "  persisted-token-value  \n");
		mockConfig({ explicitToken: null, tokenFile });

		const result = await TokenManager.resolveToken();

		expect(result).toEqual({
			source: "persisted",
			token: "persisted-token-value",
		});
	});

	test("generates and persists a new token when the file doesn't exist", async () => {
		workDir = await mkdtemp(join(tmpdir(), "homerun-agent-token-"));
		const tokenFile = join(workDir, "nested", "dir", "token");
		mockConfig({ explicitToken: null, tokenFile });

		const result = await TokenManager.resolveToken();

		expect(result.source).toBe("generated");
		// Two concatenated randomUUID()s with dashes stripped: 32 + 32 hex chars.
		expect(result.token).toMatch(/^[0-9a-f]{64}$/);
		expect(await Bun.file(tokenFile).text()).toBe(result.token);
	});

	test("treats a whitespace-only persisted file as absent and regenerates", async () => {
		workDir = await mkdtemp(join(tmpdir(), "homerun-agent-token-"));
		const tokenFile = join(workDir, "token");
		await Bun.write(tokenFile, "   \n");
		mockConfig({ explicitToken: null, tokenFile });

		const result = await TokenManager.resolveToken();

		expect(result.source).toBe("generated");
		expect(result.token).toMatch(/^[0-9a-f]{64}$/);
	});

	test("persists the generated token with owner-only permissions", async () => {
		workDir = await mkdtemp(join(tmpdir(), "homerun-agent-token-"));
		const tokenFile = join(workDir, "token");
		mockConfig({ explicitToken: null, tokenFile });

		await TokenManager.resolveToken();

		const { stat } = await import("node:fs/promises");
		const mode = (await stat(tokenFile)).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	test("a second call reuses the now-persisted token instead of regenerating", async () => {
		workDir = await mkdtemp(join(tmpdir(), "homerun-agent-token-"));
		const tokenFile = join(workDir, "token");
		mockConfig({ explicitToken: null, tokenFile });

		const first = await TokenManager.resolveToken();
		expect(first.source).toBe("generated");

		const second = await TokenManager.resolveToken();
		expect(second).toEqual({ source: "persisted", token: first.token });
	});
});
