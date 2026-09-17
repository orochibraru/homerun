import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { config } = await import("../../../src/lib/config");
const { dashboardOrigin } = await import(
	"../../../src/lib/server/canonical-origin"
);
const { isInviteLive } = await import("../../../src/lib/dto/invitation-dto");
const { updateServiceApiBody } = await import(
	"../../../src/lib/server/validation/api"
);
const { serviceResponse } = await import("../../../src/lib/openapi/schemas");

const originalOrigin = config.auth.origin;

afterEach(() => {
	config.auth.origin = originalOrigin;
});

describe("dashboardOrigin", () => {
	const request = new Request("http://127.0.0.1:3000/status-pages/1", {
		headers: { host: "127.0.0.1:3000" },
	});
	const url = new URL(request.url);

	test("uses the configured Dashboard URL, not the base domain", () => {
		config.auth.origin = "https://homerun.example.com/";
		expect(dashboardOrigin(request, url)).toBe("https://homerun.example.com");
	});

	test("falls back to the origin the browser used", () => {
		config.auth.origin = undefined;
		expect(dashboardOrigin(request, url)).toBe("http://127.0.0.1:3000");
		config.auth.origin = "not a url";
		expect(dashboardOrigin(request, url)).toBe("http://127.0.0.1:3000");
	});
});

describe("isInviteLive", () => {
	const now = new Date("2026-09-16T12:00:00Z");
	const later = new Date("2026-09-17T12:00:00Z");
	const earlier = new Date("2026-09-15T12:00:00Z");

	test("an unaccepted, unexpired invite is live", () => {
		expect(isInviteLive({ acceptedAt: null, expiresAt: later }, now)).toBe(
			true,
		);
	});

	test("an expired or accepted invite isn't", () => {
		expect(isInviteLive({ acceptedAt: null, expiresAt: earlier }, now)).toBe(
			false,
		);
		expect(isInviteLive({ acceptedAt: earlier, expiresAt: later }, now)).toBe(
			false,
		);
	});
});

describe("uptimeEnabled over the REST API", () => {
	test("PATCH accepts it", () => {
		expect(updateServiceApiBody.parse({ uptimeEnabled: false })).toEqual({
			uptimeEnabled: false,
		});
		expect(
			updateServiceApiBody.safeParse({ uptimeEnabled: "no" }).success,
		).toBe(false);
	});

	test("the response schema documents it", () => {
		expect(Object.keys(serviceResponse.shape)).toContain("uptimeEnabled");
	});
});
