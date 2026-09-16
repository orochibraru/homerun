import { describe, expect, test } from "bun:test";
import {
	oidcClaimsFor,
	oidcDiscoveryUrl,
	oidcIssuer,
	parseRedirectUris,
} from "../../../src/lib/oidc-provider";

const ada = {
	email: "ada@example.com",
	emailVerified: true,
	image: "https://example.com/ada.png",
	name: "Ada Lovelace",
	role: "admin",
};

describe("oidcIssuer / oidcDiscoveryUrl", () => {
	test("hang off the auth base path, ignoring a trailing slash", () => {
		expect(oidcIssuer("https://homerun.example.com/")).toBe(
			"https://homerun.example.com/api/v1/auth",
		);
		expect(oidcDiscoveryUrl("https://homerun.example.com")).toBe(
			"https://homerun.example.com/api/v1/auth/.well-known/openid-configuration",
		);
	});
});

describe("oidcClaimsFor", () => {
	test("only emits what the granted scopes cover", () => {
		expect(oidcClaimsFor(ada, ["openid"])).toEqual({});
		expect(oidcClaimsFor(ada, ["openid", "email"])).toEqual({
			email: "ada@example.com",
			email_verified: true,
		});
	});

	test("profile carries the name, a username and the picture", () => {
		expect(oidcClaimsFor(ada, ["profile"])).toEqual({
			name: "Ada Lovelace",
			picture: "https://example.com/ada.png",
			preferred_username: "ada",
		});
	});

	test("groups carries the Homerun role", () => {
		expect(oidcClaimsFor(ada, ["groups"])).toEqual({ groups: ["admin"] });
		expect(oidcClaimsFor({ ...ada, role: null }, ["groups"])).toEqual({
			groups: [],
		});
	});
});

describe("parseRedirectUris", () => {
	test("accepts newlines and commas, trims and de-duplicates", () => {
		expect(
			parseRedirectUris(
				" https://a.example.com/cb \nhttps://b.example.com/cb,https://a.example.com/cb\n\n",
			),
		).toEqual(["https://a.example.com/cb", "https://b.example.com/cb"]);
	});
});
