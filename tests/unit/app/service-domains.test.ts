import { describe, expect, test } from "bun:test";
import {
	defaultHostname,
	isUnderDomain,
	normalizeDomains,
	primaryHostname,
	serviceHostnames,
} from "$lib/service-domains";

const base = "example.com";
const svc = {
	defaultDomainEnabled: true,
	domains: ["app.example.org", "www.example.org"],
	primaryDomain: null,
	slug: "app",
};

describe("service domains", () => {
	test("the default hostname carries the stack's slug", () => {
		expect(defaultHostname("app", null, base)).toBe("app.example.com");
		expect(defaultHostname("app", "shop", base)).toBe("shop-app.example.com");
	});

	test("routes the default hostname first, then the service's own domains", () => {
		expect(serviceHostnames(svc, null, base)).toEqual([
			"app.example.com",
			"app.example.org",
			"www.example.org",
		]);
		expect(
			serviceHostnames({ ...svc, defaultDomainEnabled: false }, null, base),
		).toEqual(["app.example.org", "www.example.org"]);
	});

	test("the main domain is the chosen one while it's still routed", () => {
		expect(
			primaryHostname({ ...svc, primaryDomain: "www.example.org" }, null, base),
		).toBe("www.example.org");
		expect(
			primaryHostname(
				{ ...svc, primaryDomain: "gone.example.org" },
				null,
				base,
			),
		).toBe("app.example.com");
		expect(
			primaryHostname(
				{ ...svc, defaultDomainEnabled: false, domains: [] },
				null,
				base,
			),
		).toBeNull();
	});

	test("a subdomain of the base domain is under it, a lookalike isn't", () => {
		expect(isUnderDomain("drive.example.com", base)).toBe(true);
		expect(isUnderDomain("example.com", base)).toBe(true);
		expect(isUnderDomain("badexample.com", base)).toBe(false);
	});

	test("normalizing trims, lowercases and drops blanks and duplicates", () => {
		expect(
			normalizeDomains([" A.example.org", "", "a.example.org", "b.io"]),
		).toEqual(["a.example.org", "b.io"]);
	});
});
