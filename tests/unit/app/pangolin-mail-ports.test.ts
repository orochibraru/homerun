import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { PangolinService } =
	await import("../../../src/lib/services/pangolin.service");
const { isRawTcpOn, mailResourceName, mailTargetHost, PangolinMailPorts } =
	await import("../../../src/lib/services/pangolin/mail-ports");

type Connection = NonNullable<
	Awaited<ReturnType<typeof PangolinService.settingsOrNull>>
>;

const connection = {
	baseUrl: "https://pangolin.test/v1",
	mainSiteName: "home",
	orgId: "org",
	ownsAuth: false,
	port: 443,
	targetHost: "homerun-traefik",
	targetHostExplicit: false,
	token: "t",
} as Connection;

const restorers: { mockRestore: () => void }[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
	for (const restorer of restorers.splice(0)) {
		restorer.mockRestore();
	}
	globalThis.fetch = originalFetch;
});

function recordFetch(
	answer: (url: string, method: string) => { body: unknown; status?: number },
) {
	const calls: { body: unknown; method: string; url: string }[] = [];
	globalThis.fetch = ((url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		calls.push({
			body: init?.body ? JSON.parse(String(init.body)) : null,
			method,
			url,
		});
		const { body, status = 200 } = answer(url, method);
		return Promise.resolve(new Response(JSON.stringify(body), { status }));
	}) as typeof fetch;
	return calls;
}

describe("mail port helpers", () => {
	test("raw TCP resources are matched by port, in either API shape", () => {
		expect(
			isRawTcpOn({ mode: "tcp", name: "x", proxyPort: 25, resourceId: 1 }, 25),
		).toBe(true);
		expect(
			isRawTcpOn(
				{
					http: false,
					name: "x",
					protocol: "tcp",
					proxyPort: 993,
					resourceId: 1,
				},
				993,
			),
		).toBe(true);
		expect(
			isRawTcpOn({ mode: "http", name: "x", proxyPort: 25, resourceId: 1 }, 25),
		).toBe(false);
		expect(
			isRawTcpOn({ mode: "tcp", name: "x", proxyPort: 26, resourceId: 1 }, 25),
		).toBe(false);
	});

	test("targets the mail container unless the tunnel reaches the host", () => {
		expect(mailTargetHost("homerun-traefik", false)).toBe("homerun-mail");
		expect(mailTargetHost("localhost", false)).toBe("localhost");
		expect(mailTargetHost("10.0.0.5", true)).toBe("10.0.0.5");
		expect(mailResourceName(25)).toBe("Homerun mail 25");
	});
});

describe("PangolinMailPorts", () => {
	test("does nothing when Pangolin isn't the provider", async () => {
		restorers.push(
			spyOn(PangolinService, "settingsOrNull").mockResolvedValue(null),
		);
		expect(await PangolinMailPorts.sync()).toBeNull();
		expect(await PangolinMailPorts.missing()).toBeNull();
		await PangolinMailPorts.remove();
	});

	test("creates a raw resource and target per missing port, keeps a correct one", async () => {
		restorers.push(
			spyOn(PangolinService, "settingsOrNull").mockResolvedValue(connection),
			spyOn(PangolinService, "listSites").mockResolvedValue([
				{ name: "home", siteId: 7 },
			]),
			spyOn(PangolinService, "listResources").mockResolvedValue([
				{
					fullDomain: null,
					mode: "tcp",
					name: "Homerun mail 25",
					proxyPort: 25,
					resourceId: 1,
				} as never,
			]),
			spyOn(PangolinService, "listTargets").mockImplementation(
				(_base, _token, resourceId) =>
					Promise.resolve(
						resourceId === 1
							? [
									{
										enabled: true,
										ip: "homerun-mail",
										port: 25,
										siteId: 7,
										targetId: 11,
									},
								]
							: [],
					),
			),
		);
		const calls = recordFetch((_url, method) => ({
			body: method === "PUT" ? { data: { name: "n", resourceId: 9 } } : {},
		}));
		const results = await PangolinMailPorts.sync();
		expect(results?.map((result) => result.ok)).toEqual([
			true,
			true,
			true,
			true,
		]);
		expect(results?.[0]?.detail).toBe("kept tcp:25 -> homerun-mail:25");
		const creates = calls.filter((call) =>
			call.url.endsWith("/org/org/resource"),
		);
		expect(creates.map((call) => call.body)).toEqual([
			{ mode: "tcp", name: "Homerun mail 465", proxyPort: 465 },
			{ mode: "tcp", name: "Homerun mail 587", proxyPort: 587 },
			{ mode: "tcp", name: "Homerun mail 993", proxyPort: 993 },
		]);
		expect(
			calls.filter((call) => call.url.endsWith("/resource/9/target")).length,
		).toBe(3);
	});

	test("explains a refused raw resource and an unknown site", async () => {
		restorers.push(
			spyOn(PangolinService, "settingsOrNull").mockResolvedValue(connection),
			spyOn(PangolinService, "listSites").mockResolvedValue([
				{ name: "home", siteId: 7 },
			]),
			spyOn(PangolinService, "listResources").mockResolvedValue([]),
		);
		recordFetch(() => ({
			body: { message: "raw resources are disabled" },
			status: 400,
		}));
		const results = await PangolinMailPorts.sync();
		expect(results?.every((result) => !result.ok)).toBe(true);
		expect(results?.[0]?.detail).toContain("allow_raw_resources");
		expect(await PangolinMailPorts.missing()).toEqual([25, 465, 587, 993]);

		restorers.push(spyOn(PangolinService, "listSites").mockResolvedValue([]));
		expect((await PangolinMailPorts.sync())?.[0]?.detail).toContain(
			'site "home" not found',
		);
	});

	test("moves a target pointing elsewhere", async () => {
		restorers.push(
			spyOn(PangolinService, "settingsOrNull").mockResolvedValue(connection),
			spyOn(PangolinService, "listSites").mockResolvedValue([
				{ name: "home", siteId: 7 },
			]),
			spyOn(PangolinService, "listResources").mockResolvedValue(
				[25, 465, 587, 993].map((port) => ({
					fullDomain: null,
					mode: "tcp",
					name: mailResourceName(port),
					proxyPort: port,
					resourceId: port,
				})) as never,
			),
			spyOn(PangolinService, "listTargets").mockResolvedValue([
				{ enabled: true, ip: "old-host", port: 25, targetId: 3 },
			]),
		);
		const calls = recordFetch(() => ({ body: {} }));
		await PangolinMailPorts.sync();
		expect(calls.filter((call) => call.url.endsWith("/target/3")).length).toBe(
			4,
		);
	});

	test("removes only the resources Homerun named, ignoring 404s", async () => {
		restorers.push(
			spyOn(PangolinService, "settingsOrNull").mockResolvedValue(connection),
			spyOn(PangolinService, "listResources").mockResolvedValue([
				{
					fullDomain: null,
					mode: "tcp",
					name: "Homerun mail 25",
					proxyPort: 25,
					resourceId: 1,
				},
				{
					fullDomain: null,
					mode: "tcp",
					name: "My own 465",
					proxyPort: 465,
					resourceId: 2,
				},
				{
					fullDomain: null,
					mode: "tcp",
					name: "Homerun mail 993",
					proxyPort: 993,
					resourceId: 3,
				},
			] as never),
		);
		const calls = recordFetch((url) => ({
			body: {},
			status: url.endsWith("/resource/3") ? 404 : 200,
		}));
		await PangolinMailPorts.remove();
		expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			"DELETE https://pangolin.test/v1/resource/1",
			"DELETE https://pangolin.test/v1/resource/3",
		]);
	});
});
