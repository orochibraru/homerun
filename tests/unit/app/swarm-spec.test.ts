import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const {
	initialOrchestrationMode,
	swarmMount,
	swarmNetworksFor,
	swarmRestartCondition,
	swarmUnavailableReason,
} = await import("../../../src/lib/services/docker/swarm");

describe("swarmUnavailableReason", () => {
	test("explains a rootless daemon and points at the migration", () => {
		expect(swarmUnavailableReason(["name=rootless"])).toContain(
			"--migrate-to-rootful",
		);
	});

	test("is null for a system daemon or no options", () => {
		expect(swarmUnavailableReason(["name=seccomp,profile=builtin"])).toBe(null);
		expect(swarmUnavailableReason(undefined)).toBe(null);
	});
});

describe("initialOrchestrationMode", () => {
	test("a rootful swarm manager starts in swarm mode", () => {
		expect(
			initialOrchestrationMode({
				SecurityOptions: ["name=seccomp,profile=builtin"],
				Swarm: { ControlAvailable: true, LocalNodeState: "active" },
			}),
		).toBe("swarm");
	});

	test("a daemon outside any swarm, or only a worker, starts standalone", () => {
		expect(
			initialOrchestrationMode({
				Swarm: { ControlAvailable: false, LocalNodeState: "inactive" },
			}),
		).toBe("standalone");
		expect(
			initialOrchestrationMode({
				Swarm: { ControlAvailable: false, LocalNodeState: "active" },
			}),
		).toBe("standalone");
		expect(initialOrchestrationMode({})).toBe("standalone");
	});

	test("a rootless daemon starts standalone even if it reports a swarm", () => {
		expect(
			initialOrchestrationMode({
				SecurityOptions: ["name=rootless"],
				Swarm: { ControlAvailable: true, LocalNodeState: "active" },
			}),
		).toBe("standalone");
	});
});

describe("swarmMount", () => {
	test("an absolute source is a bind mount", () => {
		expect(
			swarmMount({
				containerPath: "/data",
				readOnly: true,
				source: "/srv/app",
			}),
		).toEqual({
			ReadOnly: true,
			Source: "/srv/app",
			Target: "/data",
			Type: "bind",
		});
	});

	test("anything else is a named volume, which a bind mount would reject", () => {
		expect(
			swarmMount({
				containerPath: "/data",
				readOnly: false,
				source: "app-data",
			}),
		).toEqual({
			ReadOnly: false,
			Source: "app-data",
			Target: "/data",
			Type: "volume",
		});
	});
});

describe("swarmNetworksFor", () => {
	test("bridge services join the overlay under their slug", () => {
		expect(swarmNetworksFor("bridge", "homerun-swarm", "api")).toEqual([
			{ Aliases: ["api"], Target: "homerun-swarm" },
		]);
		expect(swarmNetworksFor(undefined, "homerun-swarm", "api")).toEqual([
			{ Aliases: ["api"], Target: "homerun-swarm" },
		]);
	});

	test("host networking attaches to the host network only", () => {
		expect(swarmNetworksFor("host", "homerun-swarm", "api")).toEqual([
			{ Target: "host" },
		]);
	});
});

describe("swarmRestartCondition", () => {
	test("maps every restart policy the service form offers", () => {
		expect(swarmRestartCondition("no")).toBe("none");
		expect(swarmRestartCondition("on-failure")).toBe("on-failure");
		expect(swarmRestartCondition("always")).toBe("any");
		expect(swarmRestartCondition("unless-stopped")).toBe("any");
	});
});
