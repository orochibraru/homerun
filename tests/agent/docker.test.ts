import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

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
// mocking "../../agent/config" or "../../agent/docker" itself would (see
// tests/README.md) : nothing else in the test suite touches this specifier.
mock.module("dockerode", () => ({ default: FakeDocker }));

const { DockerService } = await import("../../agent/docker");
// Real config, read (not mocked) : assertions below compare against
// whatever agent/config.ts actually resolves in this environment rather
// than hardcoding "homerun-network", keeping this file config-mock-free.
const { config: realConfig } = await import("../../agent/config");

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

describe("ensureNetwork", () => {
	test("does nothing when the network already exists", async () => {
		const d = fakeDocker();
		d.listNetworks.mockResolvedValueOnce([
			{ Name: realConfig.dockerNetworkName },
		]);

		await DockerService.ensureNetwork();

		expect(d.createNetwork).not.toHaveBeenCalled();
	});

	test("creates the network when it's missing", async () => {
		const d = fakeDocker();
		d.listNetworks.mockResolvedValueOnce([]);

		await DockerService.ensureNetwork();

		expect(d.createNetwork).toHaveBeenCalledWith({
			CheckDuplicate: true,
			Name: realConfig.dockerNetworkName,
		});
	});
});

describe("findServiceContainer / listManagedContainers", () => {
	test("findServiceContainer returns the first match, or null", async () => {
		const d = fakeDocker();
		d.listContainers.mockResolvedValueOnce([{ Id: "abc" }]);
		expect(await DockerService.findServiceContainer("svc-1")).toEqual({
			Id: "abc",
		});

		d.listContainers.mockResolvedValueOnce([]);
		expect(await DockerService.findServiceContainer("svc-2")).toBeNull();
	});

	test("listManagedContainers filters on the managed label", async () => {
		const d = fakeDocker();
		d.listContainers.mockResolvedValueOnce([{ Id: "x" }, { Id: "y" }]);

		const result = await DockerService.listManagedContainers();

		expect(result).toEqual([{ Id: "x" }, { Id: "y" }]);
		const [args] = d.listContainers.mock.calls.at(-1) as [{ filters: string }];
		expect(JSON.parse(args.filters)).toEqual({
			label: ["homerun.managed=true"],
		});
	});
});

function baseDeployInput() {
	return {
		containerPort: 8080,
		cpuLimit: null,
		envVars: [{ key: "FOO", value: "bar" }],
		image: "nginx",
		memoryLimitMb: null,
		networkMode: "bridge" as const,
		portProtocol: "tcp" as const,
		registryAuth: null,
		restartPolicy: "always" as const,
		serviceId: "svc-1",
		slug: "my-slug",
		tag: "latest",
	};
}

describe("deploy", () => {
	test("pulls, removes the previous container by label, creates, and starts", async () => {
		const d = fakeDocker();
		d.listContainers.mockResolvedValueOnce([{ Id: "old-container-id" }]);
		d.progressEvents = [{ id: "layer1", status: "Downloading" }];
		const created = makeFakeContainer("new-container-id");
		d.nextCreatedContainer = created;

		const result = await DockerService.deploy(baseDeployInput());

		expect(d.pull.mock.calls[0][0]).toBe("nginx:latest");
		const oldContainer = d.containers.get("old-container-id");
		expect(oldContainer?.stop).toHaveBeenCalledWith({ t: 10 });
		expect(oldContainer?.remove).toHaveBeenCalledWith({ force: true });
		expect(created.start).toHaveBeenCalled();
		expect(result.containerId).toBe("new-container-id");
		expect(result.log.some((l) => l.includes("Pulling nginx:latest"))).toBe(
			true,
		);
		expect(
			result.log.some((l) => l.includes("Removing previous container")),
		).toBe(true);
		expect(result.log.some((l) => l.includes("Downloading layer1"))).toBe(true);
		expect(result.log.some((l) => l.includes("Started"))).toBe(true);
	});

	test("skips removal when there's no previous container", async () => {
		const d = fakeDocker();
		d.listContainers.mockResolvedValueOnce([]);

		const result = await DockerService.deploy(baseDeployInput());

		expect(
			result.log.some((l) => l.includes("Removing previous container")),
		).toBe(false);
	});

	test("builds the container with the right env, port, and labels", async () => {
		const d = fakeDocker();
		d.listContainers.mockResolvedValueOnce([]);

		await DockerService.deploy(baseDeployInput());

		const [opts] = d.createContainer.mock.calls.at(-1) as [
			Record<string, unknown>,
		];
		expect(opts.Env).toEqual(["FOO=bar"]);
		expect(opts.Image).toBe("nginx:latest");
		expect(opts.ExposedPorts).toEqual({ "8080/tcp": {} });
		expect(opts.Labels).toEqual({
			"homerun.agent": "true",
			"homerun.managed": "true",
			"homerun.service.id": "svc-1",
		});
		const hostConfig = opts.HostConfig as Record<string, unknown>;
		expect(hostConfig.NetworkMode).toBe(realConfig.dockerNetworkName);
		expect(hostConfig.RestartPolicy).toEqual({ Name: "always" });
		expect(opts.NetworkingConfig).toEqual({
			EndpointsConfig: {
				[realConfig.dockerNetworkName]: { Aliases: ["my-slug"] },
			},
		});
	});

	test("exposes both tcp and udp when portProtocol is 'both'", async () => {
		const d = fakeDocker();
		d.listContainers.mockResolvedValueOnce([]);

		await DockerService.deploy({ ...baseDeployInput(), portProtocol: "both" });

		const [opts] = d.createContainer.mock.calls.at(-1) as [
			Record<string, unknown>,
		];
		expect(opts.ExposedPorts).toEqual({ "8080/tcp": {}, "8080/udp": {} });
	});

	test("omits ExposedPorts entirely when containerPort is null", async () => {
		const d = fakeDocker();
		d.listContainers.mockResolvedValueOnce([]);

		await DockerService.deploy({ ...baseDeployInput(), containerPort: null });

		const [opts] = d.createContainer.mock.calls.at(-1) as [
			Record<string, unknown>,
		];
		expect(opts.ExposedPorts).toBeUndefined();
	});

	test("converts cpuLimit/memoryLimitMb into NanoCpus/Memory", async () => {
		const d = fakeDocker();
		d.listContainers.mockResolvedValueOnce([]);

		await DockerService.deploy({
			...baseDeployInput(),
			cpuLimit: 1.5,
			memoryLimitMb: 512,
		});

		const [opts] = d.createContainer.mock.calls.at(-1) as [
			Record<string, unknown>,
		];
		const hostConfig = opts.HostConfig as Record<string, unknown>;
		expect(hostConfig.NanoCpus).toBe(1_500_000_000);
		expect(hostConfig.Memory).toBe(512 * 1024 * 1024);
	});

	test("host network mode omits NetworkingConfig and sets HostConfig.NetworkMode to 'host'", async () => {
		const d = fakeDocker();
		d.listContainers.mockResolvedValueOnce([]);

		await DockerService.deploy({ ...baseDeployInput(), networkMode: "host" });

		const [opts] = d.createContainer.mock.calls.at(-1) as [
			Record<string, unknown>,
		];
		expect(opts.NetworkingConfig).toBeUndefined();
		const hostConfig = opts.HostConfig as Record<string, unknown>;
		expect(hostConfig.NetworkMode).toBe("host");
	});

	test("rejects when the pull itself fails", async () => {
		const d = fakeDocker();
		d.listContainers.mockResolvedValueOnce([]);
		d.pullError = new Error("pull boom");

		await expect(DockerService.deploy(baseDeployInput())).rejects.toThrow(
			"pull boom",
		);
	});
});

describe("container lifecycle helpers", () => {
	test("startContainer starts the right container", async () => {
		const d = fakeDocker();
		await DockerService.startContainer("abc");
		expect(d.containers.get("abc")?.start).toHaveBeenCalled();
	});

	test("stopContainer stops with a 10s grace period", async () => {
		const d = fakeDocker();
		await DockerService.stopContainer("abc");
		expect(d.containers.get("abc")?.stop).toHaveBeenCalledWith({ t: 10 });
	});

	test("restartContainer restarts with a 10s grace period", async () => {
		const d = fakeDocker();
		await DockerService.restartContainer("abc");
		expect(d.containers.get("abc")?.restart).toHaveBeenCalledWith({ t: 10 });
	});

	test("removeContainer stops (tolerating failure) then force-removes", async () => {
		const d = fakeDocker();
		const c = makeFakeContainer("abc");
		c.stop.mockRejectedValueOnce(new Error("already stopped"));
		d.containers.set("abc", c);

		await DockerService.removeContainer("abc");

		expect(c.stop).toHaveBeenCalledWith({ t: 10 });
		expect(c.remove).toHaveBeenCalledWith({ force: true });
	});

	test("inspectStatus reports 'running' when the container is running", async () => {
		const d = fakeDocker();
		const c = makeFakeContainer("abc");
		c.inspect.mockResolvedValueOnce({
			Id: "abc",
			State: { Running: true, Status: "running" },
		});
		d.containers.set("abc", c);

		expect(await DockerService.inspectStatus("abc")).toEqual({
			id: "abc",
			state: "running",
			status: "running",
		});
	});

	test("inspectStatus falls back to the raw Status when not running", async () => {
		const d = fakeDocker();
		const c = makeFakeContainer("abc");
		c.inspect.mockResolvedValueOnce({
			Id: "abc",
			State: { Running: false, Status: "exited" },
		});
		d.containers.set("abc", c);

		expect(await DockerService.inspectStatus("abc")).toEqual({
			id: "abc",
			state: "exited",
			status: "exited",
		});
	});
});

describe("streamLogs", () => {
	test("follow=false wraps the resolved buffer in a single-chunk stream", async () => {
		const d = fakeDocker();
		const c = makeFakeContainer("abc");
		c.logs.mockResolvedValueOnce(Buffer.from("hello logs"));
		d.containers.set("abc", c);

		const stream = await DockerService.streamLogs("abc", false);
		const text = await new Response(stream).text();

		expect(text).toBe("hello logs");
		expect(c.logs).toHaveBeenCalledWith({
			follow: false,
			stderr: true,
			stdout: true,
			tail: 200,
		});
	});

	test("follow=true pipes a live duplex stream's data/end events through", async () => {
		const d = fakeDocker();
		const c = makeFakeContainer("abc");
		const fakeDuplex = new EventEmitter() as EventEmitter & {
			destroy?: () => void;
		};
		fakeDuplex.destroy = mock(() => undefined);
		c.logs.mockResolvedValueOnce(fakeDuplex);
		d.containers.set("abc", c);

		const stream = await DockerService.streamLogs("abc", true);
		const reader = stream.getReader();

		fakeDuplex.emit("data", Buffer.from("chunk-1"));
		const first = await reader.read();
		expect(Buffer.from(first.value ?? []).toString()).toBe("chunk-1");

		fakeDuplex.emit("end");
		const done = await reader.read();
		expect(done.done).toBe(true);
		expect(c.logs).toHaveBeenCalledWith({
			follow: true,
			stderr: true,
			stdout: true,
			tail: 200,
		});
	});

	test("follow=true surfaces a stream error", async () => {
		const d = fakeDocker();
		const c = makeFakeContainer("abc");
		const fakeDuplex = new EventEmitter();
		c.logs.mockResolvedValueOnce(fakeDuplex);
		d.containers.set("abc", c);

		const stream = await DockerService.streamLogs("abc", true);
		const reader = stream.getReader();

		fakeDuplex.emit("error", new Error("stream boom"));

		await expect(reader.read()).rejects.toThrow("stream boom");
	});
});
