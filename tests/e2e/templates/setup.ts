import { expect, test as setup } from "@playwright/test";
import { ADMIN, AUTH_STATE } from "./support";

setup("creates the admin and finishes onboarding", async ({ page }) => {
	await page.goto("/auth/sign-up");
	await page.locator("#name").fill(ADMIN.name);
	await page.locator("#email").fill(ADMIN.email);
	await page.locator("#password").fill(ADMIN.password);
	await page.locator("#confirm").fill(ADMIN.password);
	await page.getByRole("button", { name: "Create account" }).click();
	await expect(page).toHaveURL(/\/onboarding$/);

	for (let step = 0; step < 5; step++) {
		await page.getByRole("button", { name: "Next" }).click();
	}
	await page.getByRole("button", { name: "Finish setup" }).click();
	await expect(page).toHaveURL(/4310\/$/);

	await page.context().storageState({ path: AUTH_STATE });
});
