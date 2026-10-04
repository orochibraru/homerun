import { expect, test } from "./support/test";

async function signIn(page: import("@playwright/test").Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

test.describe
	.serial("error pages", () => {
		test("the page answers anonymously with the status Traefik asked for", async ({
			request,
		}) => {
			const notFound = await request.get("/homerun-error/404", {
				headers: { "x-forwarded-host": "nobody-here.example.com" },
			});
			expect(notFound.status()).toBe(404);
			expect(notFound.headers()["cache-control"]).toBe("no-store");
			expect(await notFound.text()).toContain("Nothing here");

			const unavailable = await request.get("/homerun-error/503");
			expect(unavailable.status()).toBe(503);
			expect(await unavailable.text()).toContain("Temporarily unavailable");
		});

		test("branding and text saved in settings reach the page", async ({
			page,
			request,
		}) => {
			await signIn(page);
			await page.goto("/settings/error-pages");
			await page.locator("#brandName").fill("Acme Cloud");
			await page.locator("button[form='error-pages-branding']").click();
			await expect(page.getByText("Branding saved.")).toBeVisible();

			await page.locator("#notReadyTitle").fill("Warming up");
			await page.locator("button[form='error-pages-text']").click();
			await expect(page.getByText("Page text saved.")).toBeVisible();

			await page.reload();
			await expect(page.locator("#brandName")).toHaveValue("Acme Cloud");

			const html = await (
				await request.get("/homerun-error/404?preview=notReady")
			).text();
			expect(html).toContain("Warming up");
			expect(html).toContain("Acme Cloud");
			expect(html).toContain("Powered by Homerun");
		});
	});
