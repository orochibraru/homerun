import { describe, expect, test } from "bun:test";
import {
	digestNotifications,
	ScheduledBellDigestClass,
} from "../../../src/lib/services/scheduled-bell-digest";

describe("digestNotifications", () => {
	test("a batch of one keeps the single-service message", () => {
		expect(
			digestNotifications([
				{ ok: true, serviceId: "s1", serviceName: "Grafana" },
			]),
		).toEqual([
			{
				message: '"Grafana" was auto-redeployed.',
				serviceId: "s1",
				type: "auto_redeploy",
			},
		]);
	});

	test("several outcomes become one success and one failure entry, each error listed", () => {
		expect(
			digestNotifications([
				{ ok: true, serviceId: "s1", serviceName: "Grafana" },
				{
					error: "pull failed",
					ok: false,
					serviceId: "s2",
					serviceName: "Gitea",
				},
				{ ok: true, serviceId: "s3", serviceName: "Outline" },
				{
					error: "unhealthy",
					ok: false,
					serviceId: "s4",
					serviceName: "Immich",
				},
			]),
		).toEqual([
			{
				message: "2 services were auto-redeployed: Grafana, Outline.",
				type: "auto_redeploy",
			},
			{
				message:
					"2 scheduled redeploys failed: Gitea (pull failed); Immich (unhealthy)",
				type: "deploy_failure",
			},
		]);
	});

	test("nothing buffered writes nothing", () => {
		expect(digestNotifications([])).toEqual([]);
	});
});

describe("ScheduledBellDigestClass", () => {
	test("holds outcomes until flushed, then writes the digest once", () => {
		const written: unknown[] = [];
		const digest = new ScheduledBellDigestClass((entry) => written.push(entry));
		digest.add({ ok: true, serviceId: "s1", serviceName: "Grafana" });
		digest.add({ ok: true, serviceId: "s2", serviceName: "Gitea" });
		expect(written).toEqual([]);
		digest.flush();
		expect(written).toEqual([
			{
				message: "2 services were auto-redeployed: Grafana, Gitea.",
				type: "auto_redeploy",
			},
		]);
		digest.flush();
		expect(written).toHaveLength(1);
	});
});
