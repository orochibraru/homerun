import { describe, expect, test } from "bun:test";
import { gateChallengeKind } from "../../../src/lib/server/gate-request";

function headers(values: Record<string, string>): Headers {
	return new Headers(values);
}

describe("gateChallengeKind", () => {
	test("a browser's manifest fetch goes through", () => {
		expect(
			gateChallengeKind(
				headers({ "sec-fetch-dest": "manifest", "sec-fetch-mode": "cors" }),
				"/auth/manifest.webmanifest",
			),
		).toBe("allow");
	});

	test("claiming to fetch a manifest doesn't open any other path", () => {
		expect(
			gateChallengeKind(
				headers({ "sec-fetch-dest": "manifest", "sec-fetch-mode": "cors" }),
				"/admin/secrets",
			),
		).toBe("deny");
	});

	test("a fetch, script or image gets a 401 instead of a login redirect", () => {
		for (const mode of ["cors", "no-cors", "same-origin"]) {
			expect(
				gateChallengeKind(headers({ "sec-fetch-mode": mode }), "/api/data"),
			).toBe("deny");
		}
	});

	test("a page navigation, or a client without Sec-Fetch headers, is sent to sign in", () => {
		expect(
			gateChallengeKind(headers({ "sec-fetch-mode": "navigate" }), "/"),
		).toBe("redirect");
		expect(gateChallengeKind(headers({}), "/")).toBe("redirect");
	});
});
