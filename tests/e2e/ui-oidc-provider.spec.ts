import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E_BASE_URL } from "./support/config";

const AUTH_BASE = `${E2E_BASE_URL}/api/v1/auth`;
const CALLBACK = "https://e2e-app.homerun.test/callback";

interface RegisteredApp {
	clientId: string;
	clientSecret: string;
}

async function signIn(page: Page) {
	await page.locator("#email").fill("ada@example.com");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
}

async function registerApp(
	browser: Browser,
	name: string,
	skipConsent: boolean,
): Promise<RegisteredApp> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto("/auth/sign-in");
	await signIn(page);
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);

	await page.goto("/authentication/apps/new");
	await page.locator("#name").fill(name);
	await page.locator("#redirectUris").fill(CALLBACK);
	if (!skipConsent) {
		await page.getByText("Skip the consent screen").click();
	}
	await page.getByRole("button", { name: "Register app" }).click();
	await expect(
		page.getByRole("heading", { name: `${name} is registered` }),
	).toBeVisible();

	const codes = page.locator("code");
	const app = {
		clientId: (await codes.nth(0).textContent())?.trim() ?? "",
		clientSecret: (await codes.nth(1).textContent())?.trim() ?? "",
	};
	await context.close();
	return app;
}

function authorizeUrl(clientId: string, state: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: CALLBACK,
		response_type: "code",
		scope: "openid profile email groups",
		state,
	});
	return `${AUTH_BASE}/oauth2/authorize?${params}`;
}

async function captureCallback(page: Page): Promise<URL> {
	const callback = new Promise<URL>((resolveCallback) => {
		void page.route(`${CALLBACK}**`, (route) => {
			resolveCallback(new URL(route.request().url()));
			void route.fulfill({ body: "signed in", status: 200 });
		});
	});
	return await callback;
}

test.describe
	.serial("Homerun as an OpenID Connect provider", () => {
		let trusted: RegisteredApp;
		let issuer = "";
		let trustedAccessToken = "";

		test("the discovery document advertises Homerun as the issuer", async ({
			request,
		}) => {
			const res = await request.get(
				`${AUTH_BASE}/.well-known/openid-configuration`,
			);
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(body.issuer).toMatch(/^https?:\/\/[^/]+\/api\/v1\/auth$/);
			expect(body.authorization_endpoint).toMatch(
				/\/api\/v1\/auth\/oauth2\/authorize$/,
			);
			issuer = body.issuer;
			expect(body.scopes_supported).toContain("groups");
		});

		test("cross-site form posts are still refused, except to the token endpoint", async ({
			request,
		}) => {
			const page = await request.post("/authentication?/securityPolicy", {
				form: { requireTwoFactor: "on" },
				headers: { origin: "https://evil.example.com" },
			});
			expect(page.status()).toBe(403);

			const token = await request.post(`${AUTH_BASE}/oauth2/token`, {
				form: { code: "nope", grant_type: "authorization_code" },
			});
			expect(token.status()).not.toBe(403);
		});

		test("an admin registers an app and gets its credentials once", async ({
			browser,
		}) => {
			trusted = await registerApp(browser, "E2E Grafana", true);
			expect(trusted.clientId).not.toBe("");
			expect(trusted.clientSecret).not.toBe("");
		});

		test("a signed-out user signs in on Homerun and the app gets working tokens", async ({
			browser,
			request,
		}) => {
			const context = await browser.newContext();
			const page = await context.newPage();
			const callback = captureCallback(page);

			await page.goto(authorizeUrl(trusted.clientId, "state-123"));
			await expect(page).toHaveURL(/\/auth\/sign-in\?/);
			await expect(
				page.getByRole("heading", { name: "Sign in to E2E Grafana" }),
			).toBeVisible();
			await signIn(page);

			const landed = await callback;
			expect(landed.searchParams.get("state")).toBe("state-123");
			const code = landed.searchParams.get("code");
			expect(code).toBeTruthy();
			await context.close();

			const token = await request.post(`${AUTH_BASE}/oauth2/token`, {
				form: {
					code: code ?? "",
					grant_type: "authorization_code",
					redirect_uri: CALLBACK,
				},
				headers: {
					authorization: `Basic ${Buffer.from(
						`${trusted.clientId}:${trusted.clientSecret}`,
					).toString("base64")}`,
				},
			});
			expect(token.ok(), await token.text()).toBe(true);
			const tokens = await token.json();
			expect(tokens.access_token).toBeTruthy();
			trustedAccessToken = tokens.access_token;

			const [, payload] = String(tokens.id_token).split(".");
			const claims = JSON.parse(
				Buffer.from(payload ?? "", "base64url").toString("utf8"),
			);
			expect(claims.iss).toBe(issuer);
			expect(claims.email).toBe("ada@example.com");
			expect(claims.groups).toEqual(["admin"]);

			const userinfo = await request.get(`${AUTH_BASE}/oauth2/userinfo`, {
				headers: { authorization: `Bearer ${tokens.access_token}` },
			});
			expect(userinfo.ok(), await userinfo.text()).toBe(true);
			const profile = await userinfo.json();
			expect(profile.email).toBe("ada@example.com");
			expect(profile.preferred_username).toBe("ada");
		});

		test("an app that asks for consent shows it, and Allow finishes the sign-in", async ({
			browser,
		}) => {
			const asking = await registerApp(browser, "E2E Outline", false);

			const context = await browser.newContext();
			const page = await context.newPage();
			const callback = captureCallback(page);

			await page.goto(authorizeUrl(asking.clientId, "state-456"));
			await signIn(page);

			await expect(
				page.getByRole("heading", { name: "Allow E2E Outline?" }),
			).toBeVisible();
			await expect(page.getByText("Your email address")).toBeVisible();
			await page.getByRole("button", { name: "Allow" }).click();

			const landed = await callback;
			expect(landed.searchParams.get("state")).toBe("state-456");
			expect(landed.searchParams.get("code")).toBeTruthy();
			await context.close();
		});

		test("the user sees the apps on their profile and revoking one kills its tokens", async ({
			page,
			request,
		}) => {
			await page.goto("/auth/sign-in");
			await signIn(page);
			await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);

			await page.goto("/profile/clients");
			const grafana = page.locator("div.rounded-md.border", {
				hasText: "E2E Grafana",
			});
			await expect(grafana).toBeVisible();
			await expect(
				page.locator("div.rounded-md.border", { hasText: "E2E Outline" }),
			).toBeVisible();

			await grafana.getByRole("button", { name: "Revoke" }).click();
			await page
				.getByRole("button", { exact: true, name: "Revoke" })
				.last()
				.click();
			await expect(page.getByText("App revoked.")).toBeVisible();
			await expect(grafana).toHaveCount(0);

			const userinfo = await request.get(`${AUTH_BASE}/oauth2/userinfo`, {
				headers: { authorization: `Bearer ${trustedAccessToken}` },
			});
			expect(userinfo.ok()).toBe(false);
		});
	});
