import { expect, test } from "@playwright/test";

/**
 * Depends on `onboarding.spec.ts` having already finished onboarding for
 * this suite's shared instance (see playwright.config.ts's own note on why
 * every spec file here shares one app/database) — signing in as the admin
 * lands straight on the dashboard once onboarding is done, not the wizard,
 * which is exactly what this file exercises alongside sign-out and a
 * rejected wrong-password attempt.
 */
test.describe
	.serial("sign-in / sign-out", () => {
		test("a wrong password is rejected and leaves you on the sign-in page", async ({
			page,
		}) => {
			await page.goto("/auth/sign-in");
			await page.locator("#email").fill("ada@example.com");
			await page.locator("#password").fill("definitely-the-wrong-password");
			await page.getByRole("button", { name: "Sign in" }).click();

			// No redirect happens on a rejected sign-in (see +page.svelte's own
			// handleSignIn : an `error` response just shows a toast and returns).
			await page.waitForTimeout(500);
			await expect(page).toHaveURL(/\/auth\/sign-in$/);
		});

		test("signing in with the real password lands on the dashboard, onboarding already done", async ({
			page,
		}) => {
			await page.goto("/auth/sign-in");
			await page.locator("#email").fill("ada@example.com");
			await page.locator("#password").fill("a-real-strong-password-123");
			await page.getByRole("button", { name: "Sign in" }).click();

			await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
			await expect(
				page.getByRole("heading", { name: /Welcome back, Ada/ }),
			).toBeVisible();
		});

		test("signing out from the account menu returns you to the sign-in page", async ({
			page,
		}) => {
			await page.goto("/auth/sign-in");
			await page.locator("#email").fill("ada@example.com");
			await page.locator("#password").fill("a-real-strong-password-123");
			await page.getByRole("button", { name: "Sign in" }).click();
			await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);

			await page.getByRole("button", { name: "Account menu" }).click();
			await page.getByText("Sign out").click();

			// signOut() itself doesn't navigate (see profile-menu.svelte's own
			// handleSignOut, just `refreshAll()`) : the redirect comes from
			// (protected)/+layout.server.ts's own guard re-running and finding no
			// session, once every active `load` re-runs.
			await expect(page).toHaveURL(/\/auth\/sign-in$/);
		});
	});
