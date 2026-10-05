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
	.serial("service environments", () => {
		test("an environment is created, edited and deleted from the Environments section", async ({
			page,
		}) => {
			await signIn(page);
			const res = await page.request.post("/api/v1/services", {
				data: {
					containerPort: 80,
					image: "nginx",
					name: "Env shop",
					slug: "env-shop",
					tag: "alpine",
				},
			});
			expect(res.ok(), await res.text()).toBeTruthy();
			const { id } = await res.json();

			await page.goto(`/services/${id}/environments`);
			await page.getByRole("button", { name: "New environment" }).click();
			await page.getByRole("button", { exact: true, name: "staging" }).click();
			await expect(page.locator("#environmentName")).toHaveValue("staging");
			await expect(page.locator("#environmentRef")).toHaveValue("alpine");
			await page.locator("#environmentRef").fill("1.27-alpine");
			await page.getByLabel("Deploy it now").click();
			await page.getByRole("button", { exact: true, name: "Create" }).click();
			await expect(page.getByText("staging created.")).toBeVisible();
			await expect(page.getByText("Env shop (staging)")).toBeVisible();
			await expect(page.getByText("Image tag 1.27-alpine")).toBeVisible();

			await page.getByRole("button", { name: "Edit staging" }).click();
			await page.locator("#editRef").fill("1.28-alpine");
			await page.getByRole("button", { exact: true, name: "Save" }).click();
			await expect(page.getByText("Environment saved.")).toBeVisible();
			await expect(page.getByText("Image tag 1.28-alpine")).toBeVisible();

			await page.getByRole("button", { name: "Delete staging" }).click();
			await page.getByRole("button", { exact: true, name: "Delete" }).click();
			await expect(page.getByText("Environment deleted.")).toBeVisible();
			await expect(page.getByText("Env shop (staging)")).toHaveCount(0);

			await page.request.delete(`/api/v1/services/${id}`);
		});
	});
