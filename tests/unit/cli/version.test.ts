import { describe, expect, test } from "bun:test";
import pkg from "../../../package.json";
import { CLI_VERSION } from "../../../packages/cli/version";

describe("CLI_VERSION", () => {
	test("mirrors the repo root package.json version, not a hardcoded string", () => {
		expect(CLI_VERSION).toBe(pkg.version);
	});

	test("looks like a semantic version", () => {
		expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+/);
	});
});
