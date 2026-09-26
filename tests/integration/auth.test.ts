import { describe, expect, test } from "bun:test";
import { nativeFetch } from "./support/config";
import { integrationContext } from "./support/context";
import { startMailSink } from "./support/mail-sink";

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

describe("signing in from the server's own IP", () => {
	function signInFrom(origin: string): Promise<Response> {
		const ctx = integrationContext();
		const port = new URL(ctx.origin).port;
		return nativeFetch(`${ctx.origin}/api/v1/auth/sign-in/email`, {
			body: JSON.stringify({
				email: "admin@integration.test",
				password: "integration-test-password-1234",
			}),
			headers: {
				"content-type": "application/json",
				cookie: "leftover=from-an-earlier-visit",
				host: `203.0.113.7:${port}`,
				origin,
			},
			method: "POST",
		});
	}

	test("works when ORIGIN and the Dashboard URL name a different address", async () => {
		const port = new URL(integrationContext().origin).port;
		const res = await signInFrom(`http://203.0.113.7:${port}`);
		expect(res.status, await res.clone().text()).toBe(200);
	});

	test("still refuses a cross-site origin", async () => {
		const res = await signInFrom("http://evil.example.com");
		expect(res.status).toBe(403);
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

describe("app-access-only accounts", () => {
	const email = "client@integration.test";
	const password = "client-integration-password-1234";

	async function signIn(as: string, secret: string): Promise<string> {
		const { origin } = integrationContext();
		const res = await nativeFetch(`${origin}/api/v1/auth/sign-in/email`, {
			body: JSON.stringify({ email: as, password: secret }),
			headers: { "content-type": "application/json", origin },
			method: "POST",
		});
		expect(res.status, await res.clone().text()).toBe(200);
		return res.headers
			.getSetCookie()
			.map((cookie) => cookie.split(";")[0])
			.join("; ");
	}

	test("sign in, reach only their apps page, and are refused the dashboard, API and API keys", async () => {
		const { origin } = integrationContext();
		const adminCookie = await signIn(
			"admin@integration.test",
			"integration-test-password-1234",
		);
		const created = await nativeFetch(
			`${origin}/api/v1/auth/admin/create-user`,
			{
				body: JSON.stringify({
					email,
					name: "Client",
					password,
					role: "app-user",
				}),
				headers: {
					"content-type": "application/json",
					cookie: adminCookie,
					origin,
				},
				method: "POST",
			},
		);
		expect(created.status, await created.clone().text()).toBe(200);

		const cookie = await signIn(email, password);
		const get = (path: string) =>
			nativeFetch(`${origin}${path}`, {
				headers: { cookie },
				redirect: "manual",
			});

		const dashboard = await get("/services");
		expect(dashboard.status).toBe(303);
		expect(dashboard.headers.get("location")).toBe("/my-apps");
		expect((await get("/my-apps")).status).toBe(200);
		expect((await get("/api/v1/services")).status).toBe(403);
		expect((await get("/api/v1/auth/get-session")).status).toBe(200);

		const key = await nativeFetch(`${origin}/api/v1/auth/api-key/create`, {
			body: JSON.stringify({ name: "sneaky" }),
			headers: { "content-type": "application/json", cookie, origin },
			method: "POST",
		});
		expect(key.status).toBe(403);
	});
});

describe("emailed sign-in codes", () => {
	const email = "code-client@integration.test";

	function cookiesOf(res: Response): string {
		return res.headers
			.getSetCookie()
			.map((cookie) => cookie.split(";")[0])
			.join("; ");
	}

	function post(path: string, body: unknown, cookie = ""): Promise<Response> {
		const { origin } = integrationContext();
		return nativeFetch(`${origin}${path}`, {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json", cookie, origin },
			method: "POST",
		});
	}

	function saveSmtp(cookie: string, port: number | null): Promise<Response> {
		const { origin } = integrationContext();
		const form = new URLSearchParams(
			port === null
				? {}
				: {
						smtpEnabled: "on",
						smtpFrom: "homerun@integration.test",
						smtpHost: "127.0.0.1",
						smtpPassword: "sink-password",
						smtpPort: String(port),
						smtpUser: "sink",
					},
		);
		return nativeFetch(`${origin}/settings/email?/updateSmtp`, {
			body: form,
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				cookie,
				origin,
				"x-sveltekit-action": "true",
			},
			method: "POST",
		});
	}

	test("an account with no password signs in with a code, strangers get no mail", async () => {
		const sink = startMailSink();
		const admin = await post("/api/v1/auth/sign-in/email", {
			email: "admin@integration.test",
			password: "integration-test-password-1234",
		});
		const adminCookie = cookiesOf(admin);
		try {
			const refused = await post(
				"/api/v1/auth/email-otp/send-verification-otp",
				{
					email,
					type: "sign-in",
				},
			);
			expect(refused.status).toBe(403);

			expect((await saveSmtp(adminCookie, sink.port)).status).toBe(200);
			const created = await post(
				"/api/v1/auth/admin/create-user",
				{ email, name: "Code Client", role: "app-user" },
				adminCookie,
			);
			expect(created.status, await created.clone().text()).toBe(200);

			const stranger = await post(
				"/api/v1/auth/email-otp/send-verification-otp",
				{ email: "stranger@integration.test", type: "sign-in" },
			);
			expect(stranger.status).toBe(200);
			const sent = await post("/api/v1/auth/email-otp/send-verification-otp", {
				email,
				type: "sign-in",
			});
			expect(sent.status, await sent.clone().text()).toBe(200);
			expect(sink.messages.map((mail) => mail.to)).toEqual([[email]]);
			const code = /code is:\s+(\d{6})/.exec(sink.messages[0].data)?.[1];
			expect(code).toMatch(/^\d{6}$/);

			const wrong = await post("/api/v1/auth/sign-in/email-otp", {
				email,
				otp: code === "000000" ? "111111" : "000000",
			});
			expect(wrong.status).toBe(400);
			const signedIn = await post("/api/v1/auth/sign-in/email-otp", {
				email,
				otp: code,
			});
			expect(signedIn.status, await signedIn.clone().text()).toBe(200);

			const { origin } = integrationContext();
			const home = await nativeFetch(`${origin}/services`, {
				headers: { cookie: cookiesOf(signedIn) },
				redirect: "manual",
			});
			expect(home.headers.get("location")).toBe("/my-apps");
		} finally {
			await saveSmtp(adminCookie, null);
			sink.stop();
		}
	});
});
