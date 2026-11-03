import { describe, expect, test } from "bun:test";

import {
	type ActivityEvent,
	activityLanes,
	activityTicks,
	deploymentEvent,
} from "../../../src/lib/activity-lanes";

const window = { from: 0, to: 1000 };

function event(at: number, lane: ActivityEvent["lane"], failed = false) {
	return { actor: null, at, detail: [], failed, lane, summary: `at ${at}` };
}

describe("activityLanes", () => {
	test("keeps every lane, empty ones included, in a fixed order", () => {
		const lanes = activityLanes([], window);
		expect(lanes.map((lane) => lane.id)).toEqual([
			"deploys",
			"config",
			"networking",
			"storage",
			"lifecycle",
		]);
		expect(lanes.map((lane) => lane.label)).toEqual([
			"Deploys",
			"Config",
			"Networking",
			"Storage",
			"Lifecycle",
		]);
		expect(lanes.every((lane) => lane.clusters.length === 0)).toBe(true);
	});

	test("clusters events close together and keeps the rest apart", () => {
		const [, config] = activityLanes(
			[
				event(500, "config"),
				event(100, "config"),
				event(110, "config", true),
				event(900, "config"),
				event(100, "storage"),
			],
			window,
		);
		expect(config.clusters).toHaveLength(3);
		expect(config.clusters[0].events.map((e) => e.at)).toEqual([100, 110]);
		expect(config.clusters[0].position).toBeCloseTo(0.105);
		expect(config.clusters[0].failed).toBe(true);
		expect(config.clusters[1].failed).toBe(false);
		expect(config.clusters[2].position).toBe(0.9);
	});

	test("drops events outside the window", () => {
		const [deploys] = activityLanes(
			[event(-5, "deploys"), event(1001, "deploys"), event(1000, "deploys")],
			window,
		);
		expect(deploys.clusters.map((cluster) => cluster.position)).toEqual([1]);
	});
});

describe("activityTicks", () => {
	test("spreads the axis evenly from start to end", () => {
		expect(activityTicks(window, 3)).toEqual([0, 500, 1000]);
		expect(activityTicks(window, 1)).toEqual([1000]);
		expect(activityTicks(window)).toHaveLength(7);
	});
});

describe("deploymentEvent", () => {
	const base = {
		actorName: null,
		createdAt: new Date(42),
		errorMessage: null,
		gitCommit: null,
		imageRef: null,
		rollbackOfDeploymentId: null,
		status: "running" as const,
		trigger: "manual" as const,
	};

	test("reads a finished deploy with who ran it", () => {
		expect(
			deploymentEvent({
				...base,
				actorName: "Ada",
				gitCommit: "0123456789",
				imageRef: "nginx:1",
			}),
		).toEqual({
			actor: "Ada",
			at: 42,
			detail: ["nginx:1", "Commit 0123456"],
			failed: false,
			lane: "deploys",
			summary: "Deployed",
		});
	});

	test("names an automatic trigger when nobody started it", () => {
		expect(
			deploymentEvent({ ...base, status: "pending", trigger: "push" }),
		).toMatchObject({ actor: "Git push", summary: "Deploy in progress" });
		expect(deploymentEvent({ ...base, trigger: null }).actor).toBeNull();
	});

	test("flags failures and reads rollbacks as such", () => {
		expect(
			deploymentEvent({ ...base, errorMessage: "boom", status: "failed" }),
		).toMatchObject({
			detail: ["boom"],
			failed: true,
			summary: "Deploy failed",
		});
		expect(
			deploymentEvent({ ...base, rollbackOfDeploymentId: "d1" }).summary,
		).toBe("Rolled back");
		expect(
			deploymentEvent({
				...base,
				rollbackOfDeploymentId: "d1",
				status: "failed",
			}).summary,
		).toBe("Rollback failed");
		expect(
			deploymentEvent({
				...base,
				rollbackOfDeploymentId: "d1",
				trigger: "promote",
			}).summary,
		).toBe("Deployed");
	});
});
