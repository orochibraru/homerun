import { describe, expect, test } from "bun:test";
import {
	CLEARED_ON_SUPERSEDE,
	HEALTH_WINDOW,
	healthVerdict,
	previousRevision,
	type RevisionLike,
	retainedRevisions,
	revisionEntries,
	revisionImageRefs,
	revisionRoot,
	supersededHealth,
	swarmSampleFromTasks,
	type WorkloadHealthSample,
} from "../../../src/lib/revisions";

let clock = 0;

function revision(overrides: Partial<RevisionLike> = {}): RevisionLike {
	clock += 1000;
	return {
		buildSource: "image",
		createdAt: new Date(clock),
		health: "healthy",
		id: `rev-${clock}`,
		imageDigest: null,
		imageId: `sha256:${clock}`,
		imageRef: "nginx:1.27",
		rollbackOfDeploymentId: null,
		serviceId: "svc",
		status: "running",
		...overrides,
	};
}

describe("previousRevision", () => {
	test("picks the newest older revision with a different image", () => {
		const a = revision({ imageId: "sha256:a", imageRef: "nginx:1.26" });
		const b = revision({ imageId: "sha256:b", imageRef: "nginx:1.27" });
		const bAgain = revision({ imageId: "sha256:b", imageRef: "nginx:1.27" });
		expect(previousRevision([a, b, bAgain])?.id).toBe(a.id);
	});

	test("skips unhealthy, rolled back and failed deploys", () => {
		const good = revision({ imageId: "sha256:good" });
		const failed = revision({ imageId: "sha256:failed", status: "failed" });
		const unhealthy = revision({ health: "unhealthy", imageId: "sha256:bad" });
		const rolledBack = revision({
			health: "rolled_back",
			imageId: "sha256:worse",
		});
		const current = revision({ imageId: "sha256:new" });
		expect(
			previousRevision([current, rolledBack, unhealthy, failed, good])?.id,
		).toBe(good.id);
	});

	test("resolves relative to an explicit current revision, and a pre-health row still counts", () => {
		const legacy = revision({ health: null, imageId: null, imageRef: "app:1" });
		const watched = revision({ health: "watching", imageRef: "app:2" });
		const newer = revision({ imageRef: "app:3" });
		expect(previousRevision([legacy, watched, newer], watched.id)?.id).toBe(
			legacy.id,
		);
		expect(previousRevision([legacy])).toBeNull();
		expect(previousRevision([], null)).toBeNull();
	});
});

describe("retainedRevisions", () => {
	test("keeps the newest N distinct images per service", () => {
		const rows = [
			revision({ imageId: "sha256:1" }),
			revision({ imageId: "sha256:2" }),
			revision({ imageId: "sha256:2" }),
			revision({ imageId: "sha256:3" }),
			revision({ imageId: "sha256:x", serviceId: "other" }),
			revision({ imageId: "sha256:4", status: "failed" }),
			revision({ imageId: "sha256:5" }),
		];
		const kept = retainedRevisions(rows, 3);
		expect(kept.map((row) => row.imageId)).toEqual([
			"sha256:5",
			"sha256:x",
			"sha256:3",
			"sha256:2",
		]);
	});
});

describe("revisionEntries", () => {
	const options = { deployed: true, retainedLimit: 5 };

	function summary(rows: RevisionLike[], deployed = true) {
		return revisionEntries(rows, { ...options, deployed }).map((entry) => ({
			current: entry.current,
			health: entry.health,
			id: entry.revision.id,
			latest: entry.latest.id,
			previous: entry.previous,
			redeployCount: entry.redeployCount,
		}));
	}

	test("a rollback folds into the revision it redeployed, which keeps its place and becomes current", () => {
		const first = revision({ health: null, imageId: "sha256:a" });
		const second = revision({ health: null, imageId: "sha256:b" });
		const rollback = revision({
			health: "watching",
			imageId: "sha256:a",
			rollbackOfDeploymentId: first.id,
		});
		expect(summary([rollback, second, first])).toEqual([
			{
				current: false,
				health: null,
				id: second.id,
				latest: second.id,
				previous: true,
				redeployCount: 0,
			},
			{
				current: true,
				health: "watching",
				id: first.id,
				latest: rollback.id,
				previous: false,
				redeployCount: 1,
			},
		]);
		const entry = revisionEntries([rollback, second, first], options)[1];
		expect(entry?.lastDeployed?.id).toBe(rollback.id);
	});

	test("a redeploy of a redeploy still resolves to the original revision", () => {
		const first = revision({ imageId: "sha256:a" });
		const second = revision({ imageId: "sha256:b" });
		const back = revision({
			imageId: "sha256:a",
			rollbackOfDeploymentId: first.id,
		});
		const forward = revision({
			imageId: "sha256:b",
			rollbackOfDeploymentId: second.id,
		});
		const backAgain = revision({
			imageId: "sha256:a",
			rollbackOfDeploymentId: back.id,
		});
		const rows = [first, second, back, forward, backAgain];
		expect(revisionRoot(rows, backAgain).id).toBe(first.id);
		expect(summary(rows).map((entry) => [entry.id, entry.current])).toEqual([
			[second.id, false],
			[first.id, true],
		]);
		expect(summary(rows)[0]?.previous).toBe(true);
		expect(summary(rows)[1]?.redeployCount).toBe(2);
	});

	test("a failed rollback shows on its target as the latest attempt, without moving current", () => {
		const first = revision({ imageId: "sha256:a" });
		const second = revision({ health: "healthy", imageId: "sha256:b" });
		const failed = revision({
			health: null,
			imageId: null,
			imageRef: null,
			rollbackOfDeploymentId: first.id,
			status: "failed",
		});
		const entries = revisionEntries([first, second, failed], options);
		expect(entries.map((entry) => entry.revision.id)).toEqual([
			second.id,
			first.id,
		]);
		expect(entries[0]?.current).toBe(true);
		expect(entries[0]?.health).toBe("healthy");
		expect(entries[1]?.latest.status).toBe("failed");
		expect(entries[1]?.lastDeployed?.id).toBe(first.id);
	});

	test("a rollback whose target isn't loaded is its own entry, and cycles don't hang", () => {
		const orphan = revision({ rollbackOfDeploymentId: "gone" });
		const loopA = revision({ rollbackOfDeploymentId: "loop-b" });
		const loopB = revision({ id: "loop-b", rollbackOfDeploymentId: loopA.id });
		expect(revisionRoot([orphan], orphan).id).toBe(orphan.id);
		expect(revisionRoot([loopA, loopB], loopA).id).toBe(loopB.id);
		expect(summary([orphan]).map((entry) => entry.id)).toEqual([orphan.id]);
	});

	test("a superseded revision never shows a live health state, a failure outcome stays", () => {
		const stale = revision({ health: "healthy", imageId: "sha256:a" });
		const bad = revision({ health: "rolled_back", imageId: "sha256:b" });
		const current = revision({ health: "healthy", imageId: "sha256:c" });
		expect(summary([stale, bad, current]).map((entry) => entry.health)).toEqual(
			["healthy", "rolled_back", null],
		);
		expect(
			summary([stale, bad, current], false).map((entry) => entry.health),
		).toEqual([null, "rolled_back", null]);
	});

	test("failed deploys are entries of their own, nothing is current while the service isn't deployed", () => {
		const good = revision({ imageId: "sha256:a" });
		const failed = revision({
			imageId: null,
			imageRef: null,
			status: "failed",
		});
		const entries = revisionEntries([good, failed], {
			deployed: false,
			retainedLimit: 5,
		});
		expect(entries.map((entry) => entry.revision.id)).toEqual([
			failed.id,
			good.id,
		]);
		expect(entries.some((entry) => entry.current || entry.previous)).toBe(
			false,
		);
		expect(entries.map((entry) => entry.retained)).toEqual([false, true]);
	});

	test("retained follows the image, so an older deploy of a kept image counts as retained", () => {
		const old = revision({ imageId: "sha256:a" });
		const again = revision({ imageId: "sha256:a" });
		const other = revision({ imageId: "sha256:b" });
		const entries = revisionEntries([old, again, other], {
			deployed: true,
			retainedLimit: 1,
		});
		expect(entries.map((entry) => entry.retained)).toEqual([
			true,
			false,
			false,
		]);
	});
});

describe("supersededHealth", () => {
	test("clears only the live states, and the bulk clear uses the same set", () => {
		expect(supersededHealth("healthy")).toBeNull();
		expect(supersededHealth("watching")).toBeNull();
		expect(supersededHealth("unhealthy")).toBe("unhealthy");
		expect(supersededHealth("rolled_back")).toBe("rolled_back");
		expect(supersededHealth(null)).toBeNull();
		expect([...CLEARED_ON_SUPERSEDE].sort()).toEqual(["healthy", "watching"]);
	});
});

describe("revisionImageRefs", () => {
	test("a pulled revision is kept by id and digest, a git build by its unique tag", () => {
		expect(
			revisionImageRefs(
				revision({
					imageDigest: "sha256:dig",
					imageId: "sha256:id",
					imageRef: "ghcr.io/acme/api:1.2",
				}),
			),
		).toEqual(["sha256:id", "ghcr.io/acme/api@sha256:dig"]);
		expect(
			revisionImageRefs(
				revision({
					buildSource: "git",
					imageId: null,
					imageRef: "homerun-build-api:m1abc",
				}),
			),
		).toEqual(["homerun-build-api:m1abc"]);
	});
});

function container(
	overrides: Partial<Extract<WorkloadHealthSample, { kind: "container" }>> = {},
): WorkloadHealthSample {
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

describe("healthVerdict", () => {
	const early = HEALTH_WINDOW.windowMs - 1;
	const done = HEALTH_WINDOW.windowMs;

	test("a running container is pending inside the window and healthy after it", () => {
		expect(healthVerdict(container(), container(), early).verdict).toBe(
			"pending",
		);
		expect(healthVerdict(container(), container(), done).verdict).toBe(
			"healthy",
		);
	});

	test("an exit, a restart loop or a failing healthcheck is unhealthy right away", () => {
		expect(
			healthVerdict(
				container(),
				container({ exitCode: 1, state: "exited" }),
				5000,
			),
		).toEqual({
			reason: "The container exited with code 1.",
			verdict: "unhealthy",
		});
		expect(
			healthVerdict(
				container({ restartCount: 3 }),
				container({ restartCount: 5, state: "restarting" }),
				5000,
			).verdict,
		).toBe("unhealthy");
		expect(
			healthVerdict(
				container({ restartCount: 3 }),
				container({ restartCount: 4 }),
				done,
			).verdict,
		).toBe("healthy");
		expect(
			healthVerdict(
				container(),
				container({ health: "unhealthy", healthOutput: "curl: (7) refused" }),
				5000,
			),
		).toEqual({
			reason: "The healthcheck is failing: curl: (7) refused",
			verdict: "unhealthy",
		});
		expect(
			healthVerdict(container(), container({ state: "missing" }), 5000).verdict,
		).toBe("unhealthy");
	});

	test("a healthcheck still starting extends the window up to the max wait", () => {
		const starting = container({ health: "starting" });
		expect(healthVerdict(container(), starting, done).verdict).toBe("pending");
		expect(
			healthVerdict(container(), starting, HEALTH_WINDOW.maxWaitMs).verdict,
		).toBe("unhealthy");
	});

	test("swarm: failed tasks are unhealthy, missing replicas wait then fail", () => {
		const swarm = (running: number, failed: number): WorkloadHealthSample => ({
			desired: 2,
			failed,
			kind: "swarm",
			lastError: failed ? "task: non-zero exit (1)" : null,
			running,
		});
		expect(healthVerdict(swarm(0, 0), swarm(0, 2), 5000).verdict).toBe(
			"unhealthy",
		);
		expect(healthVerdict(swarm(0, 0), swarm(2, 1), done).verdict).toBe(
			"healthy",
		);
		expect(healthVerdict(swarm(0, 0), swarm(1, 0), done).verdict).toBe(
			"pending",
		);
		expect(
			healthVerdict(swarm(0, 0), swarm(1, 0), HEALTH_WINDOW.maxWaitMs).verdict,
		).toBe("unhealthy");
	});
});

describe("swarmSampleFromTasks", () => {
	const since = new Date("2026-09-17T16:05:14.598Z");

	test("counts a running task created during the rollout, before the watch started", () => {
		const sample = swarmSampleFromTasks(
			[
				{
					CreatedAt: "2026-09-17T16:04:50.553Z",
					DesiredState: "running",
					Status: { State: "running" },
				},
				{
					CreatedAt: "2026-09-17T14:04:00.000Z",
					DesiredState: "shutdown",
					Status: { State: "shutdown" },
				},
			],
			1,
			since,
		);
		expect(sample.running).toBe(1);
		expect(sample.failed).toBe(0);
	});

	test("doesn't count a task swarm is shutting down as running", () => {
		const sample = swarmSampleFromTasks(
			[
				{
					CreatedAt: "2026-09-17T16:06:00.000Z",
					DesiredState: "shutdown",
					Status: { State: "running" },
				},
			],
			1,
			since,
		);
		expect(sample.running).toBe(0);
	});

	test("only counts failures since the watch started, with the latest error", () => {
		const rejected = (createdAt: string, err: string) => ({
			CreatedAt: createdAt,
			DesiredState: "shutdown",
			Status: { Err: err, State: "rejected" },
		});
		const sample = swarmSampleFromTasks(
			[
				rejected("2026-09-17T13:32:20.000Z", "old revision"),
				rejected("2026-09-17T16:06:00.000Z", "mount missing"),
				rejected("2026-09-17T16:06:10.000Z", "mount still missing"),
			],
			1,
			since,
		);
		expect(sample.failed).toBe(2);
		expect(sample.lastError).toBe("mount still missing");
	});
});
