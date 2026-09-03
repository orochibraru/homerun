import { describe, expect, test } from "bun:test";
import pkg from "../../../package.json" with { type: "json" };
import { AGENT_VERSION } from "../../../packages/agent/version";

describe("AGENT_VERSION", () => {
	test("mirrors the repo root package.json version, not a hardcoded string", () => {
		expect(AGENT_VERSION).toBe(pkg.version);
	});

	test("looks like a semantic version", () => {
		expect(AGENT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
	});
});
