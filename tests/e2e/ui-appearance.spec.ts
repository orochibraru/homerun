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

/** Clicks `save` and waits for `saved`, unless the choice just made is the one already saved, which leaves Save disabled. */
async function saveIfChanged(
	page: Page,
	form: string,
	saved: string,
): Promise<void> {
	const save = page.locator(`button[form='${form}']`);
	const changed = await expect(save)
		.toBeEnabled({ timeout: 2000 })
		.then(
			() => true,
			() => false,
		);
	if (changed) {
		await save.click();
		await expect(page.getByText(saved)).toBeVisible();
	}
}

async function saveColors(page: Page, palette: string): Promise<void> {
	await page.goto("/profile/appearance");
	await page.getByRole("button", { name: palette }).click();
	await saveIfChanged(page, "appearance-colors", "Colors saved.");
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

test.describe.serial("colour palette", () => {
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

		await page.getByRole("button", { name: "Account menu" }).click();
		const menu = page.locator("[data-slot='dropdown-menu-content']");
		await expect(menu).toBeVisible();
		expect(await cssVarOf(page, "[data-slot='dropdown-menu-content']")).toBe(
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
	await saveIfChanged(page, "appearance-preset", "Preset saved.");
}

test.describe.serial("presets", () => {
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
		await expect(page.locator("html")).toHaveAttribute("data-surface", "lanes");
	});
});

test.describe.serial("style", () => {
	test("Lanes is the only style, rendered server-side, with no picker", async ({
		page,
	}, testInfo) => {
		await signIn(page);
		const response = await page.goto("/remote-hosts");
		expect(await response?.text()).toContain('data-surface="lanes"');
		await page.goto("/profile/appearance");
		await expect(page.locator("form[action='?/updateSurface']")).toHaveCount(0);
		await page.screenshot({ path: testInfo.outputPath("lanes.png") });
	});
});
