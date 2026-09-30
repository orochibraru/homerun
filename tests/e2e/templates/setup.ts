import { expect, test as setup } from "@playwright/test";
import { ADMIN, AUTH_STATE } from "./support";

setup("creates the admin and finishes onboarding", async ({ page }) => {
	await expect(async () => {
		await page.goto("/auth/sign-up");
		await page.waitForLoadState("networkidle");
		await expect(page.locator("#name")).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 90_000 });
	await page.locator("#name").fill(ADMIN.name);
	await page.locator("#email").fill(ADMIN.email);
	await page.locator("#password").fill(ADMIN.password);
	await page.locator("#confirm").fill(ADMIN.password);
	await page.getByRole("button", { name: "Create account" }).click();
	await expect(page).toHaveURL(/\/onboarding$/, { timeout: 60_000 });
	await page.waitForLoadState("networkidle");

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
