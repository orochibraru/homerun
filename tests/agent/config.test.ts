import { describe, expect, test } from "bun:test";

// Real, unmocked agent/config.ts : must be the first thing in the agent/
// test suite to touch this module (alphabetically, this file runs before
// token.test.ts, which mocks "../../agent/config" and restores it
// afterward, see tests/README.md on why module mocks are process-global).
import { config } from "../../agent/config";

describe("agent config defaults", () => {
	test("dockerNetworkName defaults to homerun-network", () => {
		expect(config.dockerNetworkName).toBe(
			process.env.HOMERUN_NETWORK_NAME ?? "homerun-network",
		);
	});

	test("dockerSocketPath defaults to the standard Docker socket", () => {
		expect(config.dockerSocketPath).toBe(
			process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock",
		);
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
