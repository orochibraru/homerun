import { expect, type Page, test } from "@playwright/test";

const ACCENT = "#0b6fa4";
const CHART_1 = "#0b8ac0";

async function signIn(page: Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

async function saveColors(page: Page, palette: string): Promise<void> {
	await page.goto("/profile/appearance");
	await page.getByRole("button", { name: palette }).click();
	await page
		.locator("form[action='?/updateColors']")
		.getByRole("button", { name: "Save" })
		.click();
	await expect(page.getByText("Colors saved.")).toBeVisible();
}

function cssVarOf(
	page: Page,
	selector: string,
	name = "--color-accent",
): Promise<string> {
	return page
		.locator(selector)
		.first()
		.evaluate(
			(el, variable) => getComputedStyle(el).getPropertyValue(variable).trim(),
			name,
		);
}

test.describe
	.serial("colour palette", () => {
		test.afterAll(async ({ browser }) => {
			const page = await browser.newPage();
			await signIn(page);
			await saveColors(page, "Bordeaux (default)");
			await page.close();
		});

		test("a saved palette reaches portaled content, not just the page", async ({
			page,
		}) => {
			await signIn(page);
			await saveColors(page, "Ocean");

			await page.goto("/");
			expect(await cssVarOf(page, "html")).toBe(ACCENT);
			expect(await cssVarOf(page, "html", "--chart-1")).toBe(CHART_1);

			await page.getByRole("button", { name: "Notifications" }).click();
			const popover = page.locator("[data-slot='popover-content']");
			await expect(popover).toBeVisible();
			expect(await cssVarOf(page, "[data-slot='popover-content']")).toBe(
				ACCENT,
			);
		});

		test("the default palette puts the stock accent back", async ({ page }) => {
			await signIn(page);
			await saveColors(page, "Bordeaux (default)");

			await page.goto("/");
			expect(await cssVarOf(page, "html")).not.toBe(ACCENT);
		});
	});
