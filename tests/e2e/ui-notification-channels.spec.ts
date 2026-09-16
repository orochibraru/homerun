import { expect, type Page, test } from "@playwright/test";

async function signIn(page: Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

test.describe
	.serial("notification channels", () => {
		test("a webhook channel is added, subscribed, and removed", async ({
			page,
		}) => {
			await signIn(page);
			await page.getByRole("link", { name: "Notification Channels" }).click();
			await expect(page).toHaveURL(/\/notification-channels$/);

			await page.locator("#channelName").fill("E2E hook");
			await page.locator("#channelKind").selectOption("webhook");
			await page.locator("#channelTarget").fill("https://example.com/hook");
			await page.getByRole("button", { name: "Add channel" }).click();
			await expect(page.getByText("Channel added.")).toBeVisible();
			await expect(page.getByText("https://example.com/hook")).toBeVisible();
			await expect(page.getByText("Build failed, Update failed")).toBeVisible();

			await page.goto("/profile/notifications");
			const serviceDown = page.getByRole("checkbox", {
				name: "Service down to E2E hook",
			});
			await expect(serviceDown).not.toBeChecked();
			await expect(
				page.getByRole("checkbox", { name: "Build failed to E2E hook" }),
			).toBeChecked();
			await serviceDown.click();
			await page.getByRole("button", { name: "Save" }).click();
			await expect(
				page.getByText("Notification settings saved."),
			).toBeVisible();
			await page.reload();
			await expect(serviceDown).toBeChecked();

			await page.goto("/notification-channels");
			await page.getByRole("button", { name: "Remove E2E hook" }).click();
			await page.getByRole("button", { exact: true, name: "Remove" }).click();
			await expect(page.getByText("Channel removed.")).toBeVisible();
			await expect(page.getByText("https://example.com/hook")).toHaveCount(0);
		});

		test("a malformed Discord webhook URL is rejected", async ({ page }) => {
			await signIn(page);
			await page.goto("/notification-channels");

			await page.locator("#channelName").fill("Bad hook");
			await page.locator("#channelTarget").fill("https://example.com/hook");
			await page.getByRole("button", { name: "Add channel" }).click();

			await expect(
				page
					.locator("form[action='?/createChannel']")
					.getByText(/A Discord webhook URL looks like/),
			).toBeVisible();
		});
	});
