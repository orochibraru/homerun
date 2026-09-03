import { describe, expect, test } from "bun:test";
import process from "node:process";
// Real, unmocked agent/config.ts : must be the first thing in the agent/
// test suite to touch this module (alphabetically, this file runs before
// token.test.ts, which mocks "../../packages/agent/config" and restores it
// afterward, see tests/README.md on why module mocks are process-global).
import { config } from "../../../packages/agent/config";

describe("agent config defaults", () => {
	test("dockerNetworkName defaults to homerun", () => {
		expect(config.dockerNetworkName).toBe(
			process.env.HOMERUN_NETWORK_NAME ?? "homerun",
		);
	});

	test("dockerSocketPath honors an explicit DOCKER_SOCKET_PATH, or else auto-detects one", () => {
		// An explicit value always wins outright (see
		// AgentConfig.detectDockerSocketPath's docstring) : deterministic to
		// assert everywhere. Without one, the actual value is genuinely
		// environment-dependent (DOCKER_HOST, the active `docker context`,
		// which of a handful of common socket paths exists on *this*
		// machine), so this only asserts detection produced *something*
		// real rather than pinning one specific path : a hardcoded
		// "/var/run/docker.sock" expectation here would itself be exactly
		// the bug this detection replaced, false on any machine using a
		// different Docker context (verified live : this failed on a real
		// OrbStack dev machine before the fix).
		if (process.env.DOCKER_SOCKET_PATH) {
			expect(config.dockerSocketPath).toBe(process.env.DOCKER_SOCKET_PATH);
		} else {
			expect(config.dockerSocketPath.length).toBeGreaterThan(0);
		}
	});

	test("explicitToken defaults to null when AGENT_TOKEN is unset", () => {
		if (process.env.AGENT_TOKEN) {
			expect(config.explicitToken).toBe(process.env.AGENT_TOKEN);
		} else {
			expect(config.explicitToken).toBeNull();
		}
	});

	test("port defaults to 7420", () => {
		const expected = Number.parseInt(process.env.PORT ?? "7420", 10);
		expect(config.port).toBe(expected);
	});

	test("tokenFile falls under the user's home directory by default", () => {
		if (process.env.AGENT_TOKEN_FILE) {
			expect(config.tokenFile).toBe(process.env.AGENT_TOKEN_FILE);
		} else {
			expect(config.tokenFile.endsWith("/.homerun-agent/token")).toBe(true);
		}
	});
});
