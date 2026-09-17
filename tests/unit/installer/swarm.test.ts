import { describe, expect, mock, test } from "bun:test";
import type { StepRunner } from "../../../packages/installer/exec";
import {
	SWARM_NETWORK,
	SwarmSetup,
	swarmInitCommand,
	swarmNodeState,
} from "../../../packages/installer/steps/swarm";

function fakeRunner(responses: {
	info?: string;
	initFails?: boolean;
	networkShape?: string | null;
}) {
	const run = mock(async (command: string[]) => {
		if (command[1] === "info") {
			return { code: 0, stderr: "", stdout: responses.info ?? "" };
		}
		if (command[1] === "swarm" && responses.initFails) {
			throw new Error("could not choose an IP address to advertise");
		}
		if (command[1] === "network" && command[2] === "inspect") {
			if (responses.networkShape === null) {
				throw new Error("no such network");
			}
			return { code: 0, stderr: "", stdout: responses.networkShape ?? "" };
		}
		return { code: 0, stderr: "", stdout: "" };
	});
	return { run, runner: { run } as unknown as StepRunner };
}

describe("swarmNodeState", () => {
	test("reads a manager, a worker and a host outside any swarm", () => {
		expect(swarmNodeState("active true\n")).toBe("manager");
		expect(swarmNodeState("active false")).toBe("worker");
		expect(swarmNodeState("inactive false")).toBe("inactive");
		expect(swarmNodeState("pending false")).toBe("inactive");
		expect(swarmNodeState("")).toBe("inactive");
	});
});

describe("swarmInitCommand", () => {
	test("advertises the given address", () => {
		expect(swarmInitCommand("192.168.1.20")).toEqual([
			"docker",
			"swarm",
			"init",
			"--advertise-addr",
			"192.168.1.20",
		]);
	});

	test("lets docker pick when there's no address", () => {
		expect(swarmInitCommand(null)).toEqual(["docker", "swarm", "init"]);
	});
});

describe("SwarmSetup.ensureManager", () => {
	test("initialises a host outside any swarm with the advertise address", async () => {
		const { run, runner } = fakeRunner({ info: "inactive false" });
		await SwarmSetup.ensureManager(runner, "10.0.0.5");
		expect(run).toHaveBeenCalledWith(
			["docker", "swarm", "init", "--advertise-addr", "10.0.0.5"],
			{ env: { DOCKER_HOST: "unix:///var/run/docker.sock" } },
		);
	});

	test("skips a host that already manages a swarm", async () => {
		const { run, runner } = fakeRunner({ info: "active true" });
		await SwarmSetup.ensureManager(runner, "10.0.0.5");
		expect(run).toHaveBeenCalledTimes(1);
	});

	test("refuses a worker node", async () => {
		const { runner } = fakeRunner({ info: "active false" });
		await expect(SwarmSetup.ensureManager(runner, null)).rejects.toThrow(
			"worker in another swarm",
		);
	});

	test("points a failed init at --advertise-addr", async () => {
		const { runner } = fakeRunner({ info: "inactive false", initFails: true });
		await expect(SwarmSetup.ensureManager(runner, null)).rejects.toThrow(
			"--advertise-addr=",
		);
	});
});

describe("SwarmSetup.ensureOverlayNetwork", () => {
	test("creates an attachable overlay when there's none", async () => {
		const { run, runner } = fakeRunner({ networkShape: null });
		await SwarmSetup.ensureOverlayNetwork(runner);
		expect(run).toHaveBeenCalledWith(
			[
				"docker",
				"network",
				"create",
				"--driver",
				"overlay",
				"--attachable",
				SWARM_NETWORK,
			],
			{ env: { DOCKER_HOST: "unix:///var/run/docker.sock" } },
		);
	});

	test("reuses an existing attachable overlay", async () => {
		const { run, runner } = fakeRunner({ networkShape: "overlay true\n" });
		await SwarmSetup.ensureOverlayNetwork(runner);
		expect(run).toHaveBeenCalledTimes(1);
	});

	test("refuses a same-named network of another shape", async () => {
		const { runner } = fakeRunner({ networkShape: "bridge false" });
		await expect(SwarmSetup.ensureOverlayNetwork(runner)).rejects.toThrow(
			"attachable overlay",
		);
	});
});
