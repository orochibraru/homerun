import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/svelte";
import UpdateBlockers from "../../../src/lib/components/update-blockers.svelte";
import {
	isStaleJob,
	STALE_JOB_MS,
	STALE_PROGRESS_MS,
} from "../../../src/lib/services/queue/stale";
import {
	describeBlockers,
	preflightFrom,
	startRefusal,
	UNSUPPORTED_REASON,
} from "../../../src/lib/services/self-update/preflight";
import type { JobSummary } from "../../../src/lib/types";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);

function summary(overrides: Partial<JobSummary> = {}): JobSummary {
	return {
		attempts: 1,
		createdAt: ago(10 * 60_000),
		heartbeatAt: null,
		id: "job-1",
		serviceId: null,
		serviceName: null,
		stage: null,
		stale: false,
		startedAt: null,
		status: "running",
		title: "Back up db",
		type: "backup",
		workerId: null,
		...overrides,
	};
}

describe("isStaleJob", () => {
	const running = {
		heartbeatAt: null,
		stage: "execute" as const,
		startedAt: ago(STALE_JOB_MS + 1),
		status: "running" as const,
	};

	test("an execution no worker has heartbeated for over two minutes is stale", () => {
		expect(
			isStaleJob({ ...running, heartbeatAt: ago(STALE_JOB_MS + 1) }, NOW),
		).toBe(true);
		expect(isStaleJob({ ...running, heartbeatAt: ago(10_000) }, NOW)).toBe(
			false,
		);
	});

	test("never leased, the claim time counts instead", () => {
		expect(isStaleJob(running, NOW)).toBe(true);
		expect(isStaleJob({ ...running, startedAt: ago(30_000) }, NOW)).toBe(false);
		expect(isStaleJob({ ...running, startedAt: null }, NOW)).toBe(false);
	});

	test("a heartbeating execution with no progress for the watchdog window is stale", () => {
		const alive = { ...running, heartbeatAt: ago(5000) };
		expect(
			isStaleJob({ ...alive, progressAt: ago(STALE_PROGRESS_MS + 1) }, NOW),
		).toBe(true);
		expect(isStaleJob({ ...alive, progressAt: ago(60_000) }, NOW)).toBe(false);
		expect(isStaleJob({ ...alive, progressAt: null }, NOW)).toBe(false);
	});

	test("the app's own stages and anything not running are never stale", () => {
		for (const stage of [null, "prepare", "finalize", "finalizing"] as const) {
			expect(isStaleJob({ ...running, stage }, NOW)).toBe(false);
		}
		expect(isStaleJob({ ...running, status: "queued" }, NOW)).toBe(false);
	});
});

describe("preflightFrom", () => {
	test("ready with nothing in the way", () => {
		const check = preflightFrom(true, []);
		expect(check).toMatchObject({
			pendingDeploys: 0,
			ready: true,
			reason: null,
			runningJobs: 0,
		});
	});

	test("unsupported wins over jobs, and still lists them", () => {
		const blockers = [summary()];
		const check = preflightFrom(false, blockers);
		expect(check.ready).toBe(false);
		expect(check.reason).toBe(UNSUPPORTED_REASON);
		expect(check.blockers).toBe(blockers);
	});

	test("counts deploys first and says how many look stuck", () => {
		const check = preflightFrom(true, [
			summary({ id: "d1", stale: true, stage: "execute", type: "deploy" }),
			summary({ id: "d2", status: "queued", type: "deploy" }),
			summary({ id: "b1" }),
		]);
		expect(check.pendingDeploys).toBe(2);
		expect(check.runningJobs).toBe(2);
		expect(check.reason).toBe(
			"2 deployment(s) are queued or running. 1 of them look stuck. Wait for them to finish, or update anyway.",
		);
	});

	test("running jobs without a deploy", () => {
		expect(preflightFrom(true, [summary()]).reason).toBe(
			"1 job(s) are running. Wait for them to finish, or update anyway.",
		);
	});
});

describe("startRefusal", () => {
	const blocked = preflightFrom(true, [summary()]);

	test("refuses jobs in the way unless forced", () => {
		expect(startRefusal(blocked, { busy: true, force: false })).toBe(
			blocked.reason,
		);
		expect(startRefusal(blocked, { busy: true, force: true })).toBeNull();
	});

	test("refuses a busy worker unless forced", () => {
		const ready = preflightFrom(true, []);
		expect(startRefusal(ready, { busy: false, force: false })).toBeNull();
		expect(startRefusal(ready, { busy: true, force: false })).toContain(
			"still running",
		);
		expect(startRefusal(ready, { busy: true, force: true })).toBeNull();
	});

	test("force never overrides an install that can't update itself", () => {
		expect(
			startRefusal(preflightFrom(false, []), { busy: false, force: true }),
		).toBe(UNSUPPORTED_REASON);
		expect(
			startRefusal(
				{ ...blocked, ready: false, reason: null },
				{ busy: false, force: false },
			),
		).toBe("Homerun can't update right now.");
		expect(
			startRefusal(
				{ ...blocked, reason: null, supported: false },
				{ busy: false, force: true },
			),
		).toBe(UNSUPPORTED_REASON);
	});
});

test("describeBlockers names each job for the log", () => {
	expect(
		describeBlockers([
			summary({
				id: "d1",
				stage: "execute",
				stale: true,
				title: "Deploy web",
				type: "deploy",
			}),
			summary({
				id: "q1",
				status: "queued",
				title: "Deploy api",
				type: "deploy",
			}),
		]),
	).toBe(
		'deploy d1 "Deploy web" running/execute (stale); deploy q1 "Deploy api" queued',
	);
});

describe("UpdateBlockers", () => {
	test("lists each job with a stuck badge, a service link and its timings", () => {
		const { container, getByText, unmount } = render(UpdateBlockers, {
			jobs: [
				summary({
					heartbeatAt: new Date(Date.now() - 5 * 60_000),
					id: "d1",
					serviceId: "svc-1",
					serviceName: "web",
					stage: "execute",
					stale: true,
					startedAt: new Date(Date.now() - 10 * 60_000),
					title: "Deploy web",
					type: "deploy",
				}),
				summary({
					id: "q1",
					status: "queued",
					title: "Deploy api",
					type: "deploy",
				}),
			],
		});
		expect(container.querySelectorAll("li")).toHaveLength(2);
		expect(getByText("Stuck")).toBeTruthy();
		expect(getByText("web").getAttribute("href")).toBe("/services/svc-1");
		expect(container.textContent).toContain("started 10m ago");
		expect(container.textContent).toContain("last heartbeat 5m ago");
		expect(container.textContent).toContain("queued");
		unmount();
	});
});
