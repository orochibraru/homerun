import { expect, test } from "@playwright/test";

/**
 * The one genuinely client-side-interactive flow every other suite in this
 * repo explicitly declines to cover (see tests/integration/README.md's
 * "Not covered by this suite" and tests/unit/app/README.md's own scope):
 * a real browser filling in a real form, a real client-side `signUp.email`
 * call round-tripping to the real spawned app, and the real post-signup
 * client-side redirect landing somewhere sensible.
 *
 * Order matters across this file's two tests: this suite's app instance is
 * shared (see playwright.config.ts's own note on why), and the very first
 * account created on a blank instance becomes its admin — this test is
 * deliberately the one that creates it, everything after in this file
 * builds on that same account being signed in already.
 */
test.describe
	.serial("bootstrap sign-up", () => {
		test("visiting a blank instance redirects to sign-up, not sign-in", async ({
			page,
		}) => {
			await page.goto("/");
			await expect(page).toHaveURL(/\/auth\/sign-up$/);
			await expect(
				page.getByRole("heading", { name: "Create your admin account" }),
			).toBeVisible();
		});

		test("creating the first account becomes admin and lands on the onboarding wizard", async ({
			page,
		}) => {
			await page.goto("/auth/sign-up");

			await page.locator("#name").fill("Ada Admin");
			await page.locator("#email").fill("ada@example.com");
			await page.locator("#password").fill("a-real-strong-password-123");
			await page.locator("#confirm").fill("a-real-strong-password-123");
			await page.getByRole("button", { name: "Create account" }).click();

			// The (protected) layout's onboarding guard : a fresh instance forces
			// every route to /onboarding until instance_settings.onboardingCompletedAt
			// is set, see CLAUDE.md's Onboarding section.
			await expect(page).toHaveURL(/\/onboarding$/);
			await expect(
				page.getByRole("heading", { name: "Set up Homerun" }),
			).toBeVisible();
		});

		test("once an account exists, /auth/sign-up redirects to /auth/sign-in instead", async ({
			page,
		}) => {
			// src/routes/auth/sign-up/+page.server.ts's `load` redirects based on
			// `AdminService.hasAnyUser()`, not on this browser's own session, so
			// this holds for any visitor once the instance is no longer blank.
			await page.goto("/auth/sign-up");
			await expect(page).toHaveURL(/\/auth\/sign-in$/);
		});
	});
