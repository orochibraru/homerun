import { describe, expect, test } from "bun:test";
import { trustedOriginsFor } from "$lib/services/auth-origins";

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
