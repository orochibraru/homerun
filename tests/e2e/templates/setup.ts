import { E2E_BASE_URL } from "../support/config";
import { expect, test as setup } from "../support/test";
import { ADMIN, AUTH_STATE } from "./support";

setup("creates the admin and finishes onboarding", async ({ page }) => {
	const headers = { origin: E2E_BASE_URL };
	const signUp = await page.request.post("/api/v1/auth/sign-up/email", {
		data: ADMIN,
		headers,
	});
	if (!signUp.ok()) {
		const signIn = await page.request.post("/api/v1/auth/sign-in/email", {
			data: { email: ADMIN.email, password: ADMIN.password },
			headers,
		});
		expect(signIn.ok(), await signIn.text()).toBe(true);
	}

	await page.goto("/");
	await page.waitForLoadState("networkidle");
	if (page.url().endsWith("/onboarding")) {
		const finish = page.getByRole("button", { name: "Finish setup" });
		await expect(async () => {
			if (!(await finish.isVisible())) {
				await page.getByRole("button", { name: "Next" }).click();
			}
			await expect(finish).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 60_000 });
		await finish.click();
	}
	await expect(page).toHaveURL(/4310\/$/, { timeout: 30_000 });

	await page.context().storageState({ path: AUTH_STATE });
});
