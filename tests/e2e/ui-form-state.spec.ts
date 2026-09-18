import { expect, test } from "@playwright/test";

/**
 * Both cases here come from one real bug: `update()`'s default `reset: true`
 * resets the DOM form, and Svelte strips an input's `value` attribute on
 * hydration, so `defaultValue` is always `""`. A server-rendered field blanked
 * out after a successful save (and the next save persisted the blank), and a
 * `bind:value` state was overwritten with `""` by Svelte's own form-reset
 * listener, which emptied the compose-import page's mirrored `compose` field
 * so the Import step rejected the file its own Parse step had just previewed.
 * `enhanceToast` now defaults `reset` to false, see CLAUDE.md.
 *
 * Named `ui-*` so it sorts after `onboarding.spec.ts`, same as
 * `ui-login-wall.spec.ts` : both sign in as the bootstrap admin and need the
 * instance to be past the onboarding gate.
 */
async function signIn(page: import("@playwright/test").Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

const COMPOSE = `services:
  web:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      - GREETING=hello
  cache:
    image: redis:8-alpine
    ports:
      - 6379:6379
`;

test.describe
	.serial("form state survives a submit", () => {
		test("saving a settings section leaves its fields filled in", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/settings/docker");
			await page.locator("#dockerNetworkName").fill("homerun");

			await page.getByRole("button", { name: "Save" }).first().click();
			await expect(page.getByText("Docker settings saved")).toBeVisible();

			await expect(page.locator("#dockerNetworkName")).toHaveValue("homerun");
			await page.reload();
			await expect(page.locator("#dockerNetworkName")).toHaveValue("homerun");
		});

		test("importing a compose file accepts the one the preview just parsed", async ({
			page,
		}) => {
			await signIn(page);
			await page.goto("/services/import");
			await page.locator("#compose").fill(COMPOSE);

			await page.getByRole("button", { name: "Parse" }).click();
			await expect(page.getByText("Services (2)")).toBeVisible();

			// Imported ungrouped on purpose: a stack is a Docker network, and
			// this harness deliberately doesn't wire a daemon into the app it
			// spawns (see tests/e2e/README.md).
			await page.locator("#stackName").fill("");
			await page.getByRole("button", { name: /Import 2 services/ }).click();

			await expect(page).toHaveURL(/\/services$/);
			await expect(page.getByText("nginx:alpine").first()).toBeVisible();
		});
	});
