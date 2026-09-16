import { describe, expect, test } from "bun:test";
import {
	safeRedirectTarget,
	signInUrlFor,
} from "../../../src/lib/redirect-target";

describe("safeRedirectTarget", () => {
	test("keeps a same-origin path with its query and hash", () => {
		expect(safeRedirectTarget("/app-auth?rd=abc.def#x")).toBe(
			"/app-auth?rd=abc.def#x",
		);
	});

	test.each([
		null,
		"",
		"https://evil.example.com",
		"//evil.example.com/path",
		"/\\evil.example.com",
		"javascript:alert(1)",
		"relative/path",
	])("refuses %p", (candidate) => {
		expect(safeRedirectTarget(candidate)).toBeNull();
	});
});

describe("signInUrlFor", () => {
	test("round-trips a target through the redirectTo param", () => {
		const url = signInUrlFor("/auth/sign-in", "/app-auth?rd=a&b=c");
		const parsed = new URL(url, "http://localhost");
		expect(parsed.pathname).toBe("/auth/sign-in");
		expect(safeRedirectTarget(parsed.searchParams.get("redirectTo"))).toBe(
			"/app-auth?rd=a&b=c",
		);
	});
});
