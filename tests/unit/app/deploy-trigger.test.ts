import { describe, expect, test } from "bun:test";
import { historyTrigger, historyTriggerLabel } from "$lib/deploy-trigger";

describe("historyTrigger", () => {
	test("a rollback target wins over the job's trigger", () => {
		expect(historyTrigger("dep-1", "push")).toBe("rollback");
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
		expect(historyTriggerLabel(null)).toBe("Deploy");
	});
});
