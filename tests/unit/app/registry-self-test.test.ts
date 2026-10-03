import { describe, expect, test } from "bun:test";
import { certificateCheck, publicProbeCheck } from "#lib/registry-self-test.js";

describe("publicProbeCheck", () => {
	test("a 401 is the healthy answer", () => {
		expect(publicProbeCheck("registry.example.com", 401).ok).toBe(true);
	});

	test("an anonymous 200 fails", () => {
		expect(publicProbeCheck("registry.example.com", 200).ok).toBe(false);
	});

	test("a 404 means Traefik isn't routing the host", () => {
		const check = publicProbeCheck("registry.example.com", 404);
		expect(check.ok).toBe(false);
		expect(check.detail).toContain("isn't routing");
	});
});

describe("certificateCheck", () => {
	test("names Traefik's default certificate", () => {
		const check = certificateCheck(
			"registry.example.com",
			"unable to verify the first certificate",
			"TRAEFIK DEFAULT CERT",
		);
		expect(check.ok).toBe(false);
		expect(check.detail).toContain("default certificate");
	});

	test("names any other certificate it was served", () => {
		expect(
			certificateCheck("registry.example.com", "mismatch", "other.example.com")
				.detail,
		).toContain("other.example.com");
	});
});
