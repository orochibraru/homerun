import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { deployedServices, OrchestrationService } = await import(
	"../../../src/lib/services/orchestration.service"
);
const { DockerService } = await import(
	"../../../src/lib/services/docker.service"
);
const { DeploymentService } = await import(
	"../../../src/lib/services/deploy.service"
);
const { UserService } = await import("../../../src/lib/services/user.service");
const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
const { Logger } = await import("../../../src/lib/logger");

describe("deployedServices", () => {
	test("keeps services with a container or a swarm service, drops never-deployed ones", () => {
		const services = [
			{ containerId: "abc", id: "container", swarmServiceId: null },
			{ containerId: null, id: "swarm", swarmServiceId: "xyz" },
			{ containerId: null, id: "never", swarmServiceId: null },
		];
		expect(deployedServices(services).map((service) => service.id)).toEqual([
			"container",
			"swarm",
		]);
	});
});

describe("OrchestrationService.applyOnBoot", () => {
	type Settings = Parameters<typeof OrchestrationService.applyOnBoot>[0];

	const events: string[] = [];
	let adminId: string | null = "admin-1";

	function fakeSettings(pendingServiceRedeploy: boolean) {
		const settings = {
			clearPendingServiceRedeploy: async () => {
				events.push("cleared");
				settings.pendingServiceRedeploy = false;
			},
			pendingServiceRedeploy,
			updateOrchestrationMode: async (mode: string) => {
				events.push(`mode:${mode}`);
			},
		};
		return settings as typeof settings & Settings;
	}

	beforeEach(() => {
		events.length = 0;
		adminId = "admin-1";
		stub(DockerService, "detectInitialOrchestrationMode", async () => "swarm");
		stub(UserService, "firstAdminId", async () => adminId);
		stub(ServiceDTO, "list", async () => [
			{ containerId: "c1", id: "a", swarmServiceId: null },
			{ containerId: null, id: "never", swarmServiceId: null },
			{ containerId: null, id: "b", swarmServiceId: "sw1" },
		]);
		stub(
			DeploymentService,
			"enqueueDeploy",
			async ({ svc, userId }: { svc: { id: string }; userId: string }) => {
				events.push(`deploy:${svc.id}:${userId}`);
			},
		);
		stub(Logger.prototype, "info", () => undefined);
		stub(Logger.prototype, "warn", (message: string) => {
			events.push(`warn:${message}`);
		});
	});

	afterEach(restoreStubs);

	test("a brand new instance stores the detected mode and queues nothing", async () => {
		await OrchestrationService.applyOnBoot(fakeSettings(false), true);

		expect(events).toEqual(["mode:swarm"]);
	});

	test("an existing instance keeps its mode", async () => {
		await OrchestrationService.applyOnBoot(fakeSettings(false), false);

		expect(events).toEqual([]);
	});

	test("a pending redeploy queues every deployed service as the first admin, then clears the request", async () => {
		const settings = fakeSettings(true);

		await OrchestrationService.applyOnBoot(settings, false);

		expect(events).toEqual(["deploy:a:admin-1", "deploy:b:admin-1", "cleared"]);
		expect(settings.pendingServiceRedeploy).toBe(false);
	});

	test("a pending redeploy with no admin to run it as is left pending", async () => {
		adminId = null;
		const settings = fakeSettings(true);

		await OrchestrationService.applyOnBoot(settings, true);

		expect(events).toEqual([
			"mode:swarm",
			"warn:Redeploy requested, but there's no admin to run it as",
		]);
		expect(settings.pendingServiceRedeploy).toBe(true);
	});
});
