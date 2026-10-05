import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreStubs, stub } from "../support/stub";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { config } = await import("../../../src/lib/config");
const { Logger } = await import("../../../src/lib/logger");
const { DomainDnsService } = await import(
	"../../../src/lib/services/domain-dns.service"
);
const { PangolinService } = await import(
	"../../../src/lib/services/pangolin.service"
);
const {
	deleteDns,
	serviceHostname,
	syncDashboardDns,
	syncDns,
	syncRegistryDns,
} = await import("../../../src/lib/services/dns.service");

type Verdict =
	| { detail: string; ok: boolean; provider: string }
	| null
	| Error
	| string;

const calls: unknown[][] = [];
const logs: string[] = [];
let cloudflare: (hostname: string) => Verdict = () => null;
let pangolin: (hostname: string) => Verdict = () => null;
const originalBaseDomain = config.baseDomain;
const originalOrigin = config.auth.origin;

function settle(verdict: Verdict) {
	return verdict instanceof Error || typeof verdict === "string"
		? Promise.reject(verdict)
		: Promise.resolve(verdict);
}

beforeEach(() => {
	calls.length = 0;
	logs.length = 0;
	cloudflare = () => null;
	pangolin = () => null;
	config.baseDomain = "example.com";
	stub(DomainDnsService, "syncHostname", (host: string) => {
		calls.push(["cloudflare.sync", host, "example.com"]);
		return settle(cloudflare(host));
	});
	stub(DomainDnsService, "deleteHostname", (host: string) => {
		calls.push(["cloudflare.delete", host, "example.com"]);
		return settle(cloudflare(host));
	});
	stub(PangolinService, "syncDnsRecord", (host: string, opts: unknown) => {
		calls.push(["pangolin.sync", host, opts]);
		return settle(pangolin(host));
	});
	stub(PangolinService, "deleteDnsRecord", (host: string) => {
		calls.push(["pangolin.delete", host]);
		return settle(pangolin(host));
	});
	stub(Logger.prototype, "info", (message: string) => {
		logs.push(`info:${message}`);
	});
	stub(Logger.prototype, "warn", (message: string) => {
		logs.push(`warn:${message}`);
	});
});

afterEach(() => {
	config.baseDomain = originalBaseDomain;
	config.auth.origin = originalOrigin;
	restoreStubs();
});

describe("serviceHostname", () => {
	test("prefixes the stack slug when there is one", () => {
		expect(serviceHostname("web", "shop")).toBe("shop-web.example.com");
		expect(serviceHostname("web", null)).toBe("web.example.com");
		expect(serviceHostname("web", undefined)).toBe("web.example.com");
		expect(serviceHostname("web", "")).toBe("web.example.com");
	});
});

describe("syncDns / deleteDns", () => {
	test("no configured provider means an empty result", async () => {
		expect(await syncDns(["a.example.com"])).toEqual([]);
		expect(calls).toEqual([
			["cloudflare.sync", "a.example.com", "example.com"],
			["pangolin.sync", "a.example.com", {}],
		]);
	});

	test("runs every provider over every hostname and prefixes each detail with the hostname", async () => {
		cloudflare = () => ({
			detail: "record created",
			ok: true,
			provider: "cloudflare",
		});
		pangolin = (host) =>
			host === "b.example.com"
				? { detail: "resource exists", ok: true, provider: "pangolin" }
				: null;

		const results = await syncDns(["a.example.com", "b.example.com"], {
			sso: true,
		});

		expect(results).toEqual([
			{
				detail: "a.example.com: record created",
				ok: true,
				provider: "cloudflare",
			},
			{
				detail: "b.example.com: record created",
				ok: true,
				provider: "cloudflare",
			},
			{
				detail: "b.example.com: resource exists",
				ok: true,
				provider: "pangolin",
			},
		]);
		expect(calls).toContainEqual([
			"pangolin.sync",
			"a.example.com",
			{ sso: true },
		]);
	});

	test("a rejecting provider is reported as a failure, not dropped", async () => {
		cloudflare = () => new Error("zone not found");
		pangolin = () => "api down";

		expect(await deleteDns(["x.example.com"])).toEqual([
			{
				detail: "x.example.com: zone not found",
				ok: false,
				provider: "dns",
			},
			{ detail: "x.example.com: api down", ok: false, provider: "pangolin" },
		]);
		expect(calls).toEqual([
			["cloudflare.delete", "x.example.com", "example.com"],
			["pangolin.delete", "x.example.com"],
		]);
	});

	test("no hostnames means no provider calls", async () => {
		expect(await deleteDns([])).toEqual([]);
		expect(calls).toEqual([]);
	});
});

describe("syncDashboardDns", () => {
	test("syncs the dashboard host without SSO and logs each provider's outcome", async () => {
		config.auth.origin = "https://homerun.example.com";
		cloudflare = () => ({
			detail: "updated",
			ok: true,
			provider: "cloudflare",
		});
		pangolin = () => ({ detail: "forbidden", ok: false, provider: "pangolin" });

		await syncDashboardDns();

		expect(calls).toEqual([
			["cloudflare.sync", "homerun.example.com", "example.com"],
			["pangolin.sync", "homerun.example.com", { sso: false }],
		]);
		expect(logs).toEqual([
			"info:Dashboard (cloudflare): homerun.example.com: updated",
			"warn:Dashboard sync failed (pangolin): homerun.example.com: forbidden",
		]);
	});

	test("skips a missing origin, a bare IP, a dotless host and a non-default port", async () => {
		for (const origin of [
			undefined,
			"http://192.168.1.10",
			"http://localhost",
			"https://homerun.example.com:8443",
			"not a url",
		]) {
			config.auth.origin = origin;
			await syncDashboardDns();
		}

		expect(calls).toEqual([]);
		expect(logs).toEqual([]);
	});
});

describe("syncRegistryDns", () => {
	test("routes the new host without SSO and removes the one it replaced", async () => {
		await syncRegistryDns("old-registry.example.com", "registry.example.com");
		expect(calls).toContainEqual([
			"pangolin.sync",
			"registry.example.com",
			{ sso: false },
		]);
		expect(calls).toContainEqual([
			"pangolin.delete",
			"old-registry.example.com",
		]);
	});

	test("keeps the host it re-asserts", async () => {
		await syncRegistryDns(null, "registry.example.com");
		expect(calls.some((call) => String(call[0]).endsWith(".delete"))).toBe(
			false,
		);
	});
});
