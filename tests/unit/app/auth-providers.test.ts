import { describe, expect, test } from "bun:test";
import {
	accountProviderIdFor,
	emailMatchesPattern,
	isOauthMethod,
	methodForAccountProviderId,
	OAUTH_PRESETS,
	oauthMethod,
	oauthProviderName,
	PASSWORD_METHOD,
} from "../../../src/lib/auth-providers";

describe("method encoding", () => {
	test("round-trips an oauth provider name", () => {
		const method = oauthMethod("keycloak");
		expect(method).toBe("oauth:keycloak");
		expect(isOauthMethod(method)).toBe(true);
		expect(oauthProviderName(method)).toBe("keycloak");
	});

	test("the password method is not an oauth method", () => {
		expect(isOauthMethod(PASSWORD_METHOD)).toBe(false);
		expect(oauthProviderName(PASSWORD_METHOD)).toBeNull();
	});

	test("a provider name containing a colon survives the round trip", () => {
		expect(oauthProviderName(oauthMethod("a:b"))).toBe("a:b");
	});

	test("maps to and from better-auth's account.providerId", () => {
		expect(accountProviderIdFor(PASSWORD_METHOD)).toBe("credential");
		expect(accountProviderIdFor(oauthMethod("authelia"))).toBe("authelia");
		expect(methodForAccountProviderId("credential")).toBe(PASSWORD_METHOD);
		expect(methodForAccountProviderId("authelia")).toBe("oauth:authelia");
	});
});

describe("email patterns", () => {
	test("matches an exact address regardless of case and padding", () => {
		expect(emailMatchesPattern("Ada@Example.com", " ada@example.com ")).toBe(
			true,
		);
	});

	test("matches a domain wildcard but not a different domain", () => {
		expect(emailMatchesPattern("ada@example.com", "*@example.com")).toBe(true);
		expect(emailMatchesPattern("ada@other.com", "*@example.com")).toBe(false);
	});

	test("a wildcard doesn't match a lookalike suffix domain", () => {
		expect(emailMatchesPattern("ada@notexample.com", "*@example.com")).toBe(
			false,
		);
	});

	test("empty input never matches", () => {
		expect(emailMatchesPattern("", "*@example.com")).toBe(false);
		expect(emailMatchesPattern("ada@example.com", "")).toBe(false);
	});
});

describe("presets", () => {
	test("every preset has a unique id and a discovery template", () => {
		const ids = OAUTH_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const preset of OAUTH_PRESETS) {
			expect(preset.template).toContain("/.well-known/openid-configuration");
			expect(preset.scopes).toContain("openid");
		}
	});

	test("covers every provider the feature promised", () => {
		const ids = [...OAUTH_PRESETS.map((p) => p.id)].sort((a, b) =>
			a.localeCompare(b),
		);
		expect(ids).toEqual([
			"authelia",
			"authentik",
			"kanidm",
			"keycloak",
			"logto",
			"pocket-id",
			"zitadel",
		]);
	});
});
