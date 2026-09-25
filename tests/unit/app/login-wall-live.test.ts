import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { buildContainerLabels } = await import(
	"../../../src/lib/services/docker/labels"
);
const { cachedGateAccess, forgetGateAccess, GATE_RECHECK_MS } = await import(
	"../../../src/lib/server/gate-access-cache"
);

describe("login wall middleware labels", () => {
	test("only a service behind the login wall gets the forwardAuth middleware", () => {
		const labels = buildContainerLabels({
			authRequired: true,
			containerPort: 80,
			domains: ["app.example.org"],
			serviceId: "svc-1",
			slug: "app",
		});
		expect(
			labels["traefik.http.middlewares.app-auth.forwardauth.address"],
		).toContain("service=svc-1");
		expect(labels["traefik.http.routers.app.middlewares"]).toBe(
			"app-auth,app-retry",
		);
		expect(labels["traefik.http.routers.app-1.middlewares"]).toBe(
			"app-auth,app-retry",
		);
	});

	test("a public service never calls back into Homerun", () => {
		const labels = buildContainerLabels({
			containerPort: 80,
			domains: ["app.example.org"],
			serviceId: "svc-1",
			slug: "app",
		});
		expect(labels["traefik.http.routers.app.middlewares"]).toBe("app-retry");
		expect(Object.keys(labels).some((key) => key.includes("forwardauth"))).toBe(
			false,
		);
	});

	test("every domain gets its own router on the one shared backend", () => {
		const labels = buildContainerLabels({
			containerPort: 80,
			defaultDomainEnabled: false,
			domains: ["a.example.org", "b.example.org"],
			serviceId: "svc-1",
			slug: "app",
		});
		expect(labels["traefik.http.routers.app.rule"]).toBe(
			"Host(`a.example.org`)",
		);
		expect(labels["traefik.http.routers.app-1.rule"]).toBe(
			"Host(`b.example.org`)",
		);
		expect(labels["traefik.http.routers.app-1.service"]).toBe("app");
		expect(
			buildContainerLabels({
				containerPort: 80,
				defaultDomainEnabled: false,
				serviceId: "svc-1",
				slug: "app",
			})["traefik.enable"],
		).toBeUndefined();
	});

	test("every routed service retries requests that reach a workload that just went away", () => {
		const labels = buildContainerLabels({
			containerPort: 80,
			serviceId: "svc-1",
			slug: "app",
		});
		expect(labels["traefik.http.middlewares.app-retry.retry.attempts"]).toBe(
			"4",
		);
		expect(
			labels["traefik.http.middlewares.app-retry.retry.initialinterval"],
		).toBe("100ms");
	});

	test("a service that isn't publicly routed has no middleware to attach", () => {
		const labels = buildContainerLabels({
			containerPort: 80,
			dnsResolvable: false,
			serviceId: "svc-1",
			slug: "app",
		});
		expect(Object.keys(labels).some((key) => key.includes("auth"))).toBe(false);
	});
});

describe("gate access re-check cache", () => {
	const key = (userId: string, policyVersion = "v1") => ({
		policyVersion,
		serviceId: `svc-${crypto.randomUUID()}`,
		userId,
	});

	test("reuses a decision until the re-check interval passes", async () => {
		const entry = key(`user-${crypto.randomUUID()}`);
		let calls = 0;
		const check = async () => {
			calls += 1;
			return true;
		};
		expect(await cachedGateAccess(entry, check, 1000)).toBe(true);
		expect(
			await cachedGateAccess(entry, check, 1000 + GATE_RECHECK_MS - 1),
		).toBe(true);
		expect(calls).toBe(1);
		await cachedGateAccess(entry, check, 1000 + GATE_RECHECK_MS);
		expect(calls).toBe(2);
	});

	test("concurrent requests share one in-flight check", async () => {
		const entry = key(`user-${crypto.randomUUID()}`);
		let calls = 0;
		const check = async () => {
			calls += 1;
			await Bun.sleep(5);
			return false;
		};
		const results = await Promise.all([
			cachedGateAccess(entry, check, 1000),
			cachedGateAccess(entry, check, 1000),
		]);
		expect(results).toEqual([false, false]);
		expect(calls).toBe(1);
	});

	test("forgetting a user forces an immediate re-check", async () => {
		const userId = `user-${crypto.randomUUID()}`;
		const entry = key(userId);
		let allowed = true;
		const check = async () => allowed;
		expect(await cachedGateAccess(entry, check, 1000)).toBe(true);
		allowed = false;
		expect(await cachedGateAccess(entry, check, 1001)).toBe(true);
		forgetGateAccess(userId);
		expect(await cachedGateAccess(entry, check, 1002)).toBe(false);
	});

	test("a policy change is a fresh cache key", async () => {
		const entry = key(`user-${crypto.randomUUID()}`);
		let calls = 0;
		const check = async () => {
			calls += 1;
			return true;
		};
		await cachedGateAccess(entry, check, 1000);
		await cachedGateAccess({ ...entry, policyVersion: "v2" }, check, 1000);
		expect(calls).toBe(2);
	});

	test("a failed check isn't cached", async () => {
		const entry = key(`user-${crypto.randomUUID()}`);
		let calls = 0;
		const failing = async () => {
			calls += 1;
			throw new Error("database down");
		};
		await expect(cachedGateAccess(entry, failing, 1000)).rejects.toThrow();
		await expect(cachedGateAccess(entry, failing, 1001)).rejects.toThrow();
		expect(calls).toBe(2);
	});
});
