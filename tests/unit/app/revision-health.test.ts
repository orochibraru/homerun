import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { RevisionHealthService } = await import(
	"../../../src/lib/services/revision-health.service"
);
const { DeploymentDTO } = await import("../../../src/lib/dto/deployment-dto");
const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
const { NotificationDTO } = await import(
	"../../../src/lib/dto/notification-dto"
);
const { DockerService } = await import(
	"../../../src/lib/services/docker.service"
);
const { NotificationChannelService } = await import(
	"../../../src/lib/services/notification-channel.service"
);

type Deployment = NonNullable<Awaited<ReturnType<typeof DeploymentDTO.get>>>;
type Service = NonNullable<Awaited<ReturnType<typeof ServiceDTO.get>>>;
type Sample = Awaited<ReturnType<typeof DockerService.containerHealthSample>>;
type Enqueue = Parameters<
	typeof RevisionHealthService.watch
>[0]["enqueueRollback"];

const registry = globalThis as unknown as {
	__homerun_revision_watches?: Set<string>;
};

let realSetTimeout = globalThis.setTimeout;
const spies: { mockRestore: () => void }[] = [];

function track<T extends { mockRestore: () => void }>(spy: T): T {
	spies.push(spy);
	return spy;
}

beforeEach(() => {
	realSetTimeout = globalThis.setTimeout;
	const original = realSetTimeout;
	globalThis.setTimeout = ((fn: () => void, ms?: number) =>
		ms === 5000
			? original(fn, 0)
			: original(fn, ms)) as unknown as typeof setTimeout;
});

afterEach(() => {
	globalThis.setTimeout = realSetTimeout;
	for (const spy of spies.splice(0)) {
		spy.mockRestore();
	}
});

async function settled(deploymentId: string): Promise<void> {
	for (let i = 0; i < 500; i++) {
		if (!registry.__homerun_revision_watches?.has(deploymentId)) {
			return;
		}
		await Bun.sleep(1);
	}
	throw new Error(`watch ${deploymentId} never finished`);
}

function running(restartCount = 0): Sample {
	return {
		exitCode: null,
		health: "none",
		healthOutput: null,
		kind: "container",
		restartCount,
		state: "running",
	};
}

function exited(code: number): Sample {
	return { ...running(), exitCode: code, state: "exited" };
}

interface FakeDep {
	appendLog: ReturnType<typeof mock>;
	settleHealth: ReturnType<typeof mock>;
}

function fakeDep(
	id: string,
	options: { rollbackOf?: string | null; settles?: boolean } = {},
): FakeDep & Deployment {
	return {
		appendLog: mock(async () => undefined),
		id,
		rollbackOfDeploymentId: options.rollbackOf ?? null,
		settleHealth: mock(async () => options.settles ?? true),
		toJSON: () => ({
			createdAt: new Date(Date.now() - 2 * 60 * 1000),
			finishedAt: null,
			id,
			imageRef: "app:2",
			serviceId: "svc",
			userId: "user-1",
		}),
	} as unknown as FakeDep & Deployment;
}

function fakeService(
	options: {
		autoRollback?: boolean;
		containerId?: string | null;
		desiredState?: string;
		swarmServiceId?: string | null;
	} = {},
): Service {
	return {
		containerId:
			options.containerId === undefined ? "ctr" : options.containerId,
		id: "svc",
		name: "api",
		swarmServiceId: options.swarmServiceId ?? null,
		toJSON: () => ({
			autoRollback: options.autoRollback ?? true,
			desiredState: options.desiredState ?? "running",
		}),
	} as unknown as Service;
}

function revisionRow(
	id: string,
	imageRef: string,
	ageMs: number,
	rollbackOf: string | null = null,
) {
	return {
		toJSON: () => ({
			buildSource: "image",
			createdAt: new Date(Date.now() - ageMs),
			health: null,
			id,
			imageDigest: null,
			imageId: null,
			imageRef,
			rollbackOfDeploymentId: rollbackOf,
			serviceId: "svc",
			status: "running",
		}),
	};
}

interface Setup {
	dep: FakeDep & Deployment;
	latestId?: string;
	revisions?: ReturnType<typeof revisionRow>[];
	samples: Sample[];
	svc: Service | null;
	svcLater?: Service;
}

function setup(options: Setup) {
	track(spyOn(DeploymentDTO, "get").mockResolvedValue(options.dep));
	const serviceGet = track(spyOn(ServiceDTO, "get"));
	serviceGet.mockResolvedValueOnce(options.svc);
	serviceGet.mockResolvedValue(options.svcLater ?? options.svc);
	track(
		spyOn(DeploymentDTO, "listForService").mockResolvedValue([
			{ id: options.latestId ?? options.dep.id },
		] as unknown as Deployment[]),
	);
	track(
		spyOn(DeploymentDTO, "listRevisions").mockResolvedValue(
			(options.revisions ?? []) as unknown as Deployment[],
		),
	);
	const queue = [...options.samples];
	const containerSample = track(
		spyOn(DockerService, "containerHealthSample").mockImplementation(
			async () => (queue.length > 1 ? queue.shift() : queue[0]) as Sample,
		),
	);
	const swarmSample = track(
		spyOn(DockerService, "swarmHealthSample").mockImplementation(
			async () =>
				(queue.length > 1 ? queue.shift() : queue[0]) as Awaited<
					ReturnType<typeof DockerService.swarmHealthSample>
				>,
		),
	);
	const notify = track(
		spyOn(NotificationDTO, "notify").mockImplementation(() => undefined),
	);
	const channelNotify = track(
		spyOn(NotificationChannelService, "notify").mockImplementation(
			() => undefined,
		),
	);
	const enqueueRollback = mock(async () => undefined);
	return {
		channelNotify,
		containerSample,
		enqueueRollback,
		notify,
		swarmSample,
	};
}

async function watch(
	dep: Deployment,
	enqueueRollback: Enqueue,
	startedAt = new Date(),
): Promise<void> {
	RevisionHealthService.watch({
		deploymentId: dep.id,
		enqueueRollback,
		serviceId: "svc",
		startedAt,
		userId: "user-1",
	});
	await settled(dep.id);
}

const longAgo = () => new Date(Date.now() - 2 * 60 * 1000);

describe("RevisionHealthService.watch", () => {
	test("a container that stays up through the window is recorded healthy", async () => {
		const dep = fakeDep("d-healthy");
		const s = setup({ dep, samples: [running()], svc: fakeService() });

		await watch(dep, s.enqueueRollback, longAgo());

		expect(dep.settleHealth).toHaveBeenCalledWith("healthy");
		expect(String(dep.appendLog.mock.calls[0][0])).toMatch(
			/^Revision healthy after \d+s\.$/,
		);
		expect(s.notify).not.toHaveBeenCalled();
	});

	test("a healthy verdict a newer deploy already cleared logs nothing", async () => {
		const dep = fakeDep("d-superseded", { settles: false });
		const s = setup({ dep, samples: [running()], svc: fakeService() });

		await watch(dep, s.enqueueRollback, longAgo());

		expect(dep.settleHealth).toHaveBeenCalledWith("healthy");
		expect(dep.appendLog).not.toHaveBeenCalled();
	});

	test("nothing is watched when the deployment or service is gone", async () => {
		const dep = fakeDep("d-gone");
		const s = setup({ dep, samples: [running()], svc: null });

		await watch(dep, s.enqueueRollback);

		expect(s.containerSample).not.toHaveBeenCalled();
		expect(dep.settleHealth).not.toHaveBeenCalled();
	});

	test("the watch stops and clears health once the deployment isn't current", async () => {
		const cases: Partial<Setup>[] = [
			{ latestId: "someone-else" },
			{ svcLater: fakeService({ desiredState: "stopped" }) },
			{ svcLater: fakeService({ containerId: "replaced" }) },
		];
		for (const [index, overrides] of cases.entries()) {
			const dep = fakeDep(`d-stale-${index}`);
			const s = setup({
				dep,
				samples: [running()],
				svc: fakeService(),
				...overrides,
			});
			await watch(dep, s.enqueueRollback);
			expect(dep.settleHealth).toHaveBeenCalledWith(null);
			expect(dep.settleHealth).toHaveBeenCalledTimes(1);
		}
	});

	test("an unhealthy revision rolls back to the previous one's original deploy", async () => {
		const dep = fakeDep("d-new");
		const s = setup({
			dep,
			revisions: [
				revisionRow("d-new", "app:2", 0),
				revisionRow("d-redeploy", "app:1", 1000, "d-orig"),
				revisionRow("d-orig", "app:1", 5000),
			],
			samples: [running(), running(), exited(137)],
			svc: fakeService(),
		});

		await watch(dep, s.enqueueRollback);

		const reason = "The container exited with code 137.";
		expect(dep.settleHealth).toHaveBeenCalledWith("rolled_back", reason);
		expect(s.enqueueRollback).toHaveBeenCalledWith({
			rollbackOfDeploymentId: "d-orig",
			svc: expect.anything(),
			userId: "user-1",
		});
		const logs = dep.appendLog.mock.calls.map((call) => String(call[0]));
		expect(logs).toEqual([
			`Revision unhealthy: ${reason}`,
			"Auto-rollback: redeploying revision d-orig (app:1).",
		]);
		expect(s.notify).toHaveBeenCalledWith({
			message: `"api" was rolled back to app:1: ${reason}`,
			serviceId: "svc",
			type: "deploy_rolled_back",
		});
		expect(s.channelNotify).toHaveBeenCalledTimes(1);
	});

	test("an unhealthy revision with no rollback target says why", async () => {
		const cases: [string, Partial<Setup> & { rollbackOf?: string }, string][] =
			[
				[
					"off",
					{ svc: fakeService({ autoRollback: false }) },
					"Auto-rollback is off for this service, so it was left running.",
				],
				[
					"itself",
					{ rollbackOf: "d-older" },
					"This revision was itself a rollback, so it isn't rolled back again.",
				],
				[
					"nothing",
					{ revisions: [revisionRow("d-nothing", "app:2", 0)] },
					"Auto-rollback is on, but there's no previous healthy revision to roll back to.",
				],
			];
		for (const [name, overrides, skipReason] of cases) {
			const dep = fakeDep(`d-${name}`, { rollbackOf: overrides.rollbackOf });
			const s = setup({
				dep,
				samples: [exited(1)],
				svc: fakeService(),
				...overrides,
			});
			await watch(dep, s.enqueueRollback);
			expect(dep.settleHealth).toHaveBeenCalledWith(
				"unhealthy",
				"The container exited with code 1.",
			);
			expect(s.enqueueRollback).not.toHaveBeenCalled();
			expect(dep.appendLog.mock.calls.at(-1)?.[0]).toBe(skipReason);
			expect(s.notify.mock.calls[0][0]).toMatchObject({
				type: "deploy_unhealthy",
			});
			for (const spy of spies.splice(0)) {
				spy.mockRestore();
			}
		}
	});

	test("an unhealthy verdict a newer deploy already cleared does nothing else", async () => {
		const dep = fakeDep("d-cleared", { settles: false });
		const s = setup({ dep, samples: [exited(1)], svc: fakeService() });

		await watch(dep, s.enqueueRollback);

		expect(dep.appendLog).not.toHaveBeenCalled();
		expect(s.notify).not.toHaveBeenCalled();
		expect(s.channelNotify).not.toHaveBeenCalled();
	});

	test("a swarm service is judged by its task counts", async () => {
		const dep = fakeDep("d-swarm");
		const s = setup({
			dep,
			samples: [
				{
					desired: 2,
					failed: 2,
					kind: "swarm",
					lastError: "no such image",
					running: 0,
				} as unknown as Sample,
			],
			svc: fakeService({
				autoRollback: false,
				containerId: null,
				swarmServiceId: "sw-1",
			}),
		});

		await watch(dep, s.enqueueRollback);

		expect(s.swarmSample).toHaveBeenCalled();
		expect(s.containerSample).not.toHaveBeenCalled();
		expect(dep.settleHealth).toHaveBeenCalledWith(
			"unhealthy",
			"2 swarm tasks failed: no such image",
		);
	});

	test("a deployment already being watched isn't watched twice", async () => {
		const dep = fakeDep("d-dupe");
		const s = setup({ dep, samples: [running()], svc: fakeService() });
		const input = {
			deploymentId: dep.id,
			enqueueRollback: s.enqueueRollback,
			serviceId: "svc",
			startedAt: longAgo(),
			userId: "user-1",
		};

		RevisionHealthService.watch(input);
		RevisionHealthService.watch(input);
		await settled(dep.id);

		expect(dep.settleHealth).toHaveBeenCalledTimes(1);
	});

	test("a watch that throws is logged and released", async () => {
		track(spyOn(DeploymentDTO, "get").mockRejectedValue(new Error("db down")));
		const dep = fakeDep("d-throws");
		await watch(
			dep,
			mock(async () => undefined),
		);
		expect(registry.__homerun_revision_watches?.has("d-throws")).toBe(false);
	});
});

describe("RevisionHealthService.resume", () => {
	test("restarts a watch for every deployment still marked watching", async () => {
		const dep = fakeDep("d-resumed");
		const s = setup({ dep, samples: [running()], svc: fakeService() });
		const started = spyOn(RevisionHealthService, "watch");
		track(started);
		track(spyOn(DeploymentDTO, "listWatching").mockResolvedValue([dep]));

		await RevisionHealthService.resume(s.enqueueRollback);
		await settled(dep.id);

		expect(started).toHaveBeenCalledWith(
			expect.objectContaining({
				deploymentId: "d-resumed",
				serviceId: "svc",
				userId: "user-1",
			}),
		);
		expect(dep.settleHealth).toHaveBeenCalledTimes(1);
	});

	test("a failure listing them resumes nothing", async () => {
		track(spyOn(DeploymentDTO, "listWatching").mockRejectedValue("db down"));
		const started = track(spyOn(RevisionHealthService, "watch"));

		await RevisionHealthService.resume(mock(async () => undefined));

		expect(started).not.toHaveBeenCalled();
	});
});
