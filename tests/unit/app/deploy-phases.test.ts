import { describe, expect, test } from "bun:test";
import {
	currentPhase,
	deployPhaseStates,
	phaseLine,
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

	test("marks earlier phases done and the current one active", () => {
		const states = deployPhaseStates(log, "starting");
		expect(states.map((s) => s.state)).toEqual([
			"done",
			"done",
			"done",
			"active",
			"pending",
			"pending",
		]);
	});

	test("marks the phase a failed deploy stopped on", () => {
		const states = deployPhaseStates(log, "failed");
		expect(states.find((s) => s.phase.id === "container")?.state).toBe(
			"failed",
		);
	});

	test("marks everything done once the deployment is running", () => {
		expect(
			deployPhaseStates(log, "running").every((s) => s.state === "done"),
		).toBe(true);
	});

	test("leaves every phase pending before the first marker", () => {
		expect(
			deployPhaseStates("", "pending").every((s) => s.state === "pending"),
		).toBe(true);
	});
});
