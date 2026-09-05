import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

test.describe
	.serial("remote functions", () => {
		test("the dashboard's host resources resolve client-side, past the skeleton", async ({
			page,
		}) => {
			await signIn(page);

			const panel = page
				.locator("div")
				.filter({ has: page.getByRole("heading", { name: "Host Resources" }) })
				.last();
			await expect(panel.getByText("CPU")).toBeVisible();
			await expect(panel.getByText(/^\d+%$/)).toBeVisible();
			await expect(
				panel.getByText(/^\d+(\.\d+)? \/ \d+(\.\d+)? GB$/),
			).toHaveCount(2);
		});

		test("the notification feed resolves when the bell is opened", async ({
			page,
		}) => {
			await signIn(page);

			await page.getByRole("button", { name: "Notifications" }).click();
			await expect(page.getByText("No notifications yet.")).toBeVisible();
		});

		test("a command mutation refreshes the feed with no page reload", async ({
			page,
		}) => {
			await signIn(page);

			await page.goto("/services/new");
			await page.locator("#name").fill("remote-fn-check");
			await page.locator("#image").fill("nginx");
			await page.getByRole("button", { name: "Next" }).click();
			await page.locator("#containerPort").fill("80");
			await page.getByRole("button", { name: "Next" }).click();
			await page.getByRole("button", { name: "Next" }).click();
			await page.getByRole("button", { name: "Create service" }).click();
			await expect(page).toHaveURL(/\/services$/);

			await page.getByRole("button", { name: "Notifications" }).click();
			const entry = page.getByText('"remote-fn-check" was created.');
			await expect(entry).toBeVisible();

			const markAllRead = page.getByRole("button", { name: "Mark all read" });
			await expect(markAllRead).toBeVisible();
			await markAllRead.click();
			await expect(markAllRead).toBeHidden();

			await page
				.getByRole("button", { name: "Delete notification" })
				.first()
				.click();
			await expect(entry).toBeHidden();
		});

		test("the job queue panel resolves on the scheduling page", async ({
			page,
		}) => {
			await signIn(page);

			await page.goto("/scheduling");
			await expect(
				page.getByRole("heading", { name: "Job queue" }),
			).toBeVisible();
			await expect(page.getByText("Nothing in the queue")).toBeVisible();
		});
	});
