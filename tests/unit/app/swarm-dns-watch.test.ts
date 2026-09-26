import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { lostAliases } = await import(
	"../../../src/lib/services/cron/swarm-dns-watch"
);

const entry = (slug: string, resolved: boolean) => ({
	resolved,
	serviceId: `${slug}-id`,
	slug,
});

describe("lostAliases", () => {
	test("a slug that stopped resolving while others do is lost", () => {
		expect(
			lostAliases([
				entry("vortex-server", true),
				entry("vortex-redis", false),
				entry("vortex-worker", true),
			]).map((e) => e.slug),
		).toEqual(["vortex-redis"]);
	});

	test("when nothing resolves the app isn't on the network: restart nothing", () => {
		expect(lostAliases([entry("a", false), entry("b", false)])).toEqual([]);
		expect(lostAliases([])).toEqual([]);
	});
});

describe("SwarmDnsWatch tick", () => {
	test("restarts a service whose slug was lost, once per cooldown, and says so", async () => {
		const { afterEach: _afterEach } = await import("bun:test");
		const { restoreStubs, stub } = await import("../support/stub");
		const { SwarmDnsWatch } = await import(
			"../../../src/lib/services/cron/swarm-dns-watch"
		);
		const { InstanceSettingsDTO } = await import(
			"../../../src/lib/dto/instance-settings-dto"
		);
		const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
		const { NotificationDTO } = await import(
			"../../../src/lib/dto/notification-dto"
		);
		const { DockerService } = await import(
			"../../../src/lib/services/docker.service"
		);
		const svc = (slug: string) => ({
			id: `${slug}-id`,
			name: slug,
			slug,
			swarmServiceId: `${slug}-swarm`,
			toJSON: () => ({ networkMode: "bridge" }),
		});
		stub(InstanceSettingsDTO, "get", async () => ({
			orchestrationMode: "swarm",
		}));
		stub(ServiceDTO, "listRunningWithContainers", async () => [
			svc("vortex-server"),
			svc("vortex-redis"),
		]);
		const restarted: string[] = [];
		stub(DockerService, "restartSwarmService", async (id: string) => {
			restarted.push(id);
		});
		const notes: string[] = [];
		stub(NotificationDTO, "notify", (input: { message: string }) => {
			notes.push(input.message);
		});

		class TestWatch extends SwarmDnsWatch {
			protected override async resolves(name: string): Promise<boolean> {
				return name !== "vortex-redis";
			}
			run() {
				return this.tick();
			}
		}
		const watch = new TestWatch();
		await watch.run();
		await watch.run();
		restoreStubs();

		expect(restarted).toEqual(["vortex-redis-swarm"]);
		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain("vortex-redis");
	});
});

describe("SwarmDnsWatch edges", () => {
	test("a real lookup answers for localhost, and a failed restart is logged, not thrown", async () => {
		const { restoreStubs, stub } = await import("../support/stub");
		const { SwarmDnsWatch } = await import(
			"../../../src/lib/services/cron/swarm-dns-watch"
		);
		const { InstanceSettingsDTO } = await import(
			"../../../src/lib/dto/instance-settings-dto"
		);
		const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
		const { NotificationDTO } = await import(
			"../../../src/lib/dto/notification-dto"
		);
		const { DockerService } = await import(
			"../../../src/lib/services/docker.service"
		);
		class Probe extends SwarmDnsWatch {
			check(name: string) {
				return this.resolves(name);
			}
			run() {
				return this.tick();
			}
		}
		const probe = new Probe();
		expect(await probe.check("localhost")).toBe(true);
		expect(await probe.check("no-such-host.invalid")).toBe(false);

		stub(InstanceSettingsDTO, "get", async () => ({
			orchestrationMode: "swarm",
		}));
		stub(ServiceDTO, "listRunningWithContainers", async () => [
			{
				id: "a",
				name: "a",
				slug: "localhost",
				swarmServiceId: "a-swarm",
				toJSON: () => ({ networkMode: "bridge" }),
			},
			{
				id: "b",
				name: "b",
				slug: "no-such-host.invalid",
				swarmServiceId: "b-swarm",
				toJSON: () => ({ networkMode: "bridge" }),
			},
		]);
		stub(DockerService, "restartSwarmService", async () => {
			throw new Error("worker down");
		});
		stub(NotificationDTO, "notify", () => undefined);
		await probe.run();

		stub(InstanceSettingsDTO, "get", async () => ({
			orchestrationMode: "standalone",
		}));
		await probe.run();
		restoreStubs();
	});
});
