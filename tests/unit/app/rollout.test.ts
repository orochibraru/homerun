import { describe, expect, test } from "bun:test";
import {
	type ContainerHealthSample,
	containerSampleFromInspect,
	readinessVerdict,
	rolloutStrategy,
	swarmUpdateOrder,
	swarmUpdateOutcome,
} from "../../../src/lib/services/docker/rollout";

const window = { maxWaitMs: 60_000, settleMs: 5000 };

function sample(
	overrides: Partial<ContainerHealthSample> = {},
): ContainerHealthSample {
	return {
		exitCode: null,
		health: "none",
		healthOutput: null,
		kind: "container",
		restartCount: 0,
		state: "running",
		...overrides,
	};
}

describe("rolloutStrategy", () => {
	test("a running previous container on bridge networking rolls out blue-green", () => {
		expect(
			rolloutStrategy({
				hasRunningPrevious: true,
				networkMode: "bridge",
				volumes: [{ readOnly: true }],
			}),
		).toEqual({ kind: "blue-green" });
	});

	test("nothing running means a plain recreate with nothing to explain", () => {
		expect(rolloutStrategy({ hasRunningPrevious: false })).toEqual({
			kind: "recreate",
			reason: null,
		});
	});

	test("host networking and writable volumes recreate, and say why", () => {
		const host = rolloutStrategy({
			hasRunningPrevious: true,
			networkMode: "host",
		});
		expect(host.kind).toBe("recreate");
		expect(host.kind === "recreate" && host.reason).toContain(
			"Host networking",
		);
		const volume = rolloutStrategy({
			hasRunningPrevious: true,
			volumes: [{ readOnly: false }],
		});
		expect(volume.kind === "recreate" && volume.reason).toContain(
			"writable volume",
		);
	});
});

describe("readinessVerdict", () => {
	test("a passing healthcheck is ready at once", () => {
		expect(
			readinessVerdict(sample({ health: "healthy" }), 1000, window),
		).toEqual({ verdict: "ready" });
	});

	test("without a healthcheck it waits for the settle period", () => {
		expect(readinessVerdict(sample(), 1000, window).verdict).toBe("pending");
		expect(readinessVerdict(sample(), 5000, window).verdict).toBe("ready");
	});

	test("a starting healthcheck stays pending until the max wait", () => {
		const starting = sample({ health: "starting" });
		expect(readinessVerdict(starting, 30_000, window).verdict).toBe("pending");
		expect(readinessVerdict(starting, 60_000, window)).toMatchObject({
			verdict: "failed",
		});
	});

	test("exits, restarts, disappearance and a failing healthcheck fail at once", () => {
		expect(
			readinessVerdict(sample({ exitCode: 1, state: "exited" }), 0, window),
		).toEqual({
			reason: "The new container exited with code 1.",
			verdict: "failed",
		});
		expect(
			readinessVerdict(sample({ restartCount: 1 }), 0, window).verdict,
		).toBe("failed");
		expect(
			readinessVerdict(sample({ state: "missing" }), 0, window).verdict,
		).toBe("failed");
		expect(
			readinessVerdict(
				sample({ health: "unhealthy", healthOutput: "connection refused" }),
				0,
				window,
			),
		).toEqual({
			reason: "The new container's healthcheck failed: connection refused",
			verdict: "failed",
		});
	});
});

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

describe("swarm rollout", () => {
	test("start-first unless a mount is writable", () => {
		expect(swarmUpdateOrder([{ readOnly: true }])).toBe("start-first");
		expect(swarmUpdateOrder(undefined)).toBe("start-first");
		expect(swarmUpdateOrder([{ readOnly: false }])).toBe("stop-first");
	});

	test("ignores the update status left by an earlier deploy", () => {
		expect(
			swarmUpdateOutcome(
				{ StartedAt: "2026-09-17T10:00:00Z", State: "completed" },
				"2026-09-17T10:00:00Z",
			),
		).toEqual({ state: "pending" });
		expect(swarmUpdateOutcome(undefined, null)).toEqual({ state: "pending" });
	});

	test("reports completion, and a rollback as a failure", () => {
		expect(
			swarmUpdateOutcome(
				{ StartedAt: "2026-09-17T11:00:00Z", State: "updating" },
				null,
			),
		).toEqual({ state: "pending" });
		expect(
			swarmUpdateOutcome(
				{ StartedAt: "2026-09-17T11:00:00Z", State: "completed" },
				"2026-09-17T10:00:00Z",
			),
		).toEqual({ state: "completed" });
		const failed = swarmUpdateOutcome(
			{
				Message: "update rolled back due to failure",
				StartedAt: "2026-09-17T11:00:00Z",
				State: "rollback_completed",
			},
			null,
		);
		expect(failed).toMatchObject({ state: "failed" });
		expect(failed.state === "failed" && failed.reason).toContain(
			"update rolled back due to failure",
		);
	});
});
