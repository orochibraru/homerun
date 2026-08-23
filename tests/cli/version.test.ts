import { describe, expect, test } from "bun:test";
import { CLI_VERSION } from "../../cli/version";
import pkg from "../../package.json";

describe("CLI_VERSION", () => {
	test("mirrors the repo root package.json version, not a hardcoded string", () => {
		expect(CLI_VERSION).toBe(pkg.version);
	});

	test("looks like a semantic version", () => {
		expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
	});
});
