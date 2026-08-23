import { describe, expect, test } from "bun:test";
import { AGENT_VERSION } from "../../agent/version";
import pkg from "../../package.json";

describe("AGENT_VERSION", () => {
	test("mirrors the repo root package.json version, not a hardcoded string", () => {
		expect(AGENT_VERSION).toBe(pkg.version);
	});

	test("looks like a semantic version", () => {
		expect(AGENT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
	});
});
