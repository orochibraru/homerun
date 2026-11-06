import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { db } = await import("../../../src/lib/server/db/lib");
const { DockerService } =
	await import("../../../src/lib/services/docker.service");
const { Logger } = await import("../../../src/lib/logger");
const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
const { ServiceLifecycleService } =
	await import("../../../src/lib/services/service-lifecycle.service");

let inserted: Record<string, unknown>[] = [];
let failInsert = false;
let warnings: unknown[] = [];

function thenable(value: unknown) {
	const proxy: object = new Proxy(
		{},
		{
			get(_target, prop) {
				if (prop === "then") {
					return (resolve: (result: unknown) => unknown) => resolve(value);
				}
				return () => proxy;
			},
		},
	);
	return proxy;
}

const row = {
	containerId: "c1",
	containerPort: 80,
	currentStatus: "running",
	envVars: { API_TOKEN: "hunter2" },
	id: "s1",
	name: "web",
	secretEnvKeys: ["API_TOKEN"],
	swarmServiceId: null,
};

beforeEach(() => {
	inserted = [];
	failInsert = false;
	warnings = [];
	stub(db, "select", () => thenable([{ ...row }]));
	stub(db, "update", () => thenable([]));
	stub(db, "insert", () => ({
		values: (values: Record<string, unknown>[]) => {
			if (failInsert) {
				return Promise.reject(new Error("db down"));
			}
			inserted.push(...values);
			return Promise.resolve();
		},
	}));
	stub(Logger.prototype, "warn", (...args: unknown[]) => {
		warnings.push(args);
	});
	stub(DockerService, "restartContainer", async () => undefined);
});

afterEach(restoreStubs);

describe("ServiceDTO.update", () => {
	test("records the settings that changed, with no actor outside a request", async () => {
		const svc = await ServiceDTO.get("s1");
		await svc?.update({ containerPort: 8080, currentStatus: "stopped" });
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({
			actorId: null,
			actorName: null,
			detail: ["Container port: 80 → 8080"],
			lane: "networking",
			serviceId: "s1",
		});
	});

	test("records nothing for a status-only write", async () => {
		const svc = await ServiceDTO.get("s1");
		await svc?.update({ currentStatus: "stopped" });
		expect(inserted).toEqual([]);
	});

	test("never stores an env value", async () => {
		const svc = await ServiceDTO.get("s1");
		await svc?.update({ envVars: { API_TOKEN: "correct-horse" } });
		expect(inserted[0]).toMatchObject({ summary: "Changed API_TOKEN" });
		expect(JSON.stringify(inserted)).not.toMatch(/hunter2|correct-horse/);
	});

	test("keeps the update when recording fails", async () => {
		failInsert = true;
		const svc = await ServiceDTO.get("s1");
		await svc?.update({ containerPort: 9090 });
		expect(svc?.toJSON().containerPort).toBe(9090);
		expect(warnings).toHaveLength(1);
	});
});

describe("ServiceLifecycleService", () => {
	test("puts a restart on the Lifecycle lane", async () => {
		const svc = await ServiceDTO.get("s1");
		if (!svc) {
			throw new Error("no service");
		}
		await ServiceLifecycleService.restartService(svc);
		expect(inserted).toMatchObject([
			{ kind: "restart", lane: "lifecycle", summary: "Restarted" },
		]);
	});
});
