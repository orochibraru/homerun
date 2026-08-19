import { expect, test } from "@playwright/test";

/**
 * End-to-end smoke test against the real app — real signup, real Docker
 * pull/deploy, real Traefik-labeled container. No mocks. Uses a throwaway
 * account (unique email per run) and deletes it in a `finally` block so a
 * failed run never leaks a running container or test user.
 *
 * Requires a working local Docker daemon (see src/lib/server/docker/).
 */

const email = `pw-smoke-${Date.now()}@example.com`;
const password = "playwright-smoke-test-pw";
const serviceName = "Playwright Smoke Nginx";

test("sign up, deploy a service, verify it runs, clean up", async ({
	page,
}) => {
	await test.step("sign up", async () => {
		await page.goto("/auth/sign-up");
		await page.locator("#name").fill("Playwright Smoke");
		await page.locator("#email").fill(email);
		await page.locator("#password").fill(password);
		await page.locator("#confirm").fill(password);
		await page.getByRole("button", { name: "Create account" }).click();
		await expect(page).toHaveURL(/\/auth\/sign-up\/confirm/);
	});

	await test.step("bypass email verification (dev mode)", async () => {
		await page
			.getByRole("button", { name: "Skip verification and go to dashboard" })
			.click();
		await expect(page).toHaveURL("/");
	});

	try {
		await test.step("create a service", async () => {
			await page.goto("/services/new");
			await page.locator("#name").fill(serviceName);
			await page.locator("#image").fill("nginx");
			await page.locator("#tag").fill("alpine");
			await page.locator("#containerPort").fill("80");
			await page.getByRole("button", { name: "Create service" }).click();
			await expect(page).toHaveURL("/services");
			await expect(page.getByText(serviceName)).toBeVisible();
		});

		await test.step("open it and deploy", async () => {
			await page.getByRole("link").filter({ hasText: serviceName }).click();
			await page.getByRole("button", { name: "Deploy", exact: true }).click();
			await expect(page.getByText("Running", { exact: true })).toBeVisible({
				timeout: 60_000,
			});
		});

		await test.step("logs show real container output", async () => {
			await page.getByRole("link", { name: "Logs" }).click();
			await expect(page.getByText("live")).toBeVisible({ timeout: 15_000 });
			await expect(page.locator("body")).toContainText("nginx", {
				timeout: 15_000,
			});
		});

		await test.step("delete the service", async () => {
			await page.getByRole("link", { name: "Settings" }).click();
			await page.getByRole("button", { name: "Delete service" }).click();
			await page.getByRole("button", { name: "Yes, delete" }).click();
			await expect(page).toHaveURL("/services");
			await expect(page.getByText(serviceName)).toHaveCount(0);
		});
	} finally {
		await test.step("clean up: delete the account (also removes any leftover container)", async () => {
			await page.goto("/settings");
			await page.getByRole("button", { name: "Delete account" }).click();
			await page.getByPlaceholder("Confirm your password").fill(password);
			await page
				.getByRole("button", { name: "Yes, delete my account" })
				.click();
			await expect(page).toHaveURL(/\/auth\/sign-in/, { timeout: 15_000 });
		});
	}
});
