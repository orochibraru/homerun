import { describe, expect, test } from "bun:test";
import {
	directAccessOrigins,
	directAccessScheme,
	trustedOriginsFor,
} from "$lib/services/auth-origins";

describe("trustedOriginsFor", () => {
	test("trusts the configured domain alongside an IP ORIGIN", () => {
		const origins = trustedOriginsFor({
			authOrigin: "https://homerun.example.com",
			baseDomain: "example.com",
			envOrigin: "http://203.0.113.4:3000",
		});
		expect(origins).toContain("http://203.0.113.4:3000");
		expect(origins).toContain("https://homerun.example.com");
		expect(origins).toContain("http://homerun.example.com");
		expect(origins).toContain("https://example.com");
	});

	test("never trusts a wildcard subdomain", () => {
		const origins = trustedOriginsFor({
			authOrigin: null,
			baseDomain: "example.com",
			envOrigin: undefined,
		});
		expect(origins.some((origin) => origin.includes("*"))).toBe(false);
	});

	test("ignores localhost and junk values", () => {
		expect(
			trustedOriginsFor({
				authOrigin: "not a url",
				baseDomain: "localhost",
				envOrigin: "",
			}),
		).toEqual([]);
	});
});

describe("directAccessOrigins", () => {
	test("trusts the server's own IP or localhost, whatever the domain says", () => {
		expect(directAccessOrigins("203.0.113.4:3000")).toEqual([
			"http://203.0.113.4:3000",
			"https://203.0.113.4:3000",
		]);
		expect(directAccessOrigins("[2001:db8::1]:3000")).toEqual([
			"http://[2001:db8::1]:3000",
			"https://[2001:db8::1]:3000",
		]);
		expect(directAccessOrigins("localhost:5173")).toContain(
			"http://localhost:5173",
		);
	});

	test("leaves named hosts to the configured origins", () => {
		expect(directAccessOrigins("homerun.example.com")).toEqual([]);
		expect(directAccessOrigins("evil.203.0.113.4.nip.io")).toEqual([]);
		expect(directAccessOrigins(null)).toEqual([]);
	});
});

describe("directAccessScheme", () => {
	test("plain HTTP on an IP unless a proxy forwarded HTTPS", () => {
		expect(directAccessScheme("203.0.113.4:3000", null)).toBe("http");
		expect(directAccessScheme("203.0.113.4", "https")).toBe("https");
		expect(directAccessScheme("[2001:db8::1]:3000", "http")).toBe("http");
	});

	test("keeps the configured cookies on a named host", () => {
		expect(directAccessScheme("homerun.example.com", "https")).toBeNull();
		expect(directAccessScheme(null, null)).toBeNull();
	});
});
