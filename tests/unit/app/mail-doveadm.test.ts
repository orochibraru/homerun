import { describe, expect, test } from "bun:test";

const {
	isSmtpGreeting,
	overallState,
	parseMailboxStatus,
	parseQuota,
	queuedMessages,
} = await import("../../../src/lib/mail-doveadm");

describe("parseMailboxStatus", () => {
	test("reads every folder, INBOX first", () => {
		const output = [
			"mailbox\tmessages\tunseen\tvsize\tguid",
			"Trash\t3\t0\t2048\tg-trash",
			"INBOX\t12\t4\t1048576\tg-inbox",
			"Junk*\t-\t-\t0\tg-junk",
			"",
		].join("\n");
		expect(parseMailboxStatus(output)).toEqual([
			{
				guid: "g-inbox",
				messages: 12,
				name: "INBOX",
				sizeBytes: 1_048_576,
				unseen: 4,
			},
			{ guid: "g-junk", messages: 0, name: "Junk*", sizeBytes: 0, unseen: 0 },
			{
				guid: "g-trash",
				messages: 3,
				name: "Trash",
				sizeBytes: 2048,
				unseen: 0,
			},
		]);
	});

	test("an empty answer is no folders", () => {
		expect(parseMailboxStatus("")).toEqual([]);
	});
});

describe("parseQuota", () => {
	test("STORAGE is in kilobytes, a dash limit is none", () => {
		const output = [
			"Quota name\tType\tValue\tLimit\t%",
			"User quota\tSTORAGE\t2048\t512000\t0",
			"User quota\tMESSAGE\t42\t-\t0",
		].join("\n");
		expect(parseQuota(output)).toEqual({
			limitBytes: 512_000 * 1024,
			messageLimit: null,
			messages: 42,
			usedBytes: 2048 * 1024,
		});
	});
});

describe("mail server probes", () => {
	test("queue size from mailq", () => {
		expect(queuedMessages("Mail queue is empty\n")).toBe(0);
		expect(queuedMessages("-- 12 Kbytes in 3 Requests.\n")).toBe(3);
		expect(queuedMessages("-- 1 Kbytes in 1 Request.\n")).toBe(1);
	});

	test("an SMTP greeting starts with 220", () => {
		expect(isSmtpGreeting("220 mail.example.com ESMTP")).toBe(true);
		expect(isSmtpGreeting("554 go away")).toBe(false);
	});

	test("the worst check decides", () => {
		const check = (state: "fail" | "ok" | "warn") => ({
			detail: "",
			id: state,
			label: state,
			state,
		});
		expect(overallState([check("ok")])).toBe("ok");
		expect(overallState([check("ok"), check("warn")])).toBe("warn");
		expect(overallState([check("warn"), check("fail")])).toBe("fail");
	});
});
