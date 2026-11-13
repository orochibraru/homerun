import { afterEach, describe, expect, mock, test } from "bun:test";

import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { ResourceInsightsService } =
	await import("../../../src/lib/services/resource-insights.service");
const { SystemStatsService } =
	await import("../../../src/lib/services/system-stats.service");
const { WorkerClient } = await import("../../../src/lib/server/worker-client");
const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
const { CronJobDTO } = await import("../../../src/lib/dto/cron-job-dto");
const { WorkstationDTO } = await import("../../../src/lib/dto/workstation-dto");
const { AgentClientService } =
	await import("../../../src/lib/services/agent-client.service");

const GB = 1024 * 1024 * 1024;

function stubHost() {
	stub(SystemStatsService, "getSystemStats", async () => ({
		cpuPercent: 90,
		diskTotalGb: 100,
		diskUsedGb: 80,
		gpu: null,
		memTotalMb: 8000,
		memUsedMb: 6000,
	}));
	stub(ServiceDTO, "list", async () => [{ id: "svc-1", name: "web" }]);
	stub(CronJobDTO, "list", async () => [{ id: "cron-1", name: "nightly" }]);
	stub(WorkstationDTO, "listAll", async () => [
		{ id: "ws-1", name: "box", userId: "owner" },
	]);
}

function stubWorker(df: unknown = {}, processes: unknown = []) {
	const containers = [
		{
			cpuPercent: 240,
			hostCpuPercent: 60,
			id: "a",
			image: "nginx",
			labels: { "homerun.service.id": "svc-1" },
			memUsedMb: 2000,
			name: "web-1",
		},
		{
			cpuPercent: 40,
			hostCpuPercent: 10,
			id: "b",
			image: "code-server",
			labels: { "homerun.workstation.id": "ws-1" },
			memUsedMb: 1000,
			name: "homerun-workstation-ws-1",
		},
		{
			cpuPercent: 20,
			hostCpuPercent: 5,
			id: "c",
			image: "alpine",
			labels: { "homerun.cronjob.id": "cron-1" },
			memUsedMb: 0,
			name: "cron",
		},
		{
			cpuPercent: 8,
			hostCpuPercent: 2,
			id: "d",
			image: "docker:cli",
			labels: { "homerun.helper": "build" },
			memUsedMb: 500,
			name: "homerun-build-x",
		},
	];
	stub(WorkerClient, "get", async (path: string) => {
		if (path === "/v1/df") {
			return df;
		}
		return path === "/v1/host/processes" ? processes : containers;
	});
}

describe("ResourceInsightsService", () => {
	afterEach(restoreStubs);

	test("CPU names each container after what it runs for, biggest first, plus what's outside containers", async () => {
		stubHost();
		stubWorker();
		const insight = await ResourceInsightsService.insight("cpu", "owner");
		expect(insight.percent).toBe(90);
		expect(
			insight.consumers.map((c) => [c.label, c.kind, c.amount, c.link]),
		).toEqual([
			["web", "service", "60%, 2.4 cores", { id: "svc-1", kind: "service" }],
			["Outside containers", "other", "13%", null],
			[
				"Workstation box",
				"workstation",
				"10%, 0.4 cores",
				{ id: "ws-1", kind: "workstation" },
			],
			[
				"Cron job nightly",
				"cron job",
				"5.0%, 0.2 cores",
				{ id: "cron-1", kind: "cronJob" },
			],
			["homerun-build-x", "helper", "2.0%, 0.1 cores", null],
		]);
	});

	test("what's outside containers is split into the host's biggest processes, and the rest", async () => {
		stubHost();
		stubWorker({}, [
			{
				container: false,
				count: 1,
				cpuPercent: 9,
				group: "docker.service",
				memUsedMb: 1200,
				name: "slirp4netns",
			},
			{
				container: true,
				count: 4,
				cpuPercent: 50,
				group: "abcdefabcdef",
				memUsedMb: 900,
				name: "nginx",
			},
			{
				container: false,
				count: 3,
				cpuPercent: 0.2,
				group: "system.slice",
				memUsedMb: 10,
				name: "sshd",
			},
		]);
		const cpu = await ResourceInsightsService.insight("cpu");
		const outside = cpu.consumers.filter(
			(c) => c.kind === "process" || c.kind === "other",
		);
		expect(outside.map((c) => [c.label, c.amount, c.detail])).toEqual([
			[
				"slirp4netns",
				"9.0%",
				"Rootless Docker's network: every container's traffic goes through it. Outside containers, in docker.service",
			],
			[
				"Rest outside containers",
				"4.0%",
				"The system and anything this host runs outside Docker, measured as what the containers don't account for",
			],
		]);
		const memory = await ResourceInsightsService.insight("memory");
		expect(
			memory.consumers
				.filter((c) => c.kind === "process" || c.kind === "other")
				.map((c) => [c.label, c.amount]),
		).toEqual([
			["Rest outside containers", "1.3 GB"],
			["slirp4netns", "1.2 GB"],
		]);
	});

	test("a remote host's causes are its agent's busiest processes, containers' included, and none for its disk", async () => {
		stub(
			AgentClientService,
			"request",
			async (_connection: unknown, _method: string, path: string) => {
				expect(path).toBe("/v1/processes");
				return [
					{
						container: false,
						count: 1,
						cpuPercent: 3,
						group: "user.slice",
						memUsedMb: 4000,
						name: "java",
					},
					{
						container: true,
						count: 2,
						cpuPercent: 40,
						group: "abcdefabcdef",
						memUsedMb: 100,
						name: "node",
					},
				];
			},
		);
		const connection = { agentUrl: "http://agent", token: "t" };
		expect(
			await ResourceInsightsService.remoteCauses(connection, "cpu", 1),
		).toEqual([{ amount: "40%", label: "node ×2 (container)" }]);
		expect(
			await ResourceInsightsService.remoteCauses(connection, "memory", 1),
		).toEqual([{ amount: "3.9 GB", label: "java" }]);
		expect(
			await ResourceInsightsService.remoteCauses(connection, "disk"),
		).toEqual([]);
		stub(AgentClientService, "request", async () => {
			throw new Error("agent down");
		});
		expect(
			await ResourceInsightsService.remoteCauses(connection, "cpu"),
		).toEqual([]);
	});

	test("someone else's workstation stays anonymous, and memory adds what's held outside containers", async () => {
		stubHost();
		stubWorker();
		const insight = await ResourceInsightsService.insight("memory", "someone");
		const labels = insight.consumers.map((c) => c.label);
		expect(labels).toContain("A workstation");
		expect(labels).not.toContain("Workstation box");
		expect(insight.percent).toBe(75);
		expect(insight.consumers[0]).toMatchObject({
			amount: "2.4 GB",
			label: "Outside containers",
		});
		expect(insight.consumers[1]).toMatchObject({
			amount: "2.0 GB",
			label: "web",
			share: 25,
		});
	});

	test("disk lists volumes one by one, images, unshared build cache, container layers and the rest", async () => {
		stubHost();
		stubWorker({
			BuildCache: [
				{ Shared: false, Size: 5 * GB },
				{ Shared: true, Size: 9 * GB },
			],
			Containers: [{ Names: ["/web-1"], SizeRw: 1 * GB }],
			Images: [{}, {}],
			LayersSize: 20 * GB,
			Volumes: [
				{ Name: "pgdata", UsageData: { Size: 30 * GB } },
				{ Name: "empty", UsageData: { Size: 0 } },
			],
		});
		const insight = await ResourceInsightsService.insight("disk");
		expect(insight.percent).toBe(80);
		expect(insight.consumers.map((c) => [c.label, c.amount])).toEqual([
			["pgdata", "30 GB"],
			["Everything else", "24 GB"],
			["Images", "20 GB"],
			["Build cache", "5.0 GB"],
			["web-1", "1.0 GB"],
		]);
	});

	test("causes are the biggest few, and nothing when the host can't be read", async () => {
		stubHost();
		stubWorker();
		expect(await ResourceInsightsService.causes("cpu", 2)).toEqual([
			{ amount: "60%, 2.4 cores", label: "web" },
			{ amount: "13%", label: "Outside containers" },
		]);
		stub(SystemStatsService, "getSystemStats", async () => {
			throw new Error("worker down");
		});
		expect(await ResourceInsightsService.causes("cpu")).toEqual([]);
	});
});
