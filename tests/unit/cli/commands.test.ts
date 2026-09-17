import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import process from "node:process";
import type { ClientFactory } from "../../../packages/cli/client";
import {
	Commands,
	findingsAtOrAbove,
	instanceStatusText,
	revisionRow,
} from "../../../packages/cli/commands";
import { Output } from "../../../packages/cli/output";

type Client = ReturnType<typeof ClientFactory.makeClient>;

class FailCalled extends Error {}

function fakeClient(overrides: {
	DELETE?: ReturnType<typeof mock>;
	GET?: ReturnType<typeof mock>;
	POST?: ReturnType<typeof mock>;
}): Client {
	return {
		DELETE: overrides.DELETE ?? mock(),
		GET: overrides.GET ?? mock(),
		POST: overrides.POST ?? mock(),
	} as unknown as Client;
}

function okResponse<T>(data: T, headers: Record<string, string> = {}) {
	return {
		data,
		error: undefined,
		response: { headers: new Headers(headers), ok: true, status: 200 },
	};
}

function errResponse(status: number, statusText: string, error: unknown) {
	return {
		data: undefined,
		error,
		response: { ok: false, status, statusText },
	};
}

let printJsonSpy: ReturnType<typeof spyOn>;
let printTableSpy: ReturnType<typeof spyOn>;

afterEach(() => {
	mock.restore();
});

function spyOnOutput() {
	printJsonSpy = spyOn(Output, "printJson").mockImplementation(() => undefined);
	printTableSpy = spyOn(Output, "printTable").mockImplementation(
		() => undefined,
	);
}

describe("Commands.servicesList", () => {
	test("prints JSON when json=true", async () => {
		spyOnOutput();
		const GET = mock(async () =>
			okResponse([
				{
					currentStatus: "running",
					id: "1",
					image: "nginx",
					name: "svc",
					slug: "svc",
					tag: "latest",
				},
			]),
		);
		const client = fakeClient({ GET });

		await Commands.servicesList(client, { json: true });

		expect(GET).toHaveBeenCalledWith("/services", {
			params: { query: {} },
		});
		expect(printJsonSpy).toHaveBeenCalled();
		expect(printTableSpy).not.toHaveBeenCalled();
	});

	test("prints a mapped table when json=false", async () => {
		spyOnOutput();
		const GET = mock(async () =>
			okResponse([
				{
					currentStatus: "running",
					id: "1",
					image: "nginx",
					name: "svc",
					slug: "svc",
					tag: "latest",
				},
			]),
		);
		const client = fakeClient({ GET });

		await Commands.servicesList(client, { json: false });

		expect(printTableSpy).toHaveBeenCalledWith(
			[
				{
					id: "1",
					image: "nginx:latest",
					name: "svc",
					slug: "svc",
					status: "running",
				},
			],
			["id", "name", "slug", "status", "image"],
		);
	});

	test("calls Output.fail() with the status and body on an error response", async () => {
		const failSpy = spyOn(Output, "fail").mockImplementation(() => {
			throw new FailCalled();
		});
		const GET = mock(async () =>
			errResponse(404, "Not Found", { error: "nope" }),
		);
		const client = fakeClient({ GET });

		await expect(Commands.servicesList(client, { json: true })).rejects.toThrow(
			FailCalled,
		);
		expect(failSpy).toHaveBeenCalledWith('404 Not Found: {"error":"nope"}');
	});
});

describe("Commands.serviceGet", () => {
	test("fetches by id and prints JSON", async () => {
		spyOnOutput();
		const GET = mock(async () => okResponse({ id: "svc-1" }));
		const client = fakeClient({ GET });

		await Commands.serviceGet(client, "svc-1");

		expect(GET).toHaveBeenCalledWith("/services/{serviceId}", {
			params: { path: { serviceId: "svc-1" } },
		});
		expect(printJsonSpy).toHaveBeenCalledWith({ id: "svc-1" });
	});
});

describe("Commands.serviceAction", () => {
	test.each(["deploy", "start", "stop", "restart"] as const)(
		"POSTs to /services/{serviceId}/%s",
		async (action) => {
			spyOnOutput();
			const POST = mock(async () => okResponse({ ok: true }));
			const client = fakeClient({ POST });

			await Commands.serviceAction(client, action, "svc-1");

			expect(POST).toHaveBeenCalledWith(`/services/{serviceId}/${action}`, {
				params: { path: { serviceId: "svc-1" } },
			});
			expect(printJsonSpy).toHaveBeenCalledWith({ ok: true });
		},
	);
});

describe("Commands.serviceDelete", () => {
	test("DELETE with no force query by default and prints a confirmation", async () => {
		spyOnOutput();
		const DELETE = mock(async () => okResponse(undefined));
		const client = fakeClient({ DELETE });

		await Commands.serviceDelete(client, "svc-1", false);

		expect(DELETE).toHaveBeenCalledWith("/services/{serviceId}", {
			params: { path: { serviceId: "svc-1" }, query: {} },
		});
		expect(printJsonSpy).toHaveBeenCalledWith({ deleted: true, id: "svc-1" });
	});

	test("passes force=true when requested", async () => {
		spyOnOutput();
		const DELETE = mock(async () => okResponse(undefined));
		const client = fakeClient({ DELETE });

		await Commands.serviceDelete(client, "svc-1", true);

		expect(DELETE).toHaveBeenCalledWith("/services/{serviceId}", {
			params: { path: { serviceId: "svc-1" }, query: { force: "true" } },
		});
	});

	test("calls Output.fail() on the 409 the API answers when the workload is still attached", async () => {
		const failSpy = spyOn(Output, "fail").mockImplementation(() => {
			throw new FailCalled();
		});
		const DELETE = mock(async () =>
			errResponse(409, "Conflict", { error: "still attached" }),
		);

		await expect(
			Commands.serviceDelete(fakeClient({ DELETE }), "svc-1", false),
		).rejects.toThrow(FailCalled);
		expect(failSpy).toHaveBeenCalledWith(
			'409 Conflict: {"error":"still attached"}',
		);
	});
});

describe("Commands.serviceWebhook", () => {
	test("fetches by id and prints JSON", async () => {
		spyOnOutput();
		const GET = mock(async () =>
			okResponse({
				error: null,
				providerName: "GitHub",
				registered: true,
				secret: "shh",
				url: "https://homerun.example.com/api/v1/webhooks/git/svc-1",
			}),
		);
		const client = fakeClient({ GET });

		await Commands.serviceWebhook(client, "svc-1");

		expect(GET).toHaveBeenCalledWith("/services/{serviceId}/webhook", {
			params: { path: { serviceId: "svc-1" } },
		});
		expect(printJsonSpy).toHaveBeenCalledWith(
			expect.objectContaining({ secret: "shh" }),
		);
	});

	test("calls Output.fail() on the not-turned-on 404", async () => {
		const failSpy = spyOn(Output, "fail").mockImplementation(() => {
			throw new FailCalled();
		});
		const GET = mock(async () =>
			errResponse(404, "Not Found", {
				error: "Deploy on push isn't turned on for this service.",
			}),
		);

		await expect(
			Commands.serviceWebhook(fakeClient({ GET }), "svc-1"),
		).rejects.toThrow(FailCalled);
		expect(failSpy).toHaveBeenCalledWith(
			'404 Not Found: {"error":"Deploy on push isn\'t turned on for this service."}',
		);
	});
});

describe("Commands.stacksList", () => {
	test("prints a mapped table when json=false", async () => {
		spyOnOutput();
		const GET = mock(async () =>
			okResponse([{ id: "p1", name: "Stack One", slug: "stack-one" }]),
		);
		const client = fakeClient({ GET });

		await Commands.stacksList(client, { json: false });

		expect(printTableSpy).toHaveBeenCalledWith(
			[{ id: "p1", name: "Stack One", slug: "stack-one" }],
			["id", "name", "slug"],
		);
	});
});

describe("Commands.templatesList", () => {
	test("prints a mapped table combining image:tag when json=false", async () => {
		spyOnOutput();
		const GET = mock(async () =>
			okResponse([{ id: "t1", image: "redis", name: "Redis", tag: "7" }]),
		);
		const client = fakeClient({ GET });

		await Commands.templatesList(client, { json: false });

		expect(printTableSpy).toHaveBeenCalledWith(
			[{ id: "t1", image: "redis:7", name: "Redis" }],
			["id", "name", "image"],
		);
	});
});

function scanFixture(overrides: Record<string, unknown> = {}) {
	return {
		counts: { critical: 0, high: 2, low: 1, medium: 0, unknown: 0 },
		deploymentId: null,
		digest: "sha256:abc",
		error: null,
		findings: [
			{
				fixedVersion: "1.2.4",
				id: "CVE-2026-0001",
				installedVersion: "1.2.3",
				pkg: "openssl",
				severity: "HIGH",
				title: "A bad one",
			},
		],
		id: "scan-1",
		imageRef: "nginx:alpine",
		scannedAt: "2026-09-16T12:00:00.000Z",
		serviceId: "svc-1",
		source: "the deployed image",
		status: "ok",
		totalFindings: 3,
		...overrides,
	};
}

function silenceConsole() {
	spyOn(console, "log").mockImplementation(() => undefined);
}

describe("findingsAtOrAbove", () => {
	test("sums every severity at or above the level", () => {
		const counts = { critical: 1, high: 2, low: 4, medium: 3, unknown: 5 };
		expect(findingsAtOrAbove(counts, "critical")).toBe(1);
		expect(findingsAtOrAbove(counts, "high")).toBe(3);
		expect(findingsAtOrAbove(counts, "medium")).toBe(6);
		expect(findingsAtOrAbove(counts, "low")).toBe(10);
	});
});

function revisionFixture(overrides: Record<string, unknown> = {}) {
	return {
		buildSource: "image" as const,
		createdAt: "2026-09-16T12:00:00.000Z",
		current: false,
		gitCommit: null,
		gitRef: null,
		health: "healthy" as const,
		healthReason: null,
		id: "rev-1",
		imageDigest: `sha256:${"b".repeat(64)}`,
		imageId: null,
		imageRef: "nginx:1.27",
		lastDeployedAt: "2026-09-16T12:00:10.000Z",
		latestDeploymentId: "rev-1",
		previous: true,
		redeployCount: 0,
		retained: true,
		status: "running" as const,
		...overrides,
	};
}

describe("Commands.revisionsList / serviceRollback", () => {
	test("marks the current and previous revisions in the table", async () => {
		spyOnOutput();
		const GET = mock(async () =>
			okResponse([
				revisionFixture({ current: true, id: "rev-2", previous: false }),
				revisionFixture({ gitCommit: "0123456789" }),
				revisionFixture({ id: "rev-0", previous: false, retained: false }),
			]),
		);
		await Commands.revisionsList(fakeClient({ GET }), "svc-1", false);
		expect(GET).toHaveBeenCalledWith("/services/{serviceId}/revisions", {
			params: { path: { serviceId: "svc-1" } },
		});
		const rows = printTableSpy.mock.calls[0]?.[0] as Record<string, string>[];
		expect(rows.map((row) => row.marker)).toEqual([
			"current",
			"previous",
			"(not retained)",
		]);
		expect(rows[1]?.commit).toBe("0123456");
		expect(rows[1]?.lastDeployedAt).toBe("2026-09-16T12:00:10.000Z");
		expect(printTableSpy.mock.calls[0]?.[1]).toContain("lastDeployedAt");
	});

	test("rollback without a revision id targets the previous revision", async () => {
		spyOnOutput();
		const POST = mock(async () =>
			okResponse({ deploymentId: "dep-9", success: true }),
		);
		await Commands.serviceRollback(fakeClient({ POST }), "svc-1", undefined);
		expect(POST).toHaveBeenCalledWith(
			"/services/{serviceId}/revisions/{revisionId}/deploy",
			{ params: { path: { revisionId: "previous", serviceId: "svc-1" } } },
		);
		await Commands.serviceRollback(fakeClient({ POST }), "svc-1", "rev-1");
		expect(POST).toHaveBeenLastCalledWith(
			"/services/{serviceId}/revisions/{revisionId}/deploy",
			{ params: { path: { revisionId: "rev-1", serviceId: "svc-1" } } },
		);
		await Commands.serviceRollback(
			fakeClient({ POST }),
			"svc-1",
			"rev-1",
			true,
		);
		expect(POST).toHaveBeenLastCalledWith(
			"/services/{serviceId}/revisions/{revisionId}/deploy",
			{
				params: {
					path: { revisionId: "rev-1", serviceId: "svc-1" },
					query: { restoreConfig: "true" },
				},
			},
		);
		expect(revisionRow(revisionFixture()).digest).toBe(
			`sha256:${"b".repeat(12)}`,
		);
	});

	test("shows why a revision was judged unhealthy", () => {
		const row = revisionRow(
			revisionFixture({
				health: "unhealthy",
				healthReason: "2 swarm tasks failed: bind source path does not exist",
			}),
		);
		expect(row.reason).toBe(
			"2 swarm tasks failed: bind source path does not exist",
		);
		expect(revisionRow(revisionFixture()).reason).toBe("");
	});
});

describe("Commands.serviceLogs", () => {
	test("passes tail and follow and writes the stream to stdout", async () => {
		const written: string[] = [];
		spyOn(process.stdout, "write").mockImplementation((chunk) => {
			written.push(new TextDecoder().decode(chunk as Uint8Array));
			return true;
		});
		const GET = mock(async () =>
			okResponse(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("line 1\n"));
						controller.enqueue(new TextEncoder().encode("line 2\n"));
						controller.close();
					},
				}),
			),
		);

		await Commands.serviceLogs(fakeClient({ GET }), "svc-1", {
			follow: true,
			tail: 50,
		});

		expect(GET).toHaveBeenCalledWith("/services/{serviceId}/logs", {
			params: {
				path: { serviceId: "svc-1" },
				query: { follow: "true", tail: "50" },
			},
			parseAs: "stream",
		});
		expect(written.join("")).toBe("line 1\nline 2\n");
	});
});

describe("Commands.scansList", () => {
	test("passes the service id and list query, prints a table", async () => {
		spyOnOutput();
		const GET = mock(async () => okResponse([scanFixture()]));
		const client = fakeClient({ GET });

		await Commands.scansList(client, "svc-1", { json: false, perPage: 5 });

		expect(GET).toHaveBeenCalledWith("/services/{serviceId}/scans", {
			params: { path: { serviceId: "svc-1" }, query: { perPage: "5" } },
		});
		expect(printTableSpy).toHaveBeenCalledWith(
			[
				{
					critical: 0,
					high: 2,
					id: "scan-1",
					image: "nginx:alpine",
					low: 1,
					medium: 0,
					scannedAt: "2026-09-16T12:00:00.000Z",
					status: "ok",
				},
			],
			[
				"id",
				"scannedAt",
				"status",
				"critical",
				"high",
				"medium",
				"low",
				"image",
			],
		);
	});

	test("prints JSON when json=true", async () => {
		spyOnOutput();
		const GET = mock(async () => okResponse([]));

		await Commands.scansList(fakeClient({ GET }), "svc-1", { json: true });

		expect(printJsonSpy).toHaveBeenCalledWith([]);
		expect(printTableSpy).not.toHaveBeenCalled();
	});
});

describe("Commands.scanGet", () => {
	test("latest hits the latest endpoint and prints a findings table", async () => {
		spyOnOutput();
		silenceConsole();
		const GET = mock(async () => okResponse(scanFixture()));

		await Commands.scanGet(fakeClient({ GET }), "svc-1", "latest", false);

		expect(GET).toHaveBeenCalledWith("/services/{serviceId}/scans/latest", {
			params: { path: { serviceId: "svc-1" } },
		});
		expect(printTableSpy).toHaveBeenCalledWith(
			[
				{
					fixed: "1.2.4",
					id: "CVE-2026-0001",
					installed: "1.2.3",
					package: "openssl",
					severity: "HIGH",
					title: "A bad one",
				},
			],
			["severity", "id", "package", "installed", "fixed", "title"],
		);
	});

	test("a scan id hits the by-id endpoint", async () => {
		spyOnOutput();
		const GET = mock(async () => okResponse(scanFixture()));

		await Commands.scanGet(fakeClient({ GET }), "svc-1", "scan-1", true);

		expect(GET).toHaveBeenCalledWith("/services/{serviceId}/scans/{scanId}", {
			params: { path: { scanId: "scan-1", serviceId: "svc-1" } },
		});
		expect(printJsonSpy).toHaveBeenCalledWith(scanFixture());
	});

	test("a never-scanned service fails with the API's 404", async () => {
		const failSpy = spyOn(Output, "fail").mockImplementation(() => {
			throw new FailCalled();
		});
		const GET = mock(async () =>
			errResponse(404, "Not Found", {
				error: "This service hasn't been scanned yet.",
			}),
		);

		await expect(
			Commands.scanGet(fakeClient({ GET }), "svc-1", "latest", true),
		).rejects.toThrow(FailCalled);
		expect(failSpy).toHaveBeenCalledWith(
			'404 Not Found: {"error":"This service hasn\'t been scanned yet."}',
		);
	});
});

describe("Commands.serviceScan", () => {
	function jobs(...statuses: string[]) {
		let call = 0;
		return (path: string) => {
			if (path === "/jobs/{jobId}") {
				const status = statuses[Math.min(call, statuses.length - 1)];
				call += 1;
				return Promise.resolve(
					okResponse({
						error: status === "failed" ? "trivy exploded" : null,
						id: "job-1",
						status,
					}),
				);
			}
			return Promise.resolve(okResponse(scanFixture()));
		};
	}

	test("without --wait prints the queued job and returns", async () => {
		spyOnOutput();
		const POST = mock(async () =>
			okResponse({ jobId: "job-1", status: "queued" }),
		);
		const GET = mock();

		await Commands.serviceScan(fakeClient({ GET, POST }), "svc-1", {
			json: false,
			wait: false,
		});

		expect(POST).toHaveBeenCalledWith("/services/{serviceId}/scans", {
			params: { path: { serviceId: "svc-1" } },
		});
		expect(GET).not.toHaveBeenCalled();
		expect(printJsonSpy).toHaveBeenCalledWith({
			jobId: "job-1",
			status: "queued",
		});
	});

	test("--wait polls the job, then prints the latest scan", async () => {
		spyOnOutput();
		const POST = mock(async () =>
			okResponse({ jobId: "job-1", status: "queued" }),
		);
		const GET = mock(jobs("queued", "running", "succeeded"));

		await Commands.serviceScan(fakeClient({ GET, POST }), "svc-1", {
			json: true,
			pollMs: 0,
			wait: true,
		});

		const paths = GET.mock.calls.map((call) => call[0]);
		expect(paths).toEqual([
			"/jobs/{jobId}",
			"/jobs/{jobId}",
			"/jobs/{jobId}",
			"/services/{serviceId}/scans/latest",
		]);
		expect(printJsonSpy).toHaveBeenCalledWith(scanFixture());
	});

	test("--wait on a 409 follows the scan already in flight", async () => {
		spyOnOutput();
		const POST = mock(async () =>
			errResponse(409, "Conflict", { error: "busy", jobId: "job-1" }),
		);
		const GET = mock(jobs("succeeded"));

		await Commands.serviceScan(fakeClient({ GET, POST }), "svc-1", {
			json: true,
			pollMs: 0,
			wait: true,
		});

		expect(GET).toHaveBeenCalledWith("/jobs/{jobId}", {
			params: { path: { jobId: "job-1" } },
		});
	});

	test("a 409 without --wait fails", async () => {
		const failSpy = spyOn(Output, "fail").mockImplementation(() => {
			throw new FailCalled();
		});
		const POST = mock(async () =>
			errResponse(409, "Conflict", { error: "busy", jobId: "job-1" }),
		);

		await expect(
			Commands.serviceScan(fakeClient({ POST }), "svc-1", {
				json: true,
				wait: false,
			}),
		).rejects.toThrow(FailCalled);
		expect(failSpy).toHaveBeenCalledWith(
			'409 Conflict: {"error":"busy","jobId":"job-1"}',
		);
	});

	test("a failed job exits non-zero with its error", async () => {
		const failSpy = spyOn(Output, "fail").mockImplementation(() => {
			throw new FailCalled();
		});
		const POST = mock(async () =>
			okResponse({ jobId: "job-1", status: "queued" }),
		);
		const GET = mock(jobs("failed"));

		await expect(
			Commands.serviceScan(fakeClient({ GET, POST }), "svc-1", {
				json: true,
				pollMs: 0,
				wait: true,
			}),
		).rejects.toThrow(FailCalled);
		expect(failSpy).toHaveBeenCalledWith("Scan failed: trivy exploded");
	});

	test("--fail-on exits non-zero when findings reach the level", async () => {
		spyOnOutput();
		const failSpy = spyOn(Output, "fail").mockImplementation(() => {
			throw new FailCalled();
		});
		const POST = mock(async () =>
			okResponse({ jobId: "job-1", status: "queued" }),
		);
		const GET = mock(jobs("succeeded"));

		await expect(
			Commands.serviceScan(fakeClient({ GET, POST }), "svc-1", {
				failOn: "high",
				json: true,
				pollMs: 0,
				wait: true,
			}),
		).rejects.toThrow(FailCalled);
		expect(failSpy).toHaveBeenCalledWith(
			"2 findings at or above HIGH (--fail-on high).",
		);
	});

	test("--fail-on passes when nothing reaches the level", async () => {
		spyOnOutput();
		const failSpy = spyOn(Output, "fail");
		const POST = mock(async () =>
			okResponse({ jobId: "job-1", status: "queued" }),
		);
		const GET = mock(jobs("succeeded"));

		await Commands.serviceScan(fakeClient({ GET, POST }), "svc-1", {
			failOn: "critical",
			json: true,
			pollMs: 0,
			wait: true,
		});

		expect(failSpy).not.toHaveBeenCalled();
	});

	test("gives up after the timeout", async () => {
		const failSpy = spyOn(Output, "fail").mockImplementation(() => {
			throw new FailCalled();
		});
		const POST = mock(async () =>
			okResponse({ jobId: "job-1", status: "queued" }),
		);
		const GET = mock(jobs("running"));

		await expect(
			Commands.serviceScan(fakeClient({ GET, POST }), "svc-1", {
				json: true,
				pollMs: 0,
				timeoutMs: 0,
				wait: true,
			}),
		).rejects.toThrow(FailCalled);
		expect(failSpy).toHaveBeenCalledWith(
			"Timed out waiting for scan job job-1 (still running).",
		);
	});
});

function instanceStatusFixture(overrides: Record<string, unknown> = {}) {
	return {
		current: "1.0.29",
		latest: {
			publishedAt: "2026-09-17T12:00:00.000Z",
			url: "https://github.com/orochibraru/homerun/releases/tag/v1.0.30",
			version: "1.0.30",
		},
		preflight: {
			pendingDeploys: 0,
			reason: null,
			ready: true,
			runningJobs: 0,
			supported: true,
		},
		updateAvailable: true,
		...overrides,
	};
}

describe("instanceStatusText", () => {
	test("points at the update command when one can start", () => {
		expect(instanceStatusText(instanceStatusFixture())).toContain(
			"homerun instance update",
		);
	});

	test("explains why an available update can't start", () => {
		const text = instanceStatusText(
			instanceStatusFixture({
				preflight: {
					pendingDeploys: 1,
					reason: "1 deployment(s) are queued or running.",
					ready: false,
					runningJobs: 0,
					supported: true,
				},
			}),
		);
		expect(text).toContain("1 deployment(s) are queued or running.");
	});

	test("says up to date, or that GitHub couldn't be reached", () => {
		expect(
			instanceStatusText(instanceStatusFixture({ updateAvailable: false })),
		).toContain("Up to date.");
		expect(
			instanceStatusText(instanceStatusFixture({ latest: null })),
		).toContain("unknown");
	});
});

describe("Commands.instanceUpdate", () => {
	test("starts the update and waits through the restart for the new version", async () => {
		spyOn(console, "log").mockImplementation(() => undefined);
		const POST = mock(async () => okResponse({ version: "1.0.30" }));
		let polls = 0;
		const GET = mock(async () => {
			polls += 1;
			if (polls === 1) {
				throw new TypeError("fetch failed");
			}
			return okResponse(
				instanceStatusFixture({ current: polls === 2 ? "1.0.29" : "1.0.30" }),
			);
		});

		await Commands.instanceUpdate(fakeClient({ GET, POST }), {
			pollMs: 1,
			wait: true,
		});

		expect(POST).toHaveBeenCalledWith("/instance/update");
		expect(polls).toBe(3);
	});

	test("doesn't poll without --wait", async () => {
		spyOn(console, "log").mockImplementation(() => undefined);
		const POST = mock(async () => okResponse({ version: "1.0.30" }));
		const GET = mock();

		await Commands.instanceUpdate(fakeClient({ GET, POST }), { wait: false });

		expect(GET).not.toHaveBeenCalled();
	});
});
