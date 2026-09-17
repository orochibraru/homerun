import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { outputTail, stopAroundWork } = await import(
	"../../../src/lib/services/backup/volume-services"
);

function recorder(failures: { start?: string[]; stop?: string[] } = {}) {
	const events: string[] = [];
	const startFailures: string[] = [];
	return {
		events,
		hooks: {
			onStartFailure: (service: string) => {
				startFailures.push(service);
			},
			start: async (service: string) => {
				events.push(`start:${service}`);
				if (failures.start?.includes(service)) {
					throw new Error(`can't start ${service}`);
				}
			},
			stop: async (service: string) => {
				if (failures.stop?.includes(service)) {
					throw new Error(`can't stop ${service}`);
				}
				events.push(`stop:${service}`);
			},
		},
		startFailures,
	};
}

describe("stopAroundWork", () => {
	test("stops every service, runs the work, then starts them again", async () => {
		const { events, hooks } = recorder();
		const result = await stopAroundWork(["db", "api"], hooks, async () => {
			events.push("work");
			return 42;
		});
		expect(result).toBe(42);
		expect(events).toEqual([
			"stop:db",
			"stop:api",
			"work",
			"start:db",
			"start:api",
		]);
	});

	test("starts the services again when the work throws", async () => {
		const { events, hooks } = recorder();
		await expect(
			stopAroundWork(["db"], hooks, () => Promise.reject(new Error("tar"))),
		).rejects.toThrow("tar");
		expect(events).toEqual(["stop:db", "start:db"]);
	});

	test("a failed stop skips the work and restarts only what was stopped", async () => {
		const { events, hooks } = recorder({ stop: ["api"] });
		const work = mock(async () => "done");
		await expect(stopAroundWork(["db", "api"], hooks, work)).rejects.toThrow(
			"can't stop api",
		);
		expect(work).not.toHaveBeenCalled();
		expect(events).toEqual(["stop:db", "start:db"]);
	});

	test("a failed start is reported, not thrown", async () => {
		const { hooks, startFailures } = recorder({ start: ["db"] });
		expect(await stopAroundWork(["db", "api"], hooks, async () => "ok")).toBe(
			"ok",
		);
		expect(startFailures).toEqual(["db"]);
	});
});

describe("outputTail", () => {
	test("keeps short output and trims long output to its end", () => {
		expect(outputTail("  done\n")).toBe("done");
		const long = `${"a".repeat(3000)}END`;
		const tail = outputTail(long);
		expect(tail.endsWith("END")).toBe(true);
		expect(tail.startsWith("...")).toBe(true);
		expect(tail.length).toBe(2003);
	});
});
