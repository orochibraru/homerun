import { describe, expect, test } from "bun:test";
import { resolveAdvertisedTokenAuth } from "../../../src/lib/auth-providers";

describe("resolveAdvertisedTokenAuth", () => {
	test("prefers Basic when the provider offers it, per OIDC's default", () => {
		expect(
			resolveAdvertisedTokenAuth([
				"client_secret_basic",
				"client_secret_post",
				"none",
			]),
		).toBe("basic");
	});

	test("falls back to post when Basic isn't offered", () => {
		expect(resolveAdvertisedTokenAuth(["client_secret_post"])).toBe("post");
		expect(resolveAdvertisedTokenAuth(["client_secret_post", "none"])).toBe(
			"post",
		);
	});

	test("returns null when neither secret method is offered", () => {
		expect(resolveAdvertisedTokenAuth([])).toBeNull();
		expect(resolveAdvertisedTokenAuth(["none"])).toBeNull();
		expect(resolveAdvertisedTokenAuth(["private_key_jwt"])).toBeNull();
	});
});
