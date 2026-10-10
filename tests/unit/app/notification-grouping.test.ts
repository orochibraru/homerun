import { describe, expect, test } from "bun:test";
import {
	BURST_MAX_HOLD_MS,
	GROUP_WINDOW_MS,
	groupedMessage,
	NotificationGrouper,
	SCHEDULED_MAX_HOLD_MS,
	scheduledNotification,
} from "../../../src/lib/services/notification-grouping";
import {
	backupMessage,
	type ChannelMessage,
	cronJobMessage,
} from "../../../src/lib/services/notification-messages";

function msg(
	title: string,
	event: ChannelMessage["event"] = "update.succeeded",
	detail: string | null = null,
): ChannelMessage {
	return {
		detail,
		event,
		fields: [],
		link: `https://h.example.com/${title}`,
		serviceId: null,
		serviceName: null,
		timestamp: "2026-09-28T03:00:00.000Z",
		title,
	};
}

describe("NotificationGrouper", () => {
	test("sends the first message at once and groups the ones under a minute behind it", () => {
		const grouper = new NotificationGrouper();
		const first = msg("a");
		expect(grouper.add(first, false, 0)).toBe(first);
		expect(grouper.add(msg("b"), false, 20_000)).toBeNull();
		expect(grouper.add(msg("c"), false, 50_000)).toBeNull();
		expect(grouper.due(50_000 + GROUP_WINDOW_MS - 1, false)).toEqual([]);
		const [group] = grouper.due(50_000 + GROUP_WINDOW_MS, false);
		expect(group.scheduled).toBe(false);
		expect(group.messages.map((m) => m.title)).toEqual(["b", "c"]);
		expect(grouper.pending).toBe(false);
		const later = msg("d");
		expect(grouper.add(later, false, 50_000 + GROUP_WINDOW_MS)).toBe(later);
	});

	test("a steady trickle is still flushed after the burst cap", () => {
		const grouper = new NotificationGrouper();
		grouper.add(msg("a"), false, 0);
		for (let at = 30_000; at <= BURST_MAX_HOLD_MS + 30_000; at += 30_000) {
			grouper.add(msg(`m${at}`), false, at);
			const flushed = grouper.due(at, false);
			if (at - 30_000 >= BURST_MAX_HOLD_MS) {
				expect(flushed).toHaveLength(1);
				return;
			}
			expect(flushed).toEqual([]);
		}
		throw new Error("never flushed");
	});

	test("scheduled outcomes wait for the whole run, then for the cap", () => {
		const grouper = new NotificationGrouper();
		expect(grouper.add(msg("a"), true, 0)).toBeNull();
		expect(grouper.add(msg("b", "backup.failed"), true, 1_000)).toBeNull();
		expect(grouper.holdsScheduled).toBe(true);
		expect(grouper.due(1_000 + GROUP_WINDOW_MS, true)).toEqual([]);
		const [group] = grouper.due(1_000 + GROUP_WINDOW_MS, false);
		expect(group).toEqual({
			messages: [msg("a"), msg("b", "backup.failed")],
			scheduled: true,
		});

		grouper.add(msg("c"), true, 0);
		expect(grouper.due(SCHEDULED_MAX_HOLD_MS - 1, true)).toEqual([]);
		expect(grouper.due(SCHEDULED_MAX_HOLD_MS, true)).toHaveLength(1);
	});

	test("clear forgets held messages and the last send", () => {
		const grouper = new NotificationGrouper();
		grouper.add(msg("a"), false, 0);
		grouper.add(msg("b"), false, 1);
		grouper.clear();
		expect(grouper.pending).toBe(false);
		const next = msg("c");
		expect(grouper.add(next, false, 2)).toBe(next);
	});
});

describe("groupedMessage", () => {
	test("counts outcomes, takes its first failure's event and link, and lists every failure's detail tail", () => {
		const detail = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
		const grouped = groupedMessage(
			[
				msg("web was updated"),
				msg("Backup of db failed", "backup.failed", detail),
				msg("api was updated"),
			],
			true,
		);
		expect(grouped.title).toBe("Scheduled tasks: 2 ok, 1 failed");
		expect(grouped.event).toBe("backup.failed");
		expect(grouped.link).toBe("https://h.example.com/Backup of db failed");
		expect(grouped.detail).toStartWith("Backup of db failed\nline 20");
		expect(grouped.detail).toEndWith("line 29");
		expect(grouped.serviceId).toBeNull();
	});

	test("stacks one field per event, failures first, each a bulleted list", () => {
		const grouped = groupedMessage(
			[
				msg("web was updated"),
				msg("Backup of db failed", "backup.failed"),
				msg("api was updated"),
			],
			true,
		);
		expect(grouped.fields).toEqual([
			{
				inline: false,
				name: "Backup failed (1)",
				value: "• Backup of db failed",
			},
			{
				inline: false,
				name: "Update succeeded (2)",
				value: "• web was updated\n• api was updated",
			},
		]);
	});

	test("caps each event's list and says how many it left out", () => {
		const grouped = groupedMessage(
			Array.from({ length: 25 }, (_, i) => msg(`s${i}`)),
			false,
		);
		expect(grouped.title).toBe("25 notifications: 25 ok");
		expect(grouped.detail).toBeNull();
		expect(grouped.fields).toHaveLength(1);
		const lines = grouped.fields[0].value.split("\n");
		expect(lines).toHaveLength(16);
		expect(lines.at(-1)).toBe("• and 10 more");
	});
});

describe("scheduledNotification", () => {
	test("a lone outcome keeps its own title, service and detail", () => {
		const only = {
			...msg("Backup of db failed", "backup.failed", "S3 PUT failed"),
			serviceId: "svc-1",
		};
		expect(scheduledNotification([only])).toEqual({
			detail: "S3 PUT failed",
			message: "Backup of db failed",
			serviceId: "svc-1",
			type: "scheduled_failure",
		});
	});

	test("several outcomes become the summary, listed by event", () => {
		expect(
			scheduledNotification([msg("web was updated"), msg("api was updated")]),
		).toEqual({
			detail: "Update succeeded (2)\n• web was updated\n• api was updated",
			message: "Scheduled tasks: 2 ok",
			type: "scheduled_summary",
		});
	});
});

describe("backup and cron job messages", () => {
	test("a failed backup carries its error, a good one its key and size", () => {
		const base = {
			attempts: 2,
			origin: "https://h.example.com/",
			scheduled: true,
			volume: { id: "vol-1", name: "gitea" },
		};
		const failed = backupMessage(
			{
				...base,
				error: "S3 PUT failed: 504",
				key: null,
				ok: false,
				sizeBytes: null,
			},
			"t",
		);
		expect(failed.event).toBe("backup.failed");
		expect(failed.title).toBe("Backup of gitea failed");
		expect(failed.detail).toBe("S3 PUT failed: 504");
		expect(failed.link).toBe("https://h.example.com/storage/vol-1");
		expect(failed.fields).toContainEqual({ name: "Attempts", value: "2" });
		const ok = backupMessage(
			{
				...base,
				attempts: 1,
				error: null,
				key: "p/g.tar.gz",
				ok: true,
				sizeBytes: 3 * 1024 ** 3,
			},
			"t",
		);
		expect(ok.event).toBe("backup.succeeded");
		expect(ok.detail).toBeNull();
		expect(ok.fields).toEqual([
			{ name: "Trigger", value: "Scheduled" },
			{ name: "Key", value: "p/g.tar.gz" },
			{ name: "Size", value: "3.0 GiB" },
		]);
	});

	test("a failed cron job shows its error and output tail", () => {
		const message = cronJobMessage(
			{
				job: { id: "cj-1", name: "prune" },
				origin: null,
				outcome: {
					error: "exited 2",
					exitCode: 2,
					output: "a\n\nb\n",
					success: false,
				},
				scheduled: false,
			},
			"t",
		);
		expect(message.event).toBe("cron_job.failed");
		expect(message.detail).toBe("exited 2\n\na\nb");
		expect(message.fields).toEqual([
			{ name: "Trigger", value: "Manual" },
			{ name: "Exit code", value: "2" },
		]);
		expect(message.link).toBeNull();
	});
});
