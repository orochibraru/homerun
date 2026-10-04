import { describe, expect, test } from "bun:test";
import {
	HISTORY_TRIGGERS,
	historyTrigger,
	historyTriggerLabel,
	isRollback,
} from "#lib/deploy-trigger.js";

describe("historyTrigger", () => {
	test("a rollback target wins over the job's trigger", () => {
		expect(historyTrigger("dep-1", "push")).toBe("rollback");
	});

	test("a promote keeps its trigger despite pointing at the preview revision", () => {
		expect(historyTrigger("dep-1", "promote")).toBe("promote");
		expect(isRollback("dep-1", "promote")).toBe(false);
		expect(isRollback("dep-1", null)).toBe(true);
		expect(isRollback(null, "manual")).toBe(false);
	});

	test("falls back to the deploy job's trigger", () => {
		expect(historyTrigger(null, "push")).toBe("push");
		expect(historyTrigger(null, "cron")).toBe("cron");
	});

	test("is null when the job is gone or its trigger is unknown", () => {
		expect(historyTrigger(null, null)).toBeNull();
		expect(historyTrigger(null, "bogus")).toBeNull();
	});
});

describe("historyTriggerLabel", () => {
	test("labels every trigger, and an unknown one as a plain deploy", () => {
		expect(historyTriggerLabel("rollback")).toBe("Rollback");
		expect(historyTriggerLabel("push")).toBe("Git push");
		expect(historyTriggerLabel("promote")).toBe("Promote");
		expect(historyTriggerLabel(null)).toBe("Deploy");
	});

	test("the history filter offers every trigger, promote included", () => {
		expect(HISTORY_TRIGGERS.map(historyTriggerLabel)).toEqual([
			"Manual",
			"Scheduled",
			"Git push",
			"Promote",
			"Rollback",
		]);
	});
});
