import { describe, expect, test } from "bun:test";
import {
	GATE_COOKIE_NAME,
	gateCookie,
	readGateCookie,
	signGateToken,
	verifyGateToken,
} from "../../../src/lib/server/app-gate";
import { groupsFromIdToken } from "../../../src/lib/services/app-access.service";

const payload = {
	email: "ada@example.com",
	host: "app.example.com",
	serviceId: "svc-1",
	userId: "user-1",
};

function idTokenWith(claims: Record<string, unknown>): string {
	const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
	return `header.${body}.signature`;
}

describe("gate tokens", () => {
	test("a freshly signed token verifies and round-trips its payload", () => {
		const verified = verifyGateToken(signGateToken(payload, 60_000));
		expect(verified).toMatchObject(payload);
	});

	test("an expired token is rejected", () => {
		expect(verifyGateToken(signGateToken(payload, -1))).toBeNull();
	});

	test("a tampered payload is rejected", () => {
		const token = signGateToken(payload, 60_000);
		const [body, sig] = token.split(".");
		const forged = Buffer.from(
			JSON.stringify({ ...payload, exp: Date.now() + 60_000, userId: "root" }),
		).toString("base64url");
		expect(verifyGateToken(`${forged}.${sig}`)).toBeNull();
		expect(verifyGateToken(`${body}.${sig}x`)).toBeNull();
	});

	test("garbage is rejected rather than throwing", () => {
		expect(verifyGateToken("")).toBeNull();
		expect(verifyGateToken("nodot")).toBeNull();
		expect(verifyGateToken("...")).toBeNull();
	});
});

describe("gate cookie", () => {
	test("reads its own value back out of a crowded Cookie header", () => {
		const header = `other=1; ${GATE_COOKIE_NAME}=abc%3D; another=2`;
		expect(readGateCookie(header)).toBe("abc=");
	});

	test("returns undefined when absent or when there is no header", () => {
		expect(readGateCookie("other=1")).toBeUndefined();
		expect(readGateCookie(null)).toBeUndefined();
	});

	test("never matches a cookie whose name merely ends with ours", () => {
		expect(readGateCookie(`not_${GATE_COOKIE_NAME}=nope`)).toBeUndefined();
	});

	test("only adds Secure over https", () => {
		expect(gateCookie("v", true, 60)).toContain("Secure");
		expect(gateCookie("v", false, 60)).not.toContain("Secure");
		expect(gateCookie("v", false, 60)).toContain("HttpOnly");
	});
});

describe("group claims", () => {
	test("reads a plain groups claim", () => {
		expect([
			...groupsFromIdToken(idTokenWith({ groups: ["admins", "devs"] })),
		]).toEqual(["admins", "devs"]);
	});

	test("reads keycloak realm and resource roles", () => {
		const groups = groupsFromIdToken(
			idTokenWith({
				realm_access: { roles: ["realm-admin"] },
				resource_access: { homerun: { roles: ["app-user"] } },
			}),
		);
		expect(groups.has("realm-admin")).toBe(true);
		expect(groups.has("app-user")).toBe(true);
	});

	test("accepts a single string claim, not just an array", () => {
		expect([...groupsFromIdToken(idTokenWith({ roles: "solo" }))]).toEqual([
			"solo",
		]);
	});

	test("an undecodable token yields no groups instead of throwing", () => {
		expect(groupsFromIdToken("not-a-jwt").size).toBe(0);
		expect(groupsFromIdToken("a.!!!.c").size).toBe(0);
	});
});
