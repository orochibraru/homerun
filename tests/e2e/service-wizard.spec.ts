import { expect, test } from "@playwright/test";

/**
 * Depends on `onboarding.spec.ts` having already finished onboarding for
 * this suite's shared instance (see playwright.config.ts's own note on why
 * every spec file here shares one app/database), so signing in lands on the
 * dashboard and `/services/new` is reachable.
 *
 * The regression this guards: both submit buttons on the wizard's last step
 * used to set the `submittingAction` state from their own `onclick`, and
 * that state also drove their `disabled` attribute. Svelte flushes the DOM
 * synchronously during event dispatch, so the button was already disabled
 * by the time the browser ran its activation behavior, which skips form
 * submission for a disabled submitter : the click swapped the label to
 * "Creating…" and then nothing happened, no submit event, no request, with
 * the spinner stuck forever. Neither button is deployed here, so this
 * needs no Docker socket : "Create service" persists config only.
 */
test.describe
	.serial("service creation wizard", () => {
		test.beforeEach(async ({ page }) => {
			await page.goto("/auth/sign-in");
			await page.locator("#email").fill("ada@example.com");
			await page.locator("#password").fill("a-real-strong-password-123");
			await page.getByRole("button", { name: "Sign in" }).click();
			await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
		});

		test("'Create service' actually submits and lands on the services list", async ({
			page,
		}) => {
			await page.goto("/services/new");

			await page.locator("#name").fill("wizard-check");
			await page.locator("#image").fill("nginx");
			await page.getByRole("button", { name: "Next" }).click();
			await page.locator("#containerPort").fill("80");
			await page.getByRole("button", { name: "Next" }).click();
			await page.getByRole("button", { name: "Next" }).click();

			const create = page.getByRole("button", { name: "Create service" });
			await expect(create).toBeEnabled();
			await create.click();

			await expect(page).toHaveURL(/\/services$/);
			await expect(page.getByText("wizard-check").first()).toBeVisible();
		});

		test("a validation failure comes back to step 1 with the button usable again", async ({
			page,
		}) => {
			await page.goto("/services/new");

			// Deliberately skips the container port, which the schema requires to
			// be >= 1 : the point is that the form still *submits* and reports the
			// failure rather than hanging on a stuck spinner.
			await page.locator("#name").fill("wizard-invalid");
			await page.locator("#image").fill("nginx");
			for (let i = 0; i < 3; i++) {
				await page.getByRole("button", { name: "Next" }).click();
			}
			await page.getByRole("button", { name: "Create service" }).click();

			await expect(
				page.getByText("Couldn't create the service:"),
			).toBeVisible();

			// onFailure sends you back to step 1, where the submit buttons aren't
			// rendered at all : stepping forward again is what shows the button
			// reset to "Create service" rather than stuck on "Creating…".
			for (let i = 0; i < 3; i++) {
				await page.getByRole("button", { name: "Next" }).click();
			}
			await expect(
				page.getByRole("button", { name: "Create service" }),
			).toBeEnabled();
		});
	});
