import { describe, expect, test } from "bun:test";
import { isForbiddenCrossSiteForm } from "../../../src/lib/server/csrf";

const url = new URL("https://homerun.example.com/settings?/save");
const tokenUrl = new URL(
	"https://homerun.example.com/api/v1/auth/oauth2/token",
);
const exempt = (pathname: string) => pathname.includes("/oauth2/");

function request(
	headers: Record<string, string>,
	method = "POST",
): Pick<Request, "headers" | "method"> {
	return { headers: new Headers(headers), method };
}

describe("isForbiddenCrossSiteForm", () => {
	test("refuses a form post from another origin or with no origin", () => {
		expect(
			isForbiddenCrossSiteForm(
				request({
					"content-type": "application/x-www-form-urlencoded",
					origin: "https://evil.example.com",
				}),
				url,
				exempt,
			),
		).toBe(true);
		expect(
			isForbiddenCrossSiteForm(
				request({ "content-type": "multipart/form-data; boundary=x" }),
				url,
				exempt,
			),
		).toBe(true);
	});

	test("lets same-origin forms, JSON and reads through", () => {
		expect(
			isForbiddenCrossSiteForm(
				request({
					"content-type": "application/x-www-form-urlencoded",
					origin: "https://homerun.example.com",
				}),
				url,
				exempt,
			),
		).toBe(false);
		expect(
			isForbiddenCrossSiteForm(
				request({ "content-type": "application/json" }),
				url,
				exempt,
			),
		).toBe(false);
		expect(
			isForbiddenCrossSiteForm(
				request({ "content-type": "text/plain" }, "GET"),
				url,
				exempt,
			),
		).toBe(false);
	});

	test("accepts a form posted to the address the browser used, even when ORIGIN names a domain", () => {
		expect(
			isForbiddenCrossSiteForm(
				request({
					"content-type": "application/x-www-form-urlencoded",
					host: "203.0.113.4:3000",
					origin: "http://203.0.113.4:3000",
				}),
				url,
				exempt,
			),
		).toBe(false);
		expect(
			isForbiddenCrossSiteForm(
				request({
					"content-type": "application/x-www-form-urlencoded",
					host: "203.0.113.4:3000",
					origin: "http://evil.example.com",
				}),
				url,
				exempt,
			),
		).toBe(true);
	});

	test("skips exempt paths such as the OAuth token endpoint", () => {
		expect(
			isForbiddenCrossSiteForm(
				request({ "content-type": "application/x-www-form-urlencoded" }),
				tokenUrl,
				exempt,
			),
		).toBe(false);
	});
});
