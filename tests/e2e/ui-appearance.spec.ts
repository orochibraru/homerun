import { type Page } from "@playwright/test";
import { expect, test } from "./support/test";

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

async function savePreset(page: Page, name: string): Promise<void> {
	await page.goto("/profile/appearance");
	const form = page.locator("form[action='?/updatePreset']");
	await form.getByRole("button", { name }).click();
	await form.getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Preset saved.")).toBeVisible();
}

test.describe
	.serial("presets", () => {
		test.afterAll(async ({ browser }) => {
			const page = await browser.newPage();
			await signIn(page);
			await savePreset(page, "None");
			await page.close();
		});

		for (const [id, name] of [
			["win95", "Windows 95"],
			["win98", "Windows 98"],
			["winxp", "Windows XP"],
			["win7", "Windows 7"],
			["msn", "MSN"],
			["retro", "Retro"],
		]) {
			test(`${name} is rendered server-side and overrides the theme, style and colors`, async ({
				page,
			}, testInfo) => {
				await signIn(page);
				await savePreset(page, name);
				await expect(
					page.getByText(`The ${name} preset overrides this`).first(),
				).toBeVisible();

				const response = await page.goto("/");
				expect(await response?.text()).toContain(`data-surface="${id}"`);
				await expect(page.locator("html")).toHaveAttribute("data-surface", id);
				await page.screenshot({ path: testInfo.outputPath(`${id}.png`) });
			});
		}

		test("None goes back to the chosen style", async ({ page }) => {
			await signIn(page);
			await savePreset(page, "None");
			await page.goto("/");
			await expect(page.locator("html")).toHaveAttribute(
				"data-surface",
				"sleek",
			);
		});
	});

async function saveStyle(page: Page, name: string): Promise<void> {
	await page.goto("/profile/appearance");
	const form = page.locator("form[action='?/updateSurface']");
	await form.getByRole("button", { name }).click();
	await form.getByRole("button", { name: "Save" }).click();
	await expect(page.getByText("Style saved.")).toBeVisible();
}

test.describe
	.serial("styles", () => {
		test.afterAll(async ({ browser }) => {
			const page = await browser.newPage();
			await signIn(page);
			await saveStyle(page, "Sleek (default)");
			await page.close();
		});

		test("glass tints the page with the accent, bordeaux stays warm", async ({
			page,
		}, testInfo) => {
			await signIn(page);
			await saveStyle(page, "Glass");
			await page.goto("/remote-hosts");
			await expect(page.locator("html")).toHaveAttribute(
				"data-surface",
				"glass",
			);
			const [red, , blue] = await page.locator("html").evaluate((el) => {
				const canvas = document.createElement("canvas").getContext("2d");
				if (!canvas) {
					return [0, 0, 0];
				}
				canvas.fillStyle = getComputedStyle(el).backgroundColor;
				canvas.fillRect(0, 0, 1, 1);
				return [...canvas.getImageData(0, 0, 1, 1).data];
			});
			expect(red).toBeGreaterThan(blue);
			await page.screenshot({ path: testInfo.outputPath("glass.png") });
		});

		for (const [id, name] of [
			["material", "Material You"],
			["sleek", "Sleek"],
		]) {
			test(`${name} is rendered server-side`, async ({ page }, testInfo) => {
				await signIn(page);
				await saveStyle(page, name);
				const response = await page.goto("/remote-hosts");
				expect(await response?.text()).toContain(`data-surface="${id}"`);
				await page.screenshot({ path: testInfo.outputPath(`${id}.png`) });
			});
		}
	});
