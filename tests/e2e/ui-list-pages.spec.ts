import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

test.describe
	.serial("list pages render through EntityList", () => {
		test.beforeEach(async ({ page }) => {
			await signIn(page);
		});

		test("a build cache registry lists, edits and keeps its password", async ({
			page,
		}) => {
			await page.goto("/build-cache-registries/new");
			await page.locator("#name").fill("Cache one");
			await page.locator("#registryUrl").fill("registry.example.com");
			await page.locator("#username").fill("robot");
			await page.locator("#password").fill("hunter2");
			await page.getByRole("button", { name: "Add registry" }).click();

			await expect(page).toHaveURL(/\/build-cache-registries$/);
			await expect(page.getByText("Cache one")).toBeVisible();
			await expect(
				page.getByText("registry.example.com · robot"),
			).toBeVisible();

			await page.getByTitle("Edit").first().click();
			await expect(page.locator("#name")).toHaveValue("Cache one");
			await expect(page.locator("#password")).toHaveAttribute(
				"placeholder",
				"Leave blank to keep current",
			);
			await page.locator("#registryUrl").fill("registry.internal:5000");
			await page.getByRole("button", { name: "Save changes" }).click();
			await expect(page.getByText("Registry saved.")).toBeVisible();

			await page.goto("/build-cache-registries");
			await expect(
				page.getByText("registry.internal:5000 · robot"),
			).toBeVisible();
		});

		test("a remote host lists with its connection subtitle", async ({
			page,
		}) => {
			await page.goto("/remote-hosts/new");
			await page.locator("#name").fill("Build box");
			await page.locator("#dockerHost").fill("tcp://10.0.0.5:2375");
			await page.getByRole("button", { name: /Add host/i }).click();
			await expect(page.getByText("Remote host added.")).toBeVisible();

			await page.goto("/remote-hosts");
			await expect(page.getByText("Build box")).toBeVisible();
			await expect(page.getByText("tcp://10.0.0.5:2375")).toBeVisible();
		});

		test("an S3 destination lists with endpoint, bucket and region", async ({
			page,
		}) => {
			await page.goto("/s3-destinations/new");
			await page.locator("#name").fill("Backups");
			await page.locator("#endpoint").fill("https://s3.example.com");
			await page.locator("#bucket").fill("homerun");
			await page.locator("#region").fill("eu-central-1");
			await page.locator("#accessKeyId").fill("key");
			await page.locator("#secretAccessKey").fill("secret");
			await page.getByRole("button", { name: /Add destination/i }).click();
			await expect(page.getByText("Destination added.")).toBeVisible();

			await page.goto("/s3-destinations");
			const listPanel = page.locator(".panel");
			await expect(listPanel.getByText("Backups")).toBeVisible();
			await expect(
				page.getByText("https://s3.example.com · homerun · eu-central-1"),
			).toBeVisible();
		});

		test("the cron jobs page lists a job with its schedule", async ({
			page,
		}) => {
			await page.goto("/cron-jobs/new");
			await page.locator("#name").fill("Nightly");
			await page.locator("#schedule").fill("0 3 * * *");
			await page.locator("#image").fill("alpine");
			await page
				.getByRole("button", { name: /Create/i })
				.first()
				.click();
			await expect(page).toHaveURL(/\/cron-jobs/);

			await page.goto("/cron-jobs");
			await expect(page.getByText("Nightly")).toBeVisible();
			await expect(page.getByText(/0 3 \* \* \*/)).toBeVisible();
		});
	});
