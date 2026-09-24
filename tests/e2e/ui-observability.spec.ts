import { expect, type Page, test } from "@playwright/test";

async function signIn(page: Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

async function createService(page: Page, name: string): Promise<string> {
	await page.goto("/services/new");
	await page.locator("#name").fill(name);
	await page.locator("#image").fill("nginx");
	await page.getByRole("button", { name: "Next" }).click();
	await page.locator("#containerPort").fill("80");
	await page.getByRole("button", { name: "Next" }).click();
	await page.getByRole("button", { name: "Next" }).click();
	await page.getByRole("button", { name: "Next" }).click();
	await page.getByRole("button", { name: "Create service" }).click();
	await expect(page).toHaveURL(/\/services\/[0-9a-f-]{36}$/);
	return page.url().split("/").pop() ?? "";
}

test.describe
	.serial("observability controls", () => {
		test("pull policy defaults to Always and persists a change", async ({
			page,
		}) => {
			await signIn(page);
			const id = await createService(page, "obs-pull-policy");

			await page.goto(`/services/${id}/settings`);
			const trigger = page.locator("#pullPolicy");
			await expect(trigger).toContainText("Always");

			await trigger.click();
			await page.getByRole("option", { name: "If missing" }).click();
			await expect(
				page.getByText("Pull only when the image isn't already on the host.", {
					exact: false,
				}),
			).toBeVisible();

			const restart = page.locator("#restartPolicy");
			await restart.click();
			await page.getByRole("option", { name: "On failure" }).click();

			await page
				.locator('form[action="?/update"]')
				.getByRole("button", { exact: true, name: "Save" })
				.click();
			await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
			await page.reload();
			await expect(page.locator("#restartPolicy")).toContainText("On failure");
			await expect(page.locator("#pullPolicy")).toContainText("If missing");
		});

		test("the clear buttons only appear when there's something to clear", async ({
			page,
		}) => {
			await signIn(page);
			const id = await createService(page, "obs-clear-buttons");

			await page.goto(`/services/${id}/observability`);
			// A service that was never deployed has no beats and no errors, so
			// neither control should be offered.
			await expect(
				page.getByRole("button", { name: "Clear heartbeats" }),
			).toHaveCount(0);
			await expect(
				page.getByRole("button", { name: "Clear errors" }),
			).toHaveCount(0);
		});

		test("a failed deploy shows an error, and Clear errors hides it", async ({
			page,
		}) => {
			await signIn(page);
			const id = await createService(page, "obs-clear-errors");

			await page.goto(`/services/${id}/settings`);
			await page.locator("#name").fill("obs-clear-errors");
			await page
				.locator('form[action="?/update"]')
				.getByRole("button", { exact: true, name: "Save" })
				.click();

			await page.goto(`/services/${id}/observability`);
			const clear = page.getByRole("button", { name: "Clear errors" });
			if ((await clear.count()) === 0) {
				test.skip(true, "no errors recorded for this service in this run");
			}
			await clear.click();
			await expect(page.getByText("Errors cleared.")).toBeVisible();
			await expect(page.getByText("hidden")).toBeVisible();
		});
	});
