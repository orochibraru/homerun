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
		test("the Authentication page is in the sidebar and starts empty", async ({
			page,
		}) => {
			await signIn(page);
			await page.getByRole("link", { name: "Authentication" }).click();
			await expect(page).toHaveURL(/\/authentication$/);
			await expect(page.getByText("No providers yet")).toBeVisible();
			await expect(page.getByText("0 configured")).toBeVisible();
		});

		test("a provider is created from its own page and gets a detail page", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/authentication");
			await page.getByRole("link", { name: "Add provider" }).first().click();
			await expect(page).toHaveURL(/\/authentication\/new$/);

			await page.getByRole("button", { name: "Keycloak" }).click();
			await expect(page.locator("#name")).toHaveValue("keycloak");
			await expect(page.locator("#label")).toHaveValue("Keycloak");
			await expect(page.locator("#discoveryUrl")).toHaveValue(
				"https://{host}/realms/{realm}/.well-known/openid-configuration",
			);
			await expect(
				page.getByRole("checkbox", { name: /Sign out of the provider too/ }),
			).not.toBeChecked();
		});

		test("the provider list and detail page use the display name", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/authentication/new");
			await page.locator("#label").fill("My Login");
			await page.locator("#name").fill("my-login");
			await page.locator("#clientId").fill("abc");
			await page.locator("#clientSecret").fill("shh");
			await page
				.locator("#discoveryUrl")
				.fill("https://accounts.google.com/.well-known/openid-configuration");
			await page.getByRole("button", { name: "Add provider" }).click();

			await expect(page).toHaveURL(/\/authentication\/my-login$/);
			await expect(
				page.getByRole("heading", { name: "My Login" }),
			).toBeVisible();
			await expect(page.locator("#name")).toHaveAttribute("readonly", "");

			await page.goto("/authentication");
			await expect(page.getByText("1 configured")).toBeVisible();
			await expect(page.getByText("My Login")).toBeVisible();
		});

		test("removing a provider asks for confirmation first", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/authentication/my-login");
			await page.getByRole("button", { name: "Remove provider" }).click();

			const confirm = page
				.getByRole("button", { name: "Remove provider" })
				.last();
			await expect(confirm).toBeDisabled();
			await page.getByRole("textbox").last().fill("my-login");
			await expect(confirm).toBeEnabled();
			await confirm.click();

			await expect(page).toHaveURL(/\/authentication$/);
			await expect(page.getByText("No providers yet")).toBeVisible();
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

		test("a port in Base domain moves to the Dashboard URL, not the routing name", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/settings");
			await page.locator("#baseDomain").fill("localhost:5173");
			const https = page.getByRole("checkbox", { name: /Use HTTPS/ });
			if (await https.isChecked()) {
				await https.click();
			}
			await page.getByRole("button", { name: "Save" }).first().click();
			await expect(page.getByText("Core settings saved")).toBeVisible();

			await page.reload();
			await expect(page.locator("#baseDomain")).toHaveValue("localhost");
			await expect(page.locator("#authOrigin")).toHaveValue(
				"http://localhost:5173",
			);
		});

		test("account_not_linked offers Link and Sign out when signed in", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/authentication/new");
			await page.locator("#label").fill("Pocket ID");
			await page.locator("#name").fill("pocket-id");
			await page.locator("#clientId").fill("abc");
			await page.locator("#clientSecret").fill("shh");
			await page
				.locator("#discoveryUrl")
				.fill("https://accounts.google.com/.well-known/openid-configuration");
			await page.getByRole("button", { name: "Add provider" }).click();
			await expect(page).toHaveURL(/\/authentication\/pocket-id$/);

			await page.goto("/auth/error?error=account%20not%20linked");
			await expect(
				page.getByText(/That provider isn't connected to your account yet/),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: /Link Pocket ID to this account/ }),
			).toBeEnabled();
			await expect(
				page.getByRole("button", { name: "Sign out" }),
			).toBeEnabled();
			await expect(page.getByText("code: account_not_linked")).toBeVisible();
		});

		test("account_not_linked lets a signed-out visitor link in one step", async ({
			page,
		}) => {
			await page.context().clearCookies();
			await page.goto("/auth/error?error=account%20not%20linked");
			await expect(
				page.getByRole("button", { name: /Sign in and connect Pocket ID/ }),
			).toBeVisible();
			await expect(page.locator("#email")).toBeVisible();
			await expect(page.locator("#password")).toBeVisible();
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
