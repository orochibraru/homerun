import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

test.describe
	.serial("authentication page and login wall UI", () => {
		test("the Authentication page is in the sidebar and lists the presets", async ({
			page,
		}) => {
			await signIn(page);
			await page.getByRole("link", { name: "Authentication" }).click();
			await expect(page).toHaveURL(/\/authentication$/);

			for (const preset of [
				"Pocket ID",
				"Keycloak",
				"Authelia",
				"Logto",
				"Authentik",
				"Zitadel",
				"Kanidm",
			]) {
				await expect(page.getByRole("button", { name: preset })).toBeVisible();
			}
			await expect(page.getByText("No providers yet.")).toBeVisible();
		});

		test("clicking a preset prefills a provider row with its discovery template", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/authentication");
			await page.getByRole("button", { name: "Keycloak" }).click();

			await expect(page.locator("#oauthName-0")).toHaveValue("keycloak");
			await expect(page.locator("#oauthDiscoveryUrl-0")).toHaveValue(
				"https://{host}/realms/{realm}/.well-known/openid-configuration",
			);
			await expect(page.getByText("{realm} the realm name")).toBeVisible();
		});

		test("the service Access section only reveals its policy fields once the wall is on", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/services/new");
			await page.locator("#name").fill("wall-check");
			await page.locator("#image").fill("nginx");
			await page.getByRole("button", { name: "Next" }).click();
			await page.locator("#containerPort").fill("80");
			await page.getByRole("button", { name: "Next" }).click();
			await page.getByRole("button", { name: "Next" }).click();
			await page.getByRole("button", { name: "Create service" }).click();
			await expect(page).toHaveURL(/\/services$/);

			await page.getByText("wall-check").first().click();
			await page.getByRole("link", { name: "Networking" }).click();

			await expect(page.getByText("Access", { exact: true })).toBeVisible();
			await expect(page.getByText("Sign-in methods")).toBeHidden();

			await page
				.getByRole("checkbox", { name: /Require login to access this app/ })
				.click();
			await expect(page.getByText("Sign-in methods")).toBeVisible();
			await expect(page.getByText("Built-in Homerun login")).toBeVisible();
			await expect(page.getByText("Who's allowed")).toBeVisible();
			await expect(page.getByLabel("Emails")).toBeVisible();
			await expect(page.getByLabel("Groups / roles")).toBeVisible();
		});

		test("saving the wall with no sign-in method picked is refused", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/services");
			await page.getByText("wall-check").first().click();
			await page.getByRole("link", { name: "Networking" }).click();

			await page
				.getByRole("checkbox", { name: /Require login to access this app/ })
				.click();
			await page
				.locator("form[action='?/updateAppAuth']")
				.getByRole("button", { name: "Save" })
				.click();

			await expect(
				page.getByText(/Pick at least one sign-in method/),
			).toBeVisible();
		});
	});
