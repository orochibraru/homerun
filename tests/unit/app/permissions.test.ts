import { describe, expect, test } from "bun:test";
import { parse } from "devalue";
import {
	apiKeyScopeOf,
	isReadOnly,
	isUserRole,
	READ_ONLY_MESSAGE,
	readOnlyMayRequest,
	roleLabel,
} from "../../../src/lib/permissions";
import { readOnlyRejection } from "../../../src/lib/server/read-only";

function request(method: string, headers: Record<string, string> = {}) {
	return { headers: new Headers(headers), method };
}

describe("roles", () => {
	test("knows the three roles and labels them", () => {
		expect(isUserRole("admin")).toBe(true);
		expect(isUserRole("developer")).toBe(true);
		expect(isUserRole("viewer")).toBe(true);
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
