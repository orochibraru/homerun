import { expect, test as setup } from "@playwright/test";
import { ADMIN, AUTH_STATE } from "./support";

setup("creates the admin and finishes onboarding", async ({ page }) => {
	await page.goto("/auth/sign-up");
	await expect(async () => {
		if (page.url().endsWith("/onboarding")) {
			return;
		}
		await page.locator("#name").fill(ADMIN.name);
		await page.locator("#email").fill(ADMIN.email);
		await page.locator("#password").fill(ADMIN.password);
		await page.locator("#confirm").fill(ADMIN.password);
		await page.getByRole("button", { name: "Create account" }).click();
		await expect(page).toHaveURL(/\/onboarding$/, { timeout: 5000 });
	}).toPass({ timeout: 60_000 });

	const finish = page.getByRole("button", { name: "Finish setup" });
	await expect(async () => {
		if (!(await finish.isVisible())) {
			await page.getByRole("button", { name: "Next" }).click();
		}
		await expect(finish).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60_000 });
	await finish.click();
	await expect(page).toHaveURL(/4310\/$/, { timeout: 30_000 });

	await page.context().storageState({ path: AUTH_STATE });
});
