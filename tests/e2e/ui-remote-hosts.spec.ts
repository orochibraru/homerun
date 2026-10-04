import { expect, test } from "./support/test";

async function signIn(page: import("@playwright/test").Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

test("adding a server keeps its enrollment command on screen", async ({
	page,
}) => {
	await signIn(page);
	await page.goto("/remote-hosts");
	await page.getByRole("button", { name: "Add a server" }).click();
	await page.getByRole("button", { name: "Generate command" }).click();

	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("/api/v1/nodes/install.sh")).toBeVisible();
	await page.waitForLoadState("networkidle");
	await expect(dialog.getByText("/api/v1/nodes/install.sh")).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Generate command" }),
	).toBeHidden();
});
