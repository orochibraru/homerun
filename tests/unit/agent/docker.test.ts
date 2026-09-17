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

const {
	authenticatedCloneUrl,
	DockerService,
	extractCommitSha,
	gitCheckoutSteps,
	redactCloneUrl,
} = await import("../../../packages/agent/docker");
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

describe("authenticatedCloneUrl", () => {
	test("injects a provider token into an https clone URL", () => {
		expect(
			authenticatedCloneUrl("https://github.com/me/private.git", {
				token: "ghp_secret",
				username: "me",
			}),
		).toBe("https://me:ghp_secret@github.com/me/private.git");
	});

	test("leaves a URL alone when there's no credential, or it already carries one, or it isn't http(s)", () => {
		expect(authenticatedCloneUrl("https://github.com/me/pub.git", null)).toBe(
			"https://github.com/me/pub.git",
		);
		expect(
			authenticatedCloneUrl("https://u:p@github.com/me/pub.git", {
				token: "t",
				username: "me",
			}),
		).toBe("https://u:p@github.com/me/pub.git");
		expect(
			authenticatedCloneUrl("git@github.com:me/pub.git", {
				token: "t",
				username: "me",
			}),
		).toBe("git@github.com:me/pub.git");
	});
});

describe("redactCloneUrl", () => {
	test("keeps a token out of a log line or an error message", () => {
		expect(
			redactCloneUrl("https://me:ghp_secret@github.com/me/private.git"),
		).not.toContain("ghp_secret");
		expect(redactCloneUrl("https://github.com/me/pub.git")).toBe(
			"https://github.com/me/pub.git",
		);
		expect(redactCloneUrl("not a url")).toBe("not a url");
	});
});

describe("gitCheckoutSteps", () => {
	const sha = "68c1b9e0f1a2b3c4d5e6f708192a3b4c5d6e7f80";

	test("a branch is one shallow clone", () => {
		expect(gitCheckoutSteps("https://x/r.git", "main", "/w/repo")).toEqual([
			[
				"clone",
				"--depth",
				"1",
				"--branch",
				"main",
				"--single-branch",
				"https://x/r.git",
				"/w/repo",
			],
		]);
	});

	test("a commit SHA is fetched by SHA and checked out detached", () => {
		const steps = gitCheckoutSteps("https://x/r.git", sha, "/w/repo");
		expect(steps[0]).toEqual(["init", "--quiet", "/w/repo"]);
		expect(steps[2]).toEqual([
			"-C",
			"/w/repo",
			"fetch",
			"--depth",
			"1",
			"origin",
			sha,
		]);
		expect(steps[3]).toEqual([
			"-C",
			"/w/repo",
			"checkout",
			"--detach",
			"FETCH_HEAD",
		]);
	});

	test("extractCommitSha reads through a Docker frame header", () => {
		expect(
			extractCommitSha(`\u0001\u0000\u0000\u0000\u0000\u0000\u0000)${sha}\n`),
		).toBe(sha);
	});
});
