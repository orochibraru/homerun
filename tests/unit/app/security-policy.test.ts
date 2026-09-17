import { describe, expect, test } from "bun:test";
import {
	nextPasskeyRpId,
	passkeyRpId,
	passkeyUsableOn,
	safeNextPath,
	strandedPasskeyCount,
	totpSecretFromUri,
	unmetSecurityRequirements,
} from "../../../src/lib/security-policy";

describe("unmetSecurityRequirements", () => {
	const none = { passkeyCount: 0, twoFactorEnabled: false };
	const both = { passkeyCount: 2, twoFactorEnabled: true };

	test("nothing is required when every policy is off", () => {
		expect(
			unmetSecurityRequirements(
				{ requirePasskey: false, requireTwoFactor: false },
				none,
			),
		).toEqual([]);
	});

	test("reports each requirement the user hasn't enrolled in", () => {
		expect(
			unmetSecurityRequirements(
				{ requirePasskey: true, requireTwoFactor: true },
				none,
			),
		).toEqual(["twoFactor", "passkey"]);
		expect(
			unmetSecurityRequirements(
				{ requirePasskey: true, requireTwoFactor: true },
				{ passkeyCount: 1, twoFactorEnabled: false },
			),
		).toEqual(["twoFactor"]);
	});

	test("is satisfied once the user has enrolled", () => {
		expect(
			unmetSecurityRequirements(
				{ requirePasskey: true, requireTwoFactor: true },
				both,
			),
		).toEqual([]);
	});
});

describe("safeNextPath", () => {
	test("keeps a same-origin path", () => {
		expect(safeNextPath("/services/abc")).toBe("/services/abc");
	});

	test("falls back to the dashboard for anything that could leave the app", () => {
		expect(safeNextPath(null)).toBe("/");
		expect(safeNextPath("")).toBe("/");
		expect(safeNextPath("https://evil.example")).toBe("/");
		expect(safeNextPath("//evil.example")).toBe("/");
		expect(safeNextPath("/\\evil.example")).toBe("/");
	});

	test("never loops back to the setup page", () => {
		expect(safeNextPath("/security-setup")).toBe("/");
	});
});

describe("passkeyRpId", () => {
	test("uses the configured origin's hostname, without port", () => {
		expect(passkeyRpId("https://homerun.example.com")).toBe(
			"homerun.example.com",
		);
		expect(passkeyRpId("http://localhost:5173")).toBe("localhost");
	});

	test("leaves it to better-auth when no valid origin is configured", () => {
		expect(passkeyRpId(undefined)).toBeUndefined();
		expect(passkeyRpId("not a url")).toBeUndefined();
	});
});

describe("totpSecretFromUri", () => {
	test("extracts the base32 secret for manual entry", () => {
		expect(
			totpSecretFromUri(
				"otpauth://totp/Homerun:me%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Homerun",
			),
		).toBe("JBSWY3DPEHPK3PXP");
	});

	test("returns null for a malformed URI", () => {
		expect(totpSecretFromUri("nope")).toBeNull();
	});
});

describe("passkeyUsableOn", () => {
	test("ignores the port, passkeys are scoped to the hostname", () => {
		expect(passkeyUsableOn("http://localhost:5173", "http://localhost")).toBe(
			true,
		);
	});

	test("falls back to localhost with no configured origin", () => {
		expect(passkeyUsableOn("http://localhost:5173", null)).toBe(true);
		expect(passkeyUsableOn("http://203.0.113.4:3000", null)).toBe(false);
	});

	test("allows a subdomain of the configured host, not another host", () => {
		expect(
			passkeyUsableOn(
				"https://dash.homerun.example.com",
				"https://homerun.example.com",
			),
		).toBe(true);
		expect(
			passkeyUsableOn("http://203.0.113.4:3000", "https://homerun.example.com"),
		).toBe(false);
	});
});

describe("nextPasskeyRpId", () => {
	test("prefers an explicit Dashboard URL", () => {
		expect(
			nextPasskeyRpId("example.com", "https://homerun.example.com:8443"),
		).toBe("homerun.example.com");
	});

	test("derives the hostname from the base domain otherwise", () => {
		expect(nextPasskeyRpId("Example.com:5173", "")).toBe("example.com");
		expect(nextPasskeyRpId("https://example.com/path", "")).toBe("example.com");
	});

	test("is undefined when nothing yields a hostname", () => {
		expect(nextPasskeyRpId("", "")).toBeUndefined();
	});
});

describe("strandedPasskeyCount", () => {
	test("strands every passkey when the hostname moves", () => {
		expect(strandedPasskeyCount("old.example.com", "new.example.com", 3)).toBe(
			3,
		);
		expect(strandedPasskeyCount(undefined, "example.com", 2)).toBe(2);
	});

	test("strands nothing when the hostname stays or is unknown", () => {
		expect(strandedPasskeyCount("example.com", "example.com", 3)).toBe(0);
		expect(strandedPasskeyCount(undefined, "localhost", 3)).toBe(0);
		expect(strandedPasskeyCount("example.com", undefined, 3)).toBe(0);
	});
});
