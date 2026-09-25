import { describe, expect, test } from "bun:test";
import {
	mcpAllowed,
	mcpResource,
	oidcClaimsFor,
	oidcDiscoveryUrl,
	oidcIssuer,
	parseRedirectUris,
	rebaseOnOrigin,
} from "../../../src/lib/oidc-provider";

const ada = {
	email: "ada@example.com",
	emailVerified: true,
	image: "https://example.com/ada.png",
	name: "Ada Lovelace",
	role: "admin",
};

describe("mcpAllowed", () => {
	test("HTTPS or loopback HTTP only, never a LAN IP over HTTP", () => {
		expect(mcpAllowed("https://homerun.example.com")).toBe(true);
		expect(mcpAllowed("http://localhost:5173")).toBe(true);
		expect(mcpAllowed("http://127.0.0.1:3000")).toBe(true);
		expect(mcpAllowed("http://[::1]:3000")).toBe(true);
		expect(mcpAllowed("http://app.localhost")).toBe(true);
		expect(mcpAllowed("http://192.168.1.20:3000")).toBe(false);
		expect(mcpAllowed("http://homerun.example.com")).toBe(false);
		expect(mcpAllowed("not a url")).toBe(false);
	});
});

describe("mcpResource", () => {
	test("is the MCP endpoint's URL, ignoring a trailing slash", () => {
		expect(mcpResource("https://homerun.example.com/")).toBe(
			"https://homerun.example.com/api/v1/mcp",
		);
	});
});

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

describe("rebaseOnOrigin", () => {
	test("moves a request pinned to the installer's IP onto the dashboard's origin", async () => {
		const request = new Request(
			"http://203.0.113.10:3000/api/v1/auth/oauth2/token?x=1",
			{
				body: "grant_type=authorization_code",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				method: "POST",
			},
		);
		const rebased = rebaseOnOrigin(request, "https://homerun.example.com");
		expect(rebased.url).toBe(
			"https://homerun.example.com/api/v1/auth/oauth2/token?x=1",
		);
		expect(rebased.method).toBe("POST");
		expect(rebased.headers.get("content-type")).toBe(
			"application/x-www-form-urlencoded",
		);
		expect(await rebased.text()).toBe("grant_type=authorization_code");
	});

	test("returns the same request when it's already on that origin", () => {
		const request = new Request("https://homerun.example.com/api/v1/auth/jwks");
		expect(rebaseOnOrigin(request, "https://homerun.example.com/")).toBe(
			request,
		);
	});
});
