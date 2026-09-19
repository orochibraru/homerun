import { describe, expect, test } from "bun:test";
import { containerSampleFromInspect } from "../../../src/lib/services/docker/rollout";

describe("containerSampleFromInspect", () => {
	test("maps docker inspect state and health", () => {
		expect(
			containerSampleFromInspect({
				RestartCount: 2,
				State: {
					ExitCode: 0,
					Health: { Log: [{ Output: " ok \n" }], Status: "healthy" },
					Status: "running",
				},
			}),
		).toEqual({
			exitCode: 0,
			health: "healthy",
			healthOutput: "ok",
			kind: "container",
			restartCount: 2,
			state: "running",
		});
	});

	test("a gone container is missing", () => {
		expect(containerSampleFromInspect(null).state).toBe("missing");
	});
});
