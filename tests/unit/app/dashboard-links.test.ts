import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { config } = await import("../../../src/lib/config");
const { withDashboardOrigin } = await import(
	"../../../src/lib/server/canonical-origin"
);

const originalOrigin = config.auth.origin;

afterEach(() => {
	config.auth.origin = originalOrigin;
});

describe("withDashboardOrigin", () => {
	const mailed =
		"http://203.0.113.10:3000/api/v1/auth/verify-email?token=abc&callbackURL=%2F#top";

	test("moves a link built on the installer's IP onto the Dashboard URL", () => {
		config.auth.origin = "https://homerun.example.com/";
		expect(withDashboardOrigin(mailed)).toBe(
			"https://homerun.example.com/api/v1/auth/verify-email?token=abc&callbackURL=%2F#top",
		);
	});

	test("leaves the link alone without a Dashboard URL", () => {
		config.auth.origin = undefined;
		expect(withDashboardOrigin(mailed)).toBe(mailed);
	});

	test("leaves a relative link alone", () => {
		config.auth.origin = "https://homerun.example.com";
		expect(withDashboardOrigin("/auth/sign-in")).toBe("/auth/sign-in");
	});
});
