import { describe, expect, test } from "bun:test";

import {
	currentPhase,
	deployPhaseStates,
	enteredPhases,
	phaseLine,
	phasesFor,
} from "../../../src/lib/deploy-phases";

const log = [
	phaseLine("config"),
	phaseLine("volumes"),
	phaseLine("image"),
	"Pulling redis:7...",
	phaseLine("container"),
].join("\n");

describe("deploy phases", () => {
	test("reads the last phase the log reported", () => {
		expect(currentPhase(log)).toBe("container");
		expect(currentPhase("Pulling redis:7...")).toBeNull();
	});

	test("reads the markers the worker writes", () => {
		expect(
			enteredPhases(
				[
					"▸ Cloning repository",
					"▸ Fetching image",
					"▸ Scanning image",
					"▸ Provisioning container",
					"▸ Waiting until healthy",
					"▸ Routing traffic",
				].join("\n"),
			),
		).toEqual(["source", "image", "scan", "container", "health", "network"]);
	});

	test("marks earlier phases done, skipped ones skipped and the current one active", () => {
		const states = deployPhaseStates(log, "starting");
		expect(states.map((s) => [s.phase.id, s.state])).toEqual([
			["config", "done"],
			["volumes", "done"],
			["image", "done"],
			["scan", "skipped"],
			["container", "active"],
			["health", "pending"],
			["network", "pending"],
			["ready", "pending"],
		]);
	});

	test("marks the phase a failed deploy stopped on", () => {
		const states = deployPhaseStates(log, "failed");
		expect(states.find((s) => s.phase.id === "container")?.state).toBe(
			"failed",
		);
	});

	test("marks entered phases done and the rest skipped once the deployment is running", () => {
		const states = deployPhaseStates(log, "running");
		expect(states.find((s) => s.phase.id === "image")?.state).toBe("done");
		expect(states.find((s) => s.phase.id === "health")?.state).toBe("skipped");
	});

	test("marks everything done for a finished deploy without markers", () => {
		expect(
			deployPhaseStates("", "running").every((s) => s.state === "done"),
		).toBe(true);
	});

	test("leaves every phase pending before the first marker", () => {
		expect(
			deployPhaseStates("", "pending").every((s) => s.state === "pending"),
		).toBe(true);
	});

	test("only a git build clones, and it builds rather than pulls", () => {
		expect(phasesFor("image").some((p) => p.id === "source")).toBe(false);
		const git = phasesFor("git");
		expect(git.some((p) => p.id === "source")).toBe(true);
		expect(git.find((p) => p.id === "image")?.label).toBe("Build");
	});
});
