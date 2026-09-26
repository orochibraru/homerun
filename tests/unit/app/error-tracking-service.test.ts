import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { gzipSync } from "node:zlib";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { ErrorTrackingService, MAX_BODY_BYTES } = await import(
	"../../../src/lib/services/error-tracking.service"
);
const { ErrorRetentionScheduler } = await import(
	"../../../src/lib/services/cron/error-retention-scheduler"
);
const { ErrorProjectDTO } = await import(
	"../../../src/lib/dto/error-project-dto"
);
const { ErrorIssueDTO } = await import("../../../src/lib/dto/error-issue-dto");
const { ErrorEventDTO } = await import("../../../src/lib/dto/error-event-dto");
const { ServiceDTO } = await import("../../../src/lib/dto/service-dto");
const { NotificationDTO } = await import(
	"../../../src/lib/dto/notification-dto"
);
const { DeploymentDTO } = await import("../../../src/lib/dto/deployment-dto");
const { InstanceSettingsDTO } = await import(
	"../../../src/lib/dto/instance-settings-dto"
);
const { NotificationChannelService } = await import(
	"../../../src/lib/services/notification-channel.service"
);
const { DockerService } = await import(
	"../../../src/lib/services/docker.service"
);
const { config } = await import("../../../src/lib/config");

const restorers: { mockRestore: () => void }[] = [];
const realOrigin = config.auth.origin;

function track<T extends { mockRestore: () => void }>(spy: T): T {
	restorers.push(spy);
	return spy;
}

afterEach(() => {
	config.auth.origin = realOrigin;
	for (const spy of restorers.splice(0)) {
		spy.mockRestore();
	}
});

const PROJECT = {
	createdAt: new Date(),
	enabled: true,
	id: "p1",
	injectEnv: true,
	internalDsn: true,
	projectId: 7,
	publicKey: "secretkey",
	serviceId: "svc-1",
};

function project(overrides: Partial<typeof PROJECT> = {}) {
	const row = { ...PROJECT, ...overrides };
	return {
		enabled: row.enabled,
		projectId: row.projectId,
		publicKey: row.publicKey,
		serviceId: row.serviceId,
		toJSON: () => row,
	} as unknown as Awaited<ReturnType<typeof ErrorProjectDTO.create>>;
}

const EVENT = {
	event_id: "11111111111111111111111111111111",
	exception: {
		values: [
			{
				stacktrace: {
					frames: [
						{ filename: "/app/a.js", function: "f", in_app: true, lineno: 3 },
					],
				},
				type: "Error",
				value: "boom",
			},
		],
	},
};

function envelope(events: unknown[], extra = ""): string {
	const lines = ['{"sent_at":"2026-09-26T00:00:00Z"}'];
	for (const event of events) {
		lines.push('{"type":"event"}', JSON.stringify(event));
	}
	return `${lines.join("\n")}\n${extra}`;
}

function post(
	body: BodyInit,
	headers: Record<string, string> = {},
	path = "/api/7/envelope/",
) {
	const url = new URL(`https://homerun.test${path}`);
	return {
		request: new Request(url, { body, headers, method: "POST" }),
		url,
	};
}

const AUTH = {
	"x-sentry-auth": "Sentry sentry_version=7, sentry_key=secretkey",
};

function stubStore(
	options: {
		created?: boolean;
		regressed?: boolean;
		status?: string;
		count?: number;
	} = {},
) {
	const records: string[] = [];
	track(spyOn(ErrorEventDTO, "exists").mockResolvedValue(false));
	track(
		spyOn(ErrorIssueDTO, "record").mockImplementation(
			async (_serviceId, fingerprint) => {
				records.push(fingerprint);
				return {
					created: options.created ?? true,
					issue: {
						count: options.count ?? 1,
						id: "issue-1",
						status: options.status ?? "unresolved",
						title: "Error: boom",
					} as never,
					regressed: options.regressed ?? false,
				};
			},
		),
	);
	const created = track(spyOn(ErrorEventDTO, "create").mockResolvedValue());
	const pruned = track(spyOn(ErrorEventDTO, "pruneIssue").mockResolvedValue());
	const notified = track(
		spyOn(NotificationDTO, "notify").mockImplementation(() => {}),
	);
	const channel = track(
		spyOn(NotificationChannelService, "notify").mockImplementation(() => {}),
	);
	track(
		spyOn(ServiceDTO, "get").mockResolvedValue({
			id: "svc-1",
			name: "api",
		} as never),
	);
	return { channel, created, notified, pruned, records };
}

describe("ingest", () => {
	test("stores an envelope's events and notifies on a new issue", async () => {
		track(
			spyOn(ErrorProjectDTO, "getByProjectId").mockResolvedValue(project()),
		);
		const store = stubStore({ count: 20 });
		const { request, url } = post(
			envelope([EVENT], '{"type":"session"}\n{}\n'),
			AUTH,
		);
		const response = await ErrorTrackingService.ingest(
			request,
			url,
			"7",
			"envelope",
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: EVENT.event_id });
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(store.created).toHaveBeenCalledTimes(1);
		expect(store.pruned).toHaveBeenCalledWith("issue-1", 100);
		await Bun.sleep(5);
		expect(store.notified).toHaveBeenCalledTimes(1);
		expect(store.channel).toHaveBeenCalledTimes(1);
	});

	test("accepts gzip on the store endpoint with the key in the query", async () => {
		track(
			spyOn(ErrorProjectDTO, "getByProjectId").mockResolvedValue(
				project({ projectId: 8, serviceId: "svc-8" }),
			),
		);
		const store = stubStore({ created: false, regressed: false });
		const { request, url } = post(
			gzipSync(
				JSON.stringify({
					...EVENT,
					event_id: "22222222222222222222222222222222",
				}),
			),
			{ "content-encoding": "gzip" },
			"/api/8/store/?sentry_key=secretkey",
		);
		const response = await ErrorTrackingService.ingest(
			request,
			url,
			"8",
			"store",
		);
		expect(response.status).toBe(200);
		expect(store.records).toHaveLength(1);
		expect(store.notified).not.toHaveBeenCalled();
	});

	test("skips a duplicate event and events that aren't objects", async () => {
		track(
			spyOn(ErrorProjectDTO, "getByProjectId").mockResolvedValue(
				project({ projectId: 9 }),
			),
		);
		const store = stubStore();
		const exists = track(
			spyOn(ErrorEventDTO, "exists").mockResolvedValue(true),
		);
		const { request, url } = post(envelope([EVENT, "nope"]), AUTH);
		const response = await ErrorTrackingService.ingest(
			request,
			url,
			"9",
			"envelope",
		);
		expect(response.status).toBe(200);
		expect(exists).toHaveBeenCalledTimes(1);
		expect(store.records).toHaveLength(0);
	});

	test("an ignored issue never notifies, and a regressed one does", async () => {
		track(
			spyOn(ErrorProjectDTO, "getByProjectId").mockResolvedValue(
				project({ projectId: 10, serviceId: "svc-10" }),
			),
		);
		let store = stubStore({
			created: false,
			regressed: true,
			status: "ignored",
		});
		await ErrorTrackingService.ingest(
			post(envelope([EVENT]), AUTH).request,
			new URL("https://h/api/10/envelope/"),
			"10",
			"envelope",
		);
		await Bun.sleep(5);
		expect(store.notified).not.toHaveBeenCalled();
		for (const spy of restorers.splice(1)) {
			spy.mockRestore();
		}
		store = stubStore({ created: false, regressed: true });
		await ErrorTrackingService.ingest(
			post(envelope([EVENT]), AUTH).request,
			new URL("https://h/api/10/envelope/"),
			"10",
			"envelope",
		);
		await Bun.sleep(5);
		expect(store.notified).toHaveBeenCalledTimes(1);
	});

	test("caps notifications per service per hour", async () => {
		track(
			spyOn(ErrorProjectDTO, "getByProjectId").mockResolvedValue(
				project({ projectId: 11, serviceId: "svc-cap" }),
			),
		);
		const store = stubStore();
		for (let index = 0; index < 12; index += 1) {
			const { request, url } = post(
				envelope([EVENT]),
				AUTH,
				"/api/11/envelope/",
			);
			// oxlint-disable-next-line no-await-in-loop -- sequential sends
			await ErrorTrackingService.ingest(request, url, "11", "envelope");
		}
		await Bun.sleep(10);
		expect(store.notified).toHaveBeenCalledTimes(10);

		for (const spy of restorers.splice(1)) {
			spy.mockRestore();
		}
		const regression = stubStore({ created: false, regressed: true });
		const { request, url } = post(envelope([EVENT]), AUTH, "/api/11/envelope/");
		await ErrorTrackingService.ingest(request, url, "11", "envelope");
		await Bun.sleep(10);
		expect(regression.notified).toHaveBeenCalledTimes(1);
	});

	test("refuses bad projects, keys and bodies with Sentry's status codes", async () => {
		const lookup = track(
			spyOn(ErrorProjectDTO, "getByProjectId").mockResolvedValue(null),
		);
		const call = async (
			body: BodyInit,
			headers: Record<string, string>,
			id = "7",
		) => {
			const { request, url } = post(body, headers);
			return (await ErrorTrackingService.ingest(request, url, id, "envelope"))
				.status;
		};
		expect(await call(envelope([EVENT]), AUTH, "x")).toBe(404);
		expect(await call(envelope([EVENT]), AUTH)).toBe(404);
		expect(await call(envelope([EVENT]), {})).toBe(401);
		expect(await call("garbage", AUTH)).toBe(400);
		expect(await call("x", { ...AUTH, "content-encoding": "gzip" })).toBe(400);
		expect(await call(new Uint8Array(MAX_BODY_BYTES + 10), AUTH)).toBe(413);
		lookup.mockResolvedValue(project({ publicKey: "other" }));
		expect(await call(envelope([EVENT]), AUTH)).toBe(403);
		lookup.mockResolvedValue(project({ enabled: false }));
		const { request, url } = post(envelope([EVENT]), AUTH);
		const refused = await ErrorTrackingService.ingest(
			request,
			url,
			"7",
			"envelope",
		);
		expect(refused.status).toBe(403);
		expect(refused.headers.get("x-sentry-error")).toBe("project disabled");
		lookup.mockResolvedValue(project());
		expect(await call(envelope([]), AUTH)).toBe(200);
	});

	test("rate-limits a project with Retry-After and X-Sentry-Rate-Limits", async () => {
		track(
			spyOn(ErrorProjectDTO, "getByProjectId").mockResolvedValue(
				project({ projectId: 12 }),
			),
		);
		stubStore({ created: false });
		let last: Response | null = null;
		for (let index = 0; index < 121; index += 1) {
			const { request, url } = post(
				envelope([EVENT]),
				AUTH,
				"/api/12/envelope/",
			);
			// oxlint-disable-next-line no-await-in-loop -- sequential sends
			last = await ErrorTrackingService.ingest(request, url, "12", "envelope");
		}
		expect(last?.status).toBe(429);
		expect(last?.headers.get("retry-after")).toMatch(/^\d+$/);
		expect(last?.headers.get("x-sentry-rate-limits")).toMatch(/^\d+::key$/);
	});

	test("preflight allows browser SDKs", () => {
		const response = ErrorTrackingService.preflight();
		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-headers")).toContain(
			"x-sentry-auth",
		);
	});
});

describe("deploy env and DSNs", () => {
	const service = {
		buildSource: "git",
		channelCanary: false,
		envVars: {},
		environmentName: null,
		gitBuildContext: null,
		gitUrl: "https://github.com/me/app.git",
		id: "svc-1",
		previewParentId: null,
	} as never;

	test("injects the internal DSN when the dashboard runs on the network", async () => {
		config.auth.origin = "https://dash.test";
		track(spyOn(ErrorProjectDTO, "getForService").mockResolvedValue(project()));
		track(
			spyOn(DockerService, "selfContainer").mockResolvedValue({
				aliases: ["homerun-auth"],
				labels: {},
				name: "homerun",
				networkAddress: null,
			}),
		);
		const env = await ErrorTrackingService.deployEnv(service, null);
		expect(env?.releaseFromBuild).toBe(true);
		expect(env?.env[0][1]).toMatch(/^http:\/\/secretkey@homerun-auth:\d+\/7$/);
		const dsns = await ErrorTrackingService.dsns({
			projectId: 7,
			publicKey: "k",
		});
		expect(dsns.public).toBe("https://k@dash.test/7");
	});

	test("injects nothing when tracking or injection is off", async () => {
		const lookup = track(
			spyOn(ErrorProjectDTO, "getForService").mockResolvedValue(null),
		);
		expect(await ErrorTrackingService.deployEnv(service, null)).toBeNull();
		lookup.mockResolvedValue(project({ injectEnv: false }));
		expect(await ErrorTrackingService.deployEnv(service, null)).toBeNull();
	});

	test("links sources at the release commit or the deployment at event time", async () => {
		track(
			spyOn(InstanceSettingsDTO, "get").mockResolvedValue({
				gitProviders: [],
			} as never),
		);
		const commitAt = track(
			spyOn(DeploymentDTO, "commitAt").mockResolvedValue("def5678"),
		);
		expect(
			await ErrorTrackingService.sourceRepo(service, {
				release: "abc1234",
				timestamp: "2026-09-26T00:00:00Z",
			}),
		).toEqual({
			buildContext: null,
			commit: "abc1234",
			provider: "github",
			repoUrl: "https://github.com/me/app",
		});
		expect(
			(
				await ErrorTrackingService.sourceRepo(service, {
					release: "v1",
					timestamp: "2026-09-26T00:00:00Z",
				})
			)?.commit,
		).toBe("def5678");
		commitAt.mockResolvedValue(null);
		expect(
			await ErrorTrackingService.sourceRepo(service, {
				release: null,
				timestamp: "2026-09-26T00:00:00Z",
			}),
		).toBeNull();
		expect(
			await ErrorTrackingService.sourceRepo({ buildSource: "image" } as never, {
				release: null,
				timestamp: "",
			}),
		).toBeNull();
		expect(
			await ErrorTrackingService.sourceRepo(
				{ buildSource: "git", gitUrl: "nope" } as never,
				{ release: null, timestamp: "" },
			),
		).toBeNull();
	});
});

describe("retention", () => {
	test("prunes events and closed issues past the window, hourly", async () => {
		const events = track(
			spyOn(ErrorEventDTO, "pruneOlderThan").mockResolvedValue(),
		);
		const issues = track(
			spyOn(ErrorIssueDTO, "pruneClosed").mockResolvedValue(),
		);
		const scheduler = new ErrorRetentionScheduler() as unknown as {
			tick(): Promise<void>;
		};
		await scheduler.tick();
		const cutoff = events.mock.calls[0][0] as Date;
		expect(Date.now() - cutoff.getTime()).toBeGreaterThan(
			29 * 24 * 60 * 60 * 1000,
		);
		expect(issues).toHaveBeenCalledWith(cutoff);
	});
});
