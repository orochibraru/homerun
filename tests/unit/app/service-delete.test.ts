import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

let removeError: unknown = null;
const removed: string[] = [];

mock.module("../../../src/lib/services/docker.service.ts", () => ({
	DockerService: {
		removeContainer: async (id: string) => {
			if (removeError) {
				throw removeError;
			}
			removed.push(id);
		},
		removeSwarmService: async (id: string) => {
			if (removeError) {
				throw removeError;
			}
			removed.push(id);
		},
	},
}));

const webhooksRemoved: string[] = [];

mock.module("../../../src/lib/services/git-webhook.service.ts", () => ({
	GitWebhookService: {
		remove: async (svc: { id: string }) => {
			webhooksRemoved.push(svc.id);
		},
	},
}));

const { ServiceLifecycleService } = await import(
	"../../../src/lib/services/service-lifecycle.service"
);
const { removalFailure, tryRemoveWorkload, WorkloadDetachError } = await import(
	"../../../src/lib/services/docker/workload-removal"
);

type Svc = Parameters<typeof ServiceLifecycleService.deleteService>[0];

function fakeService(overrides: Partial<Record<string, unknown>> = {}) {
	const state = { deleted: false };
	const svc = {
		containerId: "c1",
		delete: async () => {
			state.deleted = true;
		},
		id: "s1",
		name: "web",
		swarmServiceId: null,
		...overrides,
	};
	return { state, svc: svc as unknown as Svc };
}

function dockerError(statusCode: number, message: string) {
	return Object.assign(new Error(message), { statusCode });
}

beforeEach(() => {
	removeError = null;
	removed.length = 0;
	webhooksRemoved.length = 0;
});

describe("removalFailure", () => {
	test("a 404 means already gone, not a failure", () => {
		expect(removalFailure(dockerError(404, "no such container"))).toBeNull();
	});

	test("anything else is reported", () => {
		expect(removalFailure(dockerError(500, "daemon exploded"))).toBe(
			"daemon exploded",
		);
		expect(removalFailure("socket closed")).toBe("socket closed");
	});

	test("tryRemoveWorkload returns null on success", async () => {
		expect(await tryRemoveWorkload(async () => {})).toBeNull();
	});
});

describe("ServiceLifecycleService.deleteService", () => {
	test("removes the container, the webhook and the row", async () => {
		const { state, svc } = fakeService();
		await ServiceLifecycleService.deleteService(svc);
		expect(removed).toEqual(["c1"]);
		expect(webhooksRemoved).toEqual(["s1"]);
		expect(state.deleted).toBe(true);
	});

	test("a container that's already gone still deletes the row", async () => {
		removeError = dockerError(404, "no such container");
		const { state, svc } = fakeService();
		await ServiceLifecycleService.deleteService(svc);
		expect(state.deleted).toBe(true);
	});

	test("a failed removal throws and deletes nothing", async () => {
		removeError = dockerError(500, "daemon unreachable");
		const { state, svc } = fakeService({
			containerId: null,
			swarmServiceId: "sw1",
		});
		const attempt = ServiceLifecycleService.deleteService(svc);
		await expect(attempt).rejects.toBeInstanceOf(WorkloadDetachError);
		await expect(attempt).rejects.toThrow(/swarm service.*daemon unreachable/);
		expect(state.deleted).toBe(false);
		expect(webhooksRemoved).toEqual([]);
	});

	test("force deletes the row despite a failed removal", async () => {
		removeError = dockerError(500, "daemon unreachable");
		const { state, svc } = fakeService();
		await ServiceLifecycleService.deleteService(svc, { force: true });
		expect(state.deleted).toBe(true);
	});

	test("a never-deployed service just deletes the row", async () => {
		removeError = dockerError(500, "unused");
		const { state, svc } = fakeService({ containerId: null });
		await ServiceLifecycleService.deleteService(svc);
		expect(state.deleted).toBe(true);
	});
});
