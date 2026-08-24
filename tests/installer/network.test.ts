import { describe, expect, mock, test } from "bun:test";
import type { StepRunner } from "../../installer/exec";
import { NetworkSetup } from "../../installer/steps/network";

/**
 * A plain object shaped like `StepRunner` (TS types are erased at runtime,
 * see tests/README.md), not a real StepRunner : lets each test dictate
 * exactly which calls succeed/fail without shelling out to real Docker.
 */
function fakeRunner(opts: { inspectSucceeds: boolean }) {
	const run = mock(async (cmd: string[]) => {
		if (cmd[1] === "network" && cmd[2] === "inspect") {
			if (!opts.inspectSucceeds) {
				throw new Error("no such network");
			}
			return { code: 0, stderr: "", stdout: "" };
		}
		return { code: 0, stderr: "", stdout: "" };
	});
	return { run } as unknown as StepRunner;
}

describe("NetworkSetup.ensureHomerunNetwork", () => {
	test("skips creation when the network already exists", async () => {
		const runner = fakeRunner({ inspectSucceeds: true });

		await NetworkSetup.ensureHomerunNetwork(
			runner,
			"homerun",
			"/run/user/1000/docker.sock",
		);

		const calls = (runner.run as ReturnType<typeof mock>).mock.calls;
		expect(calls).toHaveLength(1);
		expect(calls[0][0]).toEqual(["docker", "network", "inspect", "homerun"]);
	});

	test("creates the network when inspect fails", async () => {
		const runner = fakeRunner({ inspectSucceeds: false });

		await NetworkSetup.ensureHomerunNetwork(
			runner,
			"homerun",
			"/run/user/1000/docker.sock",
		);

		const calls = (runner.run as ReturnType<typeof mock>).mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls[1][0]).toEqual(["docker", "network", "create", "homerun"]);
	});

	test("passes DOCKER_HOST and HOME derived from the socket/username", async () => {
		const runner = fakeRunner({ inspectSucceeds: true });

		await NetworkSetup.ensureHomerunNetwork(
			runner,
			"alice",
			"/run/user/1000/docker.sock",
		);

		const calls = (runner.run as ReturnType<typeof mock>).mock.calls;
		expect(calls[0][1]).toMatchObject({
			as: "alice",
			env: {
				DOCKER_HOST: "unix:///run/user/1000/docker.sock",
				HOME: "/home/alice",
			},
		});
	});
});
