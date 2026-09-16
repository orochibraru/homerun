import { describe, expect, test } from "bun:test";
import {
	HEALTH_WINDOW,
	healthVerdict,
	previousRevision,
	type RevisionLike,
	retainedRevisions,
	revisionImageRefs,
	splitRevisionRef,
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

	test("splitRevisionRef handles registry ports and pinned digests", () => {
		expect(splitRevisionRef("localhost:5000/app")).toEqual({
			image: "localhost:5000/app",
			tag: "latest",
		});
		expect(splitRevisionRef("nginx:1.27@sha256:abc")).toEqual({
			image: "nginx",
			tag: "1.27",
		});
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
