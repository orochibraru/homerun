import { describe, expect, test } from "bun:test";
import { nativeFetch } from "./support/config";
import { integrationContext } from "./support/context";

// The heavy setup (fresh Postgres container, real built app, real agent,
// real socat proxy) lives once, globally, in setup.ts's own beforeAll/
// afterAll (bun:test's native run-wide-fixture mechanism, registered via
// bunfig.toml's preload — see that file's docstring) : every test file
// benefits from it automatically, no per-file beforeAll/afterAll needed
// here.
describe("auth", () => {
	test("sign-up is closed once an admin exists (bootstrap already ran)", async () => {
		const res = await nativeFetch(
			`${integrationContext().origin}/api/v1/auth/sign-up/email`,
			{
				body: JSON.stringify({
					email: "second-admin@integration.test",
					name: "Should Be Rejected",
					password: "another-test-password-1234",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			},
		);
		expect(res.status).toBe(403);
	});

	test("a bad api key is rejected cleanly, not a crash", async () => {
		const res = await nativeFetch(
			`${integrationContext().origin}/api/v1/services`,
			{
				headers: { "x-api-key": "not-a-real-key" },
			},
		);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error?: string };
		expect(body.error).toBeTruthy();
	});
});

describe("openapi.json", () => {
	test("is public and a real, parseable OpenAPI 3.1 document", async () => {
		const res = await nativeFetch(
			`${integrationContext().origin}/api/v1/openapi.json`,
		);
		expect(res.status).toBe(200);
		const doc = (await res.json()) as { openapi?: string; paths?: object };
		expect(doc.openapi).toBe("3.1.0");
		expect(Object.keys(doc.paths ?? {}).length).toBeGreaterThan(0);
	});
});
