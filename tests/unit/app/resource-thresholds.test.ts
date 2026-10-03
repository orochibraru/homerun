import { afterEach, describe, expect, mock, test } from "bun:test";
import {
	DEFAULT_THRESHOLDS,
	describeReading,
	levelFor,
	parseThresholds,
	type ResourceReading,
	readResources,
	withDefaults,
} from "../../../src/lib/resource-thresholds";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { groupIncidentEvents, resourceAlertMessage } = await import(
	"../../../src/lib/services/capacity.service"
);
const { ResourceIncidentDTO } = await import(
	"../../../src/lib/dto/resource-incident-dto"
);
const { CapacityService, CapacityError } = await import(
	"../../../src/lib/services/capacity.service"
);
const { messageBody, discordPayload, NotificationChannelService } =
	await import("../../../src/lib/services/notification-channel.service");
const { InstanceSettingsDTO } = await import(
	"../../../src/lib/dto/instance-settings-dto"
);
const { NotificationDTO } = await import(
	"../../../src/lib/dto/notification-dto"
);
const { SystemStatsService } = await import(
	"../../../src/lib/services/system-stats.service"
);
const { WorkerClient } = await import("../../../src/lib/server/worker-client");

const host = {
	cpuPercent: 40.4,
	diskTotalGb: 100,
	diskUsedGb: 97,
	gpu: null,
	memTotalMb: 1000,
	memUsedMb: 870,
};

function reading(
	kind: ResourceReading["kind"],
	percent: number,
): ResourceReading {
	const threshold = DEFAULT_THRESHOLDS[kind];
	return { kind, level: levelFor(percent, threshold), percent, threshold };
}

describe("resource thresholds", () => {
	test("reads each category against its threshold, skipping a missing GPU", () => {
		expect(readResources(host, DEFAULT_THRESHOLDS)).toEqual([
			reading("cpu", 40),
			reading("memory", 87),
			reading("disk", 97),
		]);
		expect(levelFor(97, { hard: 95, soft: 85 })).toBe("hard");
		expect(describeReading(reading("disk", 97))).toBe(
			"Disk at 97% (hard limit 95%)",
		);
		expect(describeReading(reading("memory", 87))).toBe(
			"Memory at 87% (soft limit 85%)",
		);
	});

	test("a GPU counts its busiest of compute and memory", () => {
		const gpu = readResources(
			{
				...host,
				gpu: { memTotalMb: 1000, memUsedMb: 900, utilizationPercent: 10 },
			},
			DEFAULT_THRESHOLDS,
		).find((r) => r.kind === "gpu");
		expect(gpu?.percent).toBe(90);
	});

	test("stored thresholds fill in over the defaults", () => {
		expect(withDefaults(null)).toEqual(DEFAULT_THRESHOLDS);
		expect(withDefaults({ disk: { hard: 99 } }).disk).toEqual({
			hard: 99,
			soft: 85,
		});
	});

	test("the settings form needs whole percentages with soft under hard", () => {
		const form = (overrides: Record<string, string>) => (name: string) =>
			overrides[name] ?? (name.endsWith("Soft") ? "80" : "90");
		expect(parseThresholds(form({}))).toEqual({
			cpu: { hard: 90, soft: 80 },
			disk: { hard: 90, soft: 80 },
			gpu: { hard: 90, soft: 80 },
			memory: { hard: 90, soft: 80 },
		});
		expect(parseThresholds(form({ diskHard: "120" }))).toBe(
			"Disk thresholds must be whole percentages from 1 to 100.",
		);
		expect(parseThresholds(form({ cpuSoft: "95" }))).toBe(
			"CPU's soft threshold can't be above its hard one.",
		);
	});
});

describe("resourceAlertMessage", () => {
	test("a server-wide message has no service line, and says how long it lasted", () => {
		const incident = {
			id: "i1",
			kind: "memory" as const,
			lastNotifiedAt: 0,
			level: "soft" as const,
			peak: 91,
			startedAt: Date.parse("2026-09-25T09:58:00.000Z"),
		};
		const [alert] = groupIncidentEvents([
			{ incident, reading: reading("memory", 88), type: "open" },
		]);
		const message = resourceAlertMessage(
			alert as never,
			"https://homerun.example.com",
			"2026-09-25T10:00:00.000Z",
		);
		expect(message.serviceName).toBeNull();
		expect(message.title).toBe("Server resources running high");
		expect(messageBody(message)).not.toContain("Service:");
		expect(discordPayload(message).embeds[0]?.fields).toEqual([
			{
				inline: true,
				name: "Memory",
				value: "Memory at 88% (soft limit 85%) for 2 min",
			},
		]);
	});

	test("groups a check's events into critical, warning, reminders, then recoveries", () => {
		const incident = (
			kind: "cpu" | "disk" | "memory",
			level: "hard" | "soft",
		) => ({
			id: null,
			kind,
			lastNotifiedAt: 0,
			level,
			peak: 99,
			startedAt: 0,
		});
		const groups = groupIncidentEvents([
			{
				incident: incident("cpu", "soft"),
				reading: reading("cpu", 40),
				type: "recover",
			},
			{
				incident: incident("memory", "soft"),
				reading: reading("memory", 88),
				type: "remind",
			},
			{
				incident: incident("disk", "hard"),
				reading: reading("disk", 97),
				type: "escalate",
			},
		]);
		expect(groups.map((group) => [group.event, group.reminder])).toEqual([
			["resource.critical", false],
			["resource.warning", true],
			["resource.recovered", false],
		]);
		expect(
			resourceAlertMessage(groups[1] as never, null, "2026-09-25T10:00:00.000Z")
				.title,
		).toBe("Server resources still running high");
	});
});

describe("CapacityService", () => {
	afterEach(restoreStubs);

	function stubSettings() {
		stub(
			InstanceSettingsDTO,
			"get",
			async () =>
				({
					resourceAlertReminderMinutes: 30,
					resourceAlertSustainSeconds: 60,
					resourceThresholds: DEFAULT_THRESHOLDS,
				}) as never,
		);
	}

	function stubIncidents() {
		const opened: string[] = [];
		const updates: { level: string; resolved: boolean }[] = [];
		stub(ResourceIncidentDTO, "listOpen", async () => []);
		stub(ResourceIncidentDTO, "open", async (incident: { kind: string }) => {
			opened.push(incident.kind);
			return `incident-${incident.kind}`;
		});
		stub(ResourceIncidentDTO, "notificationCount", async () => 1);
		stub(
			ResourceIncidentDTO,
			"notified",
			async (
				incident: { level: string },
				_count: number,
				resolvedAt: Date | null,
			) => {
				updates.push({ level: incident.level, resolved: resolvedAt !== null });
			},
		);
		return { opened, updates };
	}

	test("a full disk alerts at once, memory only once it's stayed high for a minute, and each recovers", async () => {
		stubSettings();
		const incidents = stubIncidents();
		const inApp: string[] = [];
		const channels: string[] = [];
		stub(NotificationDTO, "notify", (input: { message: string }) => {
			inApp.push(input.message);
		});
		stub(NotificationChannelService, "notify", (message: { event: string }) => {
			channels.push(message.event);
		});

		const start = Date.now();
		stub(Date, "now", () => start);
		await CapacityService.evaluate(host);
		expect(channels).toEqual(["resource.critical"]);
		expect(inApp[0]).toBe(
			"Server past a hard resource limit: Disk at 97% (hard limit 95%)",
		);

		stub(Date, "now", () => start + 30_000);
		await CapacityService.evaluate(host);
		expect(channels).toEqual(["resource.critical"]);

		stub(Date, "now", () => start + 61_000);
		await CapacityService.evaluate(host);
		expect(channels).toEqual(["resource.critical", "resource.warning"]);
		expect(incidents.opened).toEqual(["disk", "memory"]);
		expect(await CapacityService.refusal()).toContain(
			"Disk at 97% (hard limit 95%)",
		);
		await expect(CapacityService.assertRoomForNewService()).rejects.toThrow(
			CapacityError,
		);

		stub(Date, "now", () => start + 120_000);
		await CapacityService.evaluate({ ...host, diskUsedGb: 10, memUsedMb: 100 });
		expect(channels.at(-1)).toBe("resource.recovered");
		expect(inApp.at(-1)).toContain("Disk back to");
		expect(incidents.updates.filter((update) => update.resolved)).toHaveLength(
			2,
		);
	});

	test("with no recent sample it reads the host itself, and never blocks when it can't", async () => {
		stubSettings();
		stub(NotificationDTO, "notify", () => undefined);
		stub(NotificationChannelService, "notify", () => undefined);
		const now = Date.now();
		stub(Date, "now", () => now + 10 * 60 * 1000);
		stub(SystemStatsService, "getSystemStats", async () => ({
			...host,
			diskUsedGb: 10,
		}));
		expect(await CapacityService.refusal()).toBeNull();

		stub(Date, "now", () => now + 20 * 60 * 1000);
		stub(SystemStatsService, "getSystemStats", async () => {
			throw new Error("worker down");
		});
		expect(await CapacityService.hardBreaches()).toEqual([]);
		await CapacityService.assertRoomForNewService();
	});
});

describe("SystemStatsService", () => {
	afterEach(restoreStubs);

	test("reads the worker's host stats, disk in GB", async () => {
		stub(WorkerClient, "get", async () => ({
			cpuPercent: 12,
			diskPercent: 50,
			diskTotalMb: 2048,
			diskUsedMb: 1024,
			gpu: null,
			memPercent: 25,
			memTotalMb: 4000,
			memUsedMb: 1000,
		}));
		expect(await SystemStatsService.getSystemStats()).toEqual({
			cpuPercent: 12,
			diskTotalGb: 2,
			diskUsedGb: 1,
			gpu: null,
			memTotalMb: 4000,
			memUsedMb: 1000,
		});
	});

	test("a disk the worker couldn't read stays unknown", async () => {
		stub(WorkerClient, "get", async () => ({
			cpuPercent: 0,
			diskPercent: null,
			diskTotalMb: null,
			diskUsedMb: null,
			gpu: null,
			memPercent: 0,
			memTotalMb: 1,
			memUsedMb: 0,
		}));
		const stats = await SystemStatsService.getSystemStats();
		expect([stats.diskTotalGb, stats.diskUsedGb]).toEqual([null, null]);
	});
});
