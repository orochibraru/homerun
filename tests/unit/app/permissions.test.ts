import { describe, expect, test } from "bun:test";
import { parse } from "devalue";
import {
	APP_ONLY_HOME,
	APP_ONLY_MESSAGE,
	apiKeyScopeOf,
	appOnlyMayRequest,
	isAppOnly,
	isReadOnly,
	isUserRole,
	READ_ONLY_MESSAGE,
	readOnlyMayRequest,
	roleLabel,
} from "../../../src/lib/permissions";
import {
	appOnlyRejection,
	readOnlyRejection,
} from "../../../src/lib/server/read-only";

function request(method: string, headers: Record<string, string> = {}) {
	return { headers: new Headers(headers), method };
}

describe("roles", () => {
	test("knows the four roles and labels them", () => {
		expect(isUserRole("admin")).toBe(true);
		expect(isUserRole("developer")).toBe(true);
		expect(isUserRole("viewer")).toBe(true);
		expect(isUserRole("app-user")).toBe(true);
		expect(roleLabel("app-user")).toBe("App access only");
		expect(isUserRole("user")).toBe(false);
		expect(isUserRole(null)).toBe(false);
		expect(roleLabel("viewer")).toBe("Read-only");
		expect(roleLabel(null)).toBe("Developer");
	});
});

describe("apiKeyScopeOf", () => {
	test("reads a read scope from object or JSON metadata", () => {
		expect(apiKeyScopeOf({ scope: "read" })).toBe("read");
		expect(apiKeyScopeOf('{"scope":"read"}')).toBe("read");
	});

	test("treats a key with no or unknown scope as full access", () => {
		expect(apiKeyScopeOf(null)).toBe("full");
		expect(apiKeyScopeOf({})).toBe("full");
		expect(apiKeyScopeOf("not json")).toBe("full");
		expect(apiKeyScopeOf({ scope: "admin" })).toBe("full");
	});
});

describe("isReadOnly", () => {
	test("is read-only for the viewer role or a read-scoped key", () => {
		expect(isReadOnly("viewer", null)).toBe(true);
		expect(isReadOnly("admin", "read")).toBe(true);
		expect(isReadOnly("developer", "full")).toBe(false);
		expect(isReadOnly("admin", null)).toBe(false);
	});
});

describe("readOnlyMayRequest", () => {
	test("allows every safe method anywhere", () => {
		expect(readOnlyMayRequest("GET", "/api/v1/services")).toBe(true);
		expect(readOnlyMayRequest("HEAD", "/services/abc")).toBe(true);
	});

	test("refuses writes to shared resources", () => {
		expect(readOnlyMayRequest("POST", "/api/v1/services")).toBe(false);
		expect(readOnlyMayRequest("DELETE", "/api/v1/services/abc")).toBe(false);
		expect(readOnlyMayRequest("POST", "/services/abc/settings")).toBe(false);
		expect(readOnlyMayRequest("POST", "/services/abc/terminal/open")).toBe(
			false,
		);
	});

	test("allows self-service account surfaces", () => {
		expect(readOnlyMayRequest("POST", "/api/v1/auth/sign-out")).toBe(true);
		expect(readOnlyMayRequest("DELETE", "/api/v1/auth-token")).toBe(true);
		expect(readOnlyMayRequest("POST", "/profile/clients")).toBe(true);
		expect(readOnlyMayRequest("POST", "/cli-auth")).toBe(true);
	});

	test("allows only the notification bell's remote commands", () => {
		expect(
			readOnlyMayRequest("POST", "/_app/remote/abc123/markNotificationRead"),
		).toBe(true);
		expect(
			readOnlyMayRequest("POST", "/_app/remote/abc123/startSelfUpdate"),
		).toBe(false);
	});
});

describe("readOnlyRejection", () => {
	test("returns null for an allowed request", () => {
		expect(readOnlyRejection(request("GET"), "/api/v1/services")).toBeNull();
	});

	test("answers a use:enhance form with an ActionResult failure", async () => {
		const response = readOnlyRejection(
			request("POST", { "x-sveltekit-action": "true" }),
			"/services/abc",
		);
		const body = (await response?.json()) as {
			data: string;
			status: number;
			type: string;
		};
		expect(body.type).toBe("failure");
		expect(body.status).toBe(403);
		expect(parse(body.data)).toEqual({ error: READ_ONLY_MESSAGE });
	});

	test("answers the REST API with a JSON 403", async () => {
		const response = readOnlyRejection(
			request("POST"),
			"/api/v1/services/abc/deploy",
		);
		expect(response?.status).toBe(403);
		expect(await response?.json()).toEqual({ error: READ_ONLY_MESSAGE });
	});

	test("answers a remote command with a remote-function error", async () => {
		const response = readOnlyRejection(
			request("POST"),
			"/_app/remote/abc123/startSelfUpdate",
		);
		expect(response?.status).toBe(403);
		const body = (await response?.json()) as { type: string };
		expect(body.type).toBe("error");
	});
});

describe("isAppOnly", () => {
	test("is true only for the app-access-only role", () => {
		expect(isAppOnly("app-user")).toBe(true);
		expect(isAppOnly("viewer")).toBe(false);
		expect(isAppOnly("admin")).toBe(false);
		expect(isAppOnly(null)).toBe(false);
	});
});

describe("appOnlyMayRequest", () => {
	test("refuses every dashboard page, reads included", () => {
		expect(appOnlyMayRequest("/", "/(protected)")).toBe(false);
		expect(
			appOnlyMayRequest("/services/abc", "/(protected)/services/[serviceId]"),
		).toBe(false);
		expect(
			appOnlyMayRequest("/profile/clients", "/(protected)/profile/clients"),
		).toBe(false);
		expect(appOnlyMayRequest("/cli-auth", "/(protected)/cli-auth")).toBe(false);
		expect(appOnlyMayRequest("/onboarding", "/onboarding")).toBe(false);
	});

	test("allows the sign-in, login wall, security setup and apps pages", () => {
		expect(appOnlyMayRequest("/auth/sign-in", "/auth/sign-in")).toBe(true);
		expect(appOnlyMayRequest("/auth/consent", "/auth/consent")).toBe(true);
		expect(appOnlyMayRequest("/app-auth", "/app-auth")).toBe(true);
		expect(appOnlyMayRequest("/security-setup", "/security-setup")).toBe(true);
		expect(appOnlyMayRequest("/my-apps", "/my-apps")).toBe(true);
		expect(appOnlyMayRequest("/nowhere", null)).toBe(true);
	});

	test("refuses the REST API and MCP but keeps their own account endpoints", () => {
		expect(appOnlyMayRequest("/api/v1/services", null)).toBe(false);
		expect(appOnlyMayRequest("/api/v1/mcp", null)).toBe(false);
		expect(appOnlyMayRequest("/api/v1/auth-token", null)).toBe(false);
		expect(appOnlyMayRequest("/api/v1/auth/sign-out", null)).toBe(true);
		expect(appOnlyMayRequest("/api/v1/auth/passkey/add-passkey", null)).toBe(
			true,
		);
		expect(appOnlyMayRequest("/api/v1/auth/oauth2/authorize", null)).toBe(true);
		expect(appOnlyMayRequest("/api/v1/ready", null)).toBe(true);
	});

	test("refuses API keys, the admin plugin and CLI login", () => {
		expect(appOnlyMayRequest("/api/v1/auth/api-key/create", null)).toBe(false);
		expect(appOnlyMayRequest("/api/v1/auth/admin/set-role", null)).toBe(false);
		expect(appOnlyMayRequest("/api/v1/auth/cli/device", null)).toBe(false);
	});

	test("allows only the sign-in page's remote commands", () => {
		expect(appOnlyMayRequest("/_app/remote/abc/lookupSignIn", null)).toBe(true);
		expect(
			appOnlyMayRequest("/_app/remote/abc/markNotificationRead", null),
		).toBe(false);
		expect(appOnlyMayRequest("/_app/remote/abc/getSystemStats", null)).toBe(
			false,
		);
	});
});

describe("appOnlyRejection", () => {
	test("returns null for an allowed request", () => {
		expect(
			appOnlyRejection(request("GET"), "/my-apps", "/my-apps", false),
		).toBeNull();
	});

	test("sends a dashboard page load to the apps page", () => {
		const response = appOnlyRejection(
			request("GET"),
			"/services",
			"/(protected)/services",
			false,
		);
		expect(response?.status).toBe(303);
		expect(response?.headers.get("location")).toBe(APP_ONLY_HOME);
	});

	test("answers a client-side navigation with SvelteKit's JSON redirect", async () => {
		const response = appOnlyRejection(
			request("GET"),
			"/",
			"/(protected)",
			true,
		);
		expect(await response?.json()).toEqual({
			location: APP_ONLY_HOME,
			type: "redirect",
		});
	});

	test("refuses a form action, the REST API and remote functions with a 403", async () => {
		const action = appOnlyRejection(
			request("POST", { "x-sveltekit-action": "true" }),
			"/users",
			"/(protected)/users",
			false,
		);
		const body = (await action?.json()) as { data: string; status: number };
		expect(body.status).toBe(403);
		expect(parse(body.data)).toEqual({ error: APP_ONLY_MESSAGE });

		const api = appOnlyRejection(
			request("GET"),
			"/api/v1/services",
			null,
			false,
		);
		expect(api?.status).toBe(403);
		expect(await api?.json()).toEqual({ error: APP_ONLY_MESSAGE });

		const remote = appOnlyRejection(
			request("GET"),
			"/_app/remote/abc/getSystemStats",
			null,
			false,
		);
		expect(remote?.status).toBe(403);
	});

	test("refuses a plain write to a dashboard page with text", async () => {
		const response = appOnlyRejection(
			request("POST"),
			"/services",
			"/(protected)/services",
			false,
		);
		expect(response?.status).toBe(403);
		expect(await response?.text()).toBe(APP_ONLY_MESSAGE);
	});
});
