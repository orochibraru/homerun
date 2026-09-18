import { expect, test } from "@playwright/test";

const NEW_EMAIL = "grace@example.com";
const NEW_PASSWORD = "grace-picks-her-own-password";

test.describe
	.serial("an admin-created account sets its own password", () => {
		test("the admin creates the account without a password", async ({
			page,
		}) => {
			await page.goto("/auth/sign-in");
			await page.locator("#email").fill("ada@example.com");
			await page.getByRole("button", { exact: true, name: "Continue" }).click();
			await page.locator("#password").fill("a-real-strong-password-123");
			await page.getByRole("button", { name: "Sign in" }).click();
			await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);

			await page.goto("/users");
			await expect(
				page.getByText("Setting up SMTP is highly recommended."),
			).toBeVisible();
			await page.getByRole("button", { name: "Add user" }).click();
			await expect(page.locator("#password")).toHaveCount(0);
			await page.locator("#name").fill("Grace Hopper");
			await page.locator("#email").fill(NEW_EMAIL);
			await page.getByRole("button", { name: "Create user" }).click();
			await expect(page.getByText(NEW_EMAIL)).toBeVisible();
		});

		test("the new user picks a password on first sign-in and lands on the dashboard", async ({
			page,
		}) => {
			await page.goto("/auth/sign-in");
			await page.locator("#email").fill(NEW_EMAIL);
			await page.getByRole("button", { exact: true, name: "Continue" }).click();

			await expect(page.getByText("choose your password")).toBeVisible();
			await page.locator("#newPassword").fill(NEW_PASSWORD);
			await page.locator("#confirmPassword").fill(NEW_PASSWORD);
			await page
				.getByRole("button", { name: "Set password and sign in" })
				.click();
			await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
		});

		test("from then on the account signs in with that password", async ({
			page,
		}) => {
			await page.goto("/auth/sign-in");
			await page.locator("#email").fill(NEW_EMAIL);
			await page.getByRole("button", { exact: true, name: "Continue" }).click();
			await page.locator("#password").fill(NEW_PASSWORD);
			await page.getByRole("button", { name: "Sign in" }).click();
			await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
		});
	});
