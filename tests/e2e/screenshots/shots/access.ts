import type { Page } from "@playwright/test";
import { expect } from "../../support/test";
import { postAction, type ShotModule } from "./types";

const ADMIN_PASSWORD = "a-real-strong-password-123";
const PROVIDER = "google";

let idpAppPath = "/idp";

/** Adds an enabled Google OAuth provider, validated against Google's real discovery document. */
async function addProvider(page: Page): Promise<void> {
	await postAction(page, "/authentication/new?/create", {
		clientId: "123456789012-homerun.apps.googleusercontent.com",
		clientSecret: "not-a-real-secret",
		discoveryUrl:
			"https://accounts.google.com/.well-known/openid-configuration",
		enabled: "on",
		label: "Google",
		name: PROVIDER,
		pkce: "on",
		scopes: "openid, profile, email",
		tokenAuthMethod: "auto",
	});
}

/** Removes the Google provider again, so the sign-in showcase captured after the feature shots offers no single sign-on. */
async function removeProvider(page: Page): Promise<void> {
	await postAction(page, `/authentication/${PROVIDER}?/delete`, {});
}

/** Turns the login wall on for the never-deployed `api` service through its Security tab, so saving queues no redeploy. */
async function gateApi(page: Page, serviceId: string): Promise<void> {
	await page.goto(`/services/${serviceId}/security`);
	await page
		.getByRole("checkbox", { name: /Require login to access this app/ })
		.click();
	await page.getByRole("checkbox", { name: /Built-in Homerun login/ }).click();
	await page.getByRole("checkbox", { name: /^Google/ }).click();
	await page.getByRole("checkbox", { name: /Cleo Client/ }).click();
	await page.locator("#authAllowedEmails").fill("ops@example.com");
	await page.locator("#authAllowedGroups").fill("admin");
	await page.locator("button[form='login-wall-app']").click();
	await expect(page.getByText("Access rules saved.")).toBeVisible();
}

/** Registers Grafana as a "Sign in with Homerun" app and remembers its page. */
async function registerIdpApp(page: Page): Promise<void> {
	await postAction(page, "/idp/new?/create", {
		clientType: "confidential",
		enableEndSession: "on",
		environmentName: "production",
		name: "Grafana",
		redirectUris: "https://grafana.example.com/login/generic_oauth",
		skipConsent: "on",
		tokenAuthMethod: "client_secret_basic",
	});
	await page.goto("/idp");
	const href = await page
		.locator("a[href^='/idp/']")
		.filter({ hasText: "Grafana" })
		.first()
		.getAttribute("href");
	expect(href, "the registered app's link on /idp").toBeTruthy();
	idpAppPath = href ?? idpAppPath;
}

export const shots: ShotModule = {
	setup: async (page, seeded) => {
		for (const [name, email, role] of [
			["Sam Developer", "sam@example.com", "developer"],
			["Rita Reader", "rita@example.com", "viewer"],
			["Cleo Client", "cleo@example.com", "app-user"],
		] as const) {
			await postAction(page, "/users?/createDirect", { email, name, role });
		}
		await postAction(page, "/profile/api-keys/new?/create", {
			allPermissions: "on",
			expiry: "never",
			name: "Homerun CLI",
		});
		await postAction(page, "/profile/api-keys/new?/create", {
			expiry: "90",
			name: "Grafana dashboard",
			"permission.services": "read",
			"permission.stacks": "read",
		});
		await postAction(page, "/profile/api-keys/new?/create", {
			expiry: "30",
			name: "CI deploys",
			"permission.services": "write",
		});
		await addProvider(page);
		await gateApi(page, seeded.serviceIds.api ?? "");
		await registerIdpApp(page);
	},
	shots: [
		{
			doc: "/authentication",
			expect: /Preferred sign-in methods/,
			name: "auth-sign-in",
			path: () => "/authentication",
		},
		{
			doc: "/authentication/providers",
			expect: /accounts\.google\.com/,
			name: "auth-providers",
			path: () => "/authentication/providers",
		},
		{
			doc: "/authentication/:providerId",
			expect: /Saving rebuilds the auth backend live/,
			name: "auth-provider",
			path: () => `/authentication/${PROVIDER}`,
		},
		{
			doc: "/auth/error (account not linked, signed in)",
			expect: /That provider isn't connected to your account yet/,
			name: "auth-provider-link",
			path: () => "/auth/error?error=account%20not%20linked",
		},
		{
			doc: "/profile/security (Connected accounts)",
			expect: /Connected accounts/,
			name: "profile-security",
			path: () => "/profile/security",
		},
		{
			doc: "/services/:id/security (login wall on)",
			expect: /Require login to access this app/,
			name: "login-wall-section",
			path: (seeded) => `/services/${seeded.serviceIds.api}/security`,
		},
		{
			doc: "/services/:id/security (who's allowed)",
			expect: /Require login to access this app/,
			name: "login-wall-allowed",
			path: (seeded) => `/services/${seeded.serviceIds.api}/security`,
			prepare: async (page) => {
				await page
					.getByRole("checkbox", { name: /Cleo Client/ })
					.scrollIntoViewIfNeeded();
				await page.locator("#authAllowedGroups").scrollIntoViewIfNeeded();
			},
		},
		{
			doc: "/authentication/protected",
			expect: /password, oauth:google/,
			name: "login-wall-protected-apps",
			path: () => "/authentication/protected",
		},
		{
			doc: "/authentication/new (Keycloak preset)",
			expect: /Start from a preset/,
			name: "auth-provider-new",
			path: () => "/authentication/new",
			prepare: async (page) => {
				await removeProvider(page);
				await page.getByRole("button", { name: "Keycloak" }).click();
				await expect(page.locator("#name")).toHaveValue("keycloak");
			},
		},
		{
			doc: "/profile/security (authenticator app setup)",
			expect: /Two-factor authentication/,
			name: "two-factor-setup",
			path: () => "/profile/security",
			prepare: async (page) => {
				await page.locator("#twoFactorPassword").fill(ADMIN_PASSWORD);
				await page
					.getByRole("button", { name: "Set up authenticator app" })
					.click();
				await expect(page.getByAltText("Authenticator QR code")).toBeVisible();
				await page
					.locator("section")
					.filter({
						has: page.getByRole("heading", {
							exact: true,
							name: "Two-factor authentication",
						}),
					})
					.scrollIntoViewIfNeeded();
			},
		},
		{
			doc: "/profile/security (passkeys)",
			expect: /No passkeys registered yet/,
			name: "two-factor-passkeys",
			path: () => "/profile/security",
			prepare: async (page) => {
				await page
					.locator("section")
					.filter({
						has: page.getByRole("heading", { exact: true, name: "Passkeys" }),
					})
					.scrollIntoViewIfNeeded();
			},
		},
		{
			doc: "/users (Add user)",
			expect: /Cleo Client/,
			name: "users-add",
			path: () => "/users",
			prepare: async (page) => {
				await page.getByRole("button", { name: "Add user" }).click();
				await expect(page.getByText("Direct create")).toBeVisible();
			},
		},
		{
			doc: "/users",
			expect: /Cleo Client/,
			name: "users-list",
			path: () => "/users",
		},
		{
			doc: "/idp/new",
			expect: /Register an app/,
			name: "idp-register",
			path: () => "/idp/new",
			prepare: async (page) => {
				await page.locator("#name").fill("Outline");
			},
		},
		{
			doc: "/idp/new (callback URL)",
			expect: /Register an app/,
			name: "idp-register-callback",
			path: () => "/idp/new",
			prepare: async (page) => {
				await page.locator("#name").fill("Outline");
				const callback = page.locator("#env-redirectUris");
				await callback.fill("https://outline.example.com/auth/oidc.callback");
				await expect(
					page.getByText(/outline\.example\.com\/auth\/oidc\.callback\?code=/),
				).toBeVisible();
				await callback.scrollIntoViewIfNeeded();
			},
		},
		{
			doc: "/idp",
			expect: /Signs in on grafana\.example\.com/,
			name: "idp-apps",
			path: () => "/idp",
		},
		{
			doc: "/idp/:appId",
			expect: /Connect the app/,
			name: "idp-app",
			path: () => idpAppPath,
		},
		{
			doc: "/idp/:appId/environments",
			expect: /Client secrets/,
			name: "idp-environments",
			path: () => `${idpAppPath}/environments`,
		},
		{
			doc: "/idp/:appId/settings",
			expect: /App settings/,
			name: "idp-settings",
			path: () => `${idpAppPath}/settings`,
		},
		{
			doc: "/profile",
			expect: /Display name/,
			name: "profile-personal",
			path: () => "/profile",
		},
		{
			doc: "/profile/sessions",
			expect: /Every device currently signed in/,
			name: "profile-sessions",
			path: () => "/profile/sessions",
		},
		{
			doc: "/profile/api-keys",
			expect: /Grafana dashboard/,
			name: "profile-api-keys",
			path: () => "/profile/api-keys",
		},
		{
			doc: "/ (update status dialog)",
			expect: /Welcome back/i,
			name: "upgrading-dialog",
			path: () => "/",
			prepare: async (page) => {
				await page.getByTitle("Update status").click();
				await expect(
					page
						.getByRole("dialog")
						.getByText(
							/Up to date|Couldn't reach GitHub|Couldn't load the update status|Not available here|Not right now|No new deployments|Couldn't check whether/,
						)
						.first(),
				).toBeVisible({ timeout: 30_000 });
			},
		},
		{
			doc: "/settings (Release channel)",
			expect: /Release channel/,
			name: "upgrading-channel",
			path: () => "/settings",
			prepare: async (page) => {
				await page
					.locator("section")
					.filter({ has: page.locator("#release-channel") })
					.scrollIntoViewIfNeeded();
			},
		},
		{
			doc: "/cli-auth",
			expect: /Authorize CLI/,
			name: "api-cli-login",
			path: () => "/cli-auth?code=WDJB-MJHT",
		},
	],
};
