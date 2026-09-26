import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { loginWallDrifted } = await import(
	"../../../src/lib/services/docker/labels"
);

const CHECK = "http://homerun-auth:3000/api/v1/auth-check?service=s1";
const auth = (address: string) => ({
	"traefik.http.middlewares.web-auth.forwardauth.address": address,
	"traefik.http.routers.web.middlewares": "web-auth,web-retry",
});
const ungated = {
	"traefik.http.routers.web.middlewares": "web-retry",
};

describe("loginWallDrifted", () => {
	test("an ungated service still carrying a forwardAuth drifted", () => {
		expect(loginWallDrifted(auth(CHECK), null)).toBe(true);
		expect(loginWallDrifted(ungated, null)).toBe(false);
	});

	test("a gated service pointing at an old check URL drifted", () => {
		expect(
			loginWallDrifted(
				auth("http://homerun-app-1:3000/api/v1/auth-check?service=s1"),
				CHECK,
			),
		).toBe(true);
		expect(loginWallDrifted(auth(CHECK), CHECK)).toBe(false);
	});

	test("a gated service with no forwardAuth at all drifted", () => {
		expect(loginWallDrifted(ungated, CHECK)).toBe(true);
	});
});
