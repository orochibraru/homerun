import { expect, type Page, test } from "@playwright/test";

const ACCENT = "#22c55e";

async function signIn(page: Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

async function saveAccent(page: Page, preset: string | null): Promise<void> {
	await page.goto("/profile/appearance");
	if (preset) {
		await page.getByRole("button", { name: preset }).click();
	} else {
		await page.getByRole("button", { name: "Reset to default" }).click();
	}
	await page
		.locator("form[action='?/updateAccent']")
		.getByRole("button", { name: "Save" })
		.click();
	await expect(page.getByText("Accent color saved.")).toBeVisible();
}

function accentVarOf(page: Page, selector: string): Promise<string> {
	return page
		.locator(selector)
		.first()
		.evaluate((el) =>
			getComputedStyle(el).getPropertyValue("--color-accent").trim(),
		);
}

test.describe
	.serial("accent colour", () => {
		test.afterAll(async ({ browser }) => {
			const page = await browser.newPage();
			await signIn(page);
			await saveAccent(page, null);
			await page.close();
		});

		test("a saved accent reaches portaled content, not just the page", async ({
			page,
		}) => {
			await signIn(page);
			await saveAccent(page, ACCENT);

			await page.goto("/");
			expect(await accentVarOf(page, "html")).toBe(ACCENT);

			await page.getByRole("button", { name: "Notifications" }).click();
			const popover = page.locator("[data-slot='popover-content']");
			await expect(popover).toBeVisible();
			expect(await accentVarOf(page, "[data-slot='popover-content']")).toBe(
				ACCENT,
			);
		});

		test("resetting to the default puts the stock accent back", async ({
			page,
		}) => {
			await signIn(page);
			await saveAccent(page, null);

			await page.goto("/");
			expect(await accentVarOf(page, "html")).not.toBe(ACCENT);
		});
	});
