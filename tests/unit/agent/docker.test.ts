import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * `dockerode` is mocked wholesale : agent/docker.ts is a thin wrapper around
 * its API (pull/createContainer/getContainer/listContainers/listNetworks),
 * so exercising the wrapper's own logic (label building, previous-container
 * removal, host-vs-bridge networking, progress-log lines) doesn't need a
 * real Docker daemon, just a fake that mirrors dockerode's callback/promise
 * shapes closely enough for docker.ts to drive it.
 */
interface FakeContainer {
	id: string;
	Id: string;
	start: ReturnType<typeof mock>;
	stop: ReturnType<typeof mock>;
	restart: ReturnType<typeof mock>;
	remove: ReturnType<typeof mock>;
	inspect: ReturnType<typeof mock>;
	logs: ReturnType<typeof mock>;
}

function makeFakeContainer(id: string): FakeContainer {
	return {
		Id: id,
		id,
		inspect: mock(async () => ({
			Id: id,
			State: { Running: true, Status: "running" },
		})),
		logs: mock(async () => Buffer.from("")),
		remove: mock(async () => undefined),
		restart: mock(async () => undefined),
		start: mock(async () => undefined),
		stop: mock(async () => undefined),
	};
}

class FakeDocker {
	static instances: FakeDocker[] = [];

	socketPath: string;
	containers = new Map<string, FakeContainer>();
	nextCreatedContainer: FakeContainer | null = null;
	pullError: Error | null = null;
	progressEvents: { status?: string; id?: string }[] = [];

	listNetworks = mock(async (_opts?: unknown) => [] as { Name: string }[]);
	createNetwork = mock(async (_opts?: unknown) => undefined);
	listContainers = mock(async (_opts?: unknown) => [] as { Id: string }[]);
	getContainer = mock((id: string) => {
		let c = this.containers.get(id);
		if (!c) {
			c = makeFakeContainer(id);
			this.containers.set(id, c);
		}
		return c;
	});
	createContainer = mock(async (_opts?: unknown) => {
		const c = this.nextCreatedContainer ?? makeFakeContainer("created-id");
		this.containers.set(c.id, c);
		return c;
	});
	modem = {
		followProgress: mock(
			(
				_stream: unknown,
				done: (err: Error | null) => void,
				onProgress: (event: { status?: string; id?: string }) => void,
			) => {
				for (const event of this.progressEvents) {
					onProgress(event);
				}
				done(this.pullError);
			},
		),
	};
	pull = mock(
		(
			_ref: string,
			_opts: unknown,
			cb: (err: Error | null, stream: unknown) => void,
		) => {
			cb(null, { fakeStream: true });
		},
	);

	constructor(opts: { socketPath: string }) {
		this.socketPath = opts.socketPath;
		FakeDocker.instances.push(this);
	}
}

// "dockerode" is only ever imported (in this whole repo) by agent/docker.ts,
// so mocking it wholesale here doesn't risk the same cross-file collision
// mocking "../../packages/agent/config" or "../../packages/agent/docker" itself would (see
// tests/README.md) : nothing else in the test suite touches this specifier.
mock.module("dockerode", () => ({ default: FakeDocker }));

const { DockerService } = await import("../../../packages/agent/docker");
afterAll(() => {
	mock.module("dockerode", () => ({ default: FakeDocker }));
});

function fakeDocker(): FakeDocker {
	// `getDocker()` lazily creates exactly one singleton the first time any
	// docker.ts function is called, and every test in this file shares it :
	// reset its mocks between tests instead of expecting a fresh instance.
	if (FakeDocker.instances.length === 0) {
		// Trigger the singleton's creation deterministically.
		DockerService.getDocker();
	}
	return FakeDocker.instances[0];
}

beforeEach(() => {
	const d = fakeDocker();
	d.containers.clear();
	d.nextCreatedContainer = null;
	d.pullError = null;
	d.progressEvents = [];
	d.listNetworks.mockClear();
	d.createNetwork.mockClear();
	d.listContainers.mockClear();
	d.getContainer.mockClear();
	d.createContainer.mockClear();
	d.pull.mockClear();
	d.modem.followProgress.mockClear();
});

describe("getDocker", () => {
	test("returns the same singleton across calls", () => {
		const a = DockerService.getDocker();
		const b = DockerService.getDocker();
		expect(a).toBe(b);
	});
});
