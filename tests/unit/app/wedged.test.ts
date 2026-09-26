import { describe, expect, test } from "bun:test";
import {
	type WedgedContainer,
	WedgedReporter,
	wedgedMessage,
} from "../../../src/lib/services/docker/wedged";

const stuck: WedgedContainer = {
	id: "0123456789abcdef0123",
	name: "backup-helper",
	since: "2026-09-26T18:07:00Z",
};
const other: WedgedContainer = {
	id: "fedcba9876543210fedc",
	name: "env-reader",
	since: "2026-09-26T18:12:00Z",
};

describe("wedgedMessage", () => {
	test("says nothing when nothing is wedged", () => {
		expect(wedgedMessage([])).toBeNull();
	});

	test("names the container and the one fix that clears it", () => {
		const message = wedgedMessage([stuck]) ?? "";
		expect(message).toContain("backup-helper (0123456789ab)");
		expect(message).toContain("sudo systemctl restart docker");
		expect(message).toContain("Traefik");
	});

	test("counts several", () => {
		expect(wedgedMessage([stuck, other])).toContain("2 helper containers");
	});
});

describe("WedgedReporter", () => {
	test("notifies once per newly wedged container, however often it's polled", () => {
		const reporter = new WedgedReporter();
		const sent: string[] = [];
		const notify = (message: string) => sent.push(message);

		reporter.report([stuck], notify);
		reporter.report([stuck], notify);
		expect(sent).toHaveLength(1);

		reporter.report([stuck, other], notify);
		expect(sent).toHaveLength(2);
		expect(sent[1]).toContain("env-reader");
		expect(sent[1]).not.toContain("backup-helper");
	});

	test("a container that clears and wedges again is reported again", () => {
		const reporter = new WedgedReporter();
		const sent: string[] = [];
		const notify = (message: string) => sent.push(message);

		reporter.report([stuck], notify);
		reporter.report([], notify);
		reporter.report([stuck], notify);
		expect(sent).toHaveLength(2);
	});
});
