import { expect, test } from "@playwright/test";

/**
 * Depends on `bootstrap.spec.ts` having already created the admin account
 * (`ada@example.com`, same shared app/database instance this whole suite
 * uses, see playwright.config.ts's own note) — this file signs back in with
 * those credentials rather than assuming a still-authenticated session,
 * since every Playwright test gets its own fresh browser context (no cookies
 * carried over) regardless of file or `describe` order.
 */
test.describe
	.serial("onboarding wizard", () => {
		test.beforeEach(async ({ page }) => {
			await page.goto("/auth/sign-in");
			await page.locator("#email").fill("ada@example.com");
			await page.locator("#password").fill("a-real-strong-password-123");
			await page.getByRole("button", { name: "Sign in" }).click();
		});

		test("signing back in as the admin lands on the onboarding wizard, not the dashboard", async ({
			page,
		}) => {
			await expect(page).toHaveURL(/\/onboarding$/);
			await expect(
				page.getByRole("heading", { name: "Set up Homerun" }),
			).toBeVisible();
		});

		test("clicking through every step with default values finishes onboarding and lands on the dashboard", async ({
			page,
		}) => {
			await expect(page).toHaveURL(/\/onboarding$/);

			// Core / Docker / Traefik / Email : every field pre-fills with the
			// effective current value (DB override, falling back to the env
			// default, see +page.svelte's own comment), so "required" is trivially
			// satisfied by just clicking through without touching anything.
			for (let step = 0; step < 4; step++) {
				await page.getByRole("button", { name: "Next" }).click();
			}

			// Review, the 5th step : the page's own submit button replaces
			// Stepper's "Next" here.
			await page.getByRole("button", { name: "Finish setup" }).click();

			await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
			await expect(
				page.getByRole("heading", { name: /Welcome back, Ada/ }),
			).toBeVisible();

			// onboarding/+layout.server.ts redirects away once
			// instance_settings.onboardingCompletedAt is set : a second visit no
			// longer shows the wizard at all, from any session.
			await page.goto("/onboarding");
			await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
		});
	});
