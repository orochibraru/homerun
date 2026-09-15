import { expect, type Page, test } from "@playwright/test";

const PAGE_NAME = "E2E Status";
const PAGE_SLUG = "e2e-status";

async function signIn(page: Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

test.describe
	.serial("status pages", () => {
		test("the sidebar links to Status Page and it starts empty", async ({
			page,
		}) => {
			await signIn(page);

			await page.getByRole("link", { name: "Status Page" }).click();
			await expect(page).toHaveURL(/\/status-pages$/);
			await expect(page.getByText("No status pages yet")).toBeVisible();
		});

		test("creating a public page lands on its detail view", async ({
			page,
		}) => {
			await signIn(page);

			await page.goto("/status-pages/new");
			await page.locator("#name").fill(PAGE_NAME);
			await expect(page.locator("#slug")).toHaveValue(PAGE_SLUG);
			await page.getByLabel("Publish this page").check();
			await page.getByRole("button", { name: "Create status page" }).click();

			await expect(page).toHaveURL(/\/status-pages\/[0-9a-f-]{36}$/);
			await expect(
				page.getByRole("heading", { name: PAGE_NAME }),
			).toBeVisible();
			await expect(page.getByText("Public", { exact: true })).toBeVisible();
		});

		test("a published page is readable signed out, and leaks no infrastructure", async ({
			browser,
		}) => {
			const anon = await browser.newContext();
			const page = await anon.newPage();

			await page.goto(`/status/${PAGE_SLUG}`);
			await expect(page).toHaveURL(new RegExp(`/status/${PAGE_SLUG}$`));
			await expect(
				page.getByRole("heading", { name: PAGE_NAME }),
			).toBeVisible();

			const body = (await page.locator("body").innerText()).toLowerCase();
			expect(body).not.toContain("nginx");
			expect(body).not.toContain("docker");
			await expect(page.getByRole("link", { name: "Services" })).toHaveCount(0);

			await anon.close();
		});

		test("an unpublished page 404s for a signed-out visitor", async ({
			browser,
			page,
		}) => {
			await signIn(page);
			await page.goto("/status-pages");
			await page.getByRole("link", { name: PAGE_NAME }).click();
			await page.getByLabel("Publish this page").uncheck();
			await page.getByRole("button", { name: "Save changes" }).click();
			await expect(page.getByText("Status page saved.")).toBeVisible();

			const anon = await browser.newContext();
			const anonPage = await anon.newPage();
			const response = await anonPage.goto(`/status/${PAGE_SLUG}`);
			expect(response?.status()).toBe(404);
			await anon.close();
		});

		test("a webhook channel is added, listed, and removed", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/status-pages");

			await page.locator("#channelName").fill("E2E hook");
			await page.locator("#channelTarget").fill("https://example.com/hook");
			await page.getByRole("button", { name: "Add channel" }).click();
			await expect(page.getByText("Channel added.")).toBeVisible();
			await expect(page.getByText("https://example.com/hook")).toBeVisible();

			await page.getByRole("button", { name: "Remove E2E hook" }).click();
			await expect(page.getByText("Channel removed.")).toBeVisible();
			await expect(page.getByText("https://example.com/hook")).toHaveCount(0);
		});

		test("a malformed webhook URL is rejected", async ({ page }) => {
			await signIn(page);
			await page.goto("/status-pages");

			await page.locator("#channelName").fill("Bad hook");
			await page.locator("#channelTarget").fill("not-a-url");
			await page.getByRole("button", { name: "Add channel" }).click();

			await expect(
				page
					.locator("form[action='?/createChannel']")
					.getByText("That doesn't look like a URL."),
			).toBeVisible();
		});
	});
