import { expect, test } from "@playwright/test";

/**
 * End-to-end smoke test against the real app — real signup, real Docker
 * pull/deploy, real Traefik-labeled container. No mocks. Uses a throwaway
 * account (unique email per run) and deletes it in a `finally` block so a
 * failed run never leaks a running container or test user.
 *
 * Requires a working local Docker daemon (see src/lib/server/docker/).
 */

const email = `pw-smoke-${Date.now()}@example.com`;
const password = "playwright-smoke-test-pw";
const serviceName = "Playwright Smoke Nginx";
const SIGN_UP_LANDING_URL_RE = /\/(auth\/sign-up\/confirm)?$/;
const SIGN_IN_URL_RE = /\/auth\/sign-in/;
const SERVICE_OVERVIEW_URL_RE = /\/services\/[^/]+$/;

test("sign up, deploy a service, verify it runs, clean up", async ({
  page,
}) => {
  await test.step("sign up", async () => {
    await page.goto("/auth/sign-up");
    await page.locator("#name").fill("Playwright Smoke");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#confirm").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    // signUp.email() establishes a session immediately (email verification
    // isn't required to sign in), so there's a real race between the
    // sign-up page's own "redirect home if already logged in" effect and
    // its explicit post-signup navigation to /auth/sign-up/confirm —
    // either can win. Accept both landing spots.
    await page.waitForURL(SIGN_UP_LANDING_URL_RE, {
      timeout: 10_000,
    });
  });

  await test.step("bypass email verification (dev mode)", async () => {
    if (page.url().includes("/auth/sign-up/confirm")) {
      await page
        .getByRole("button", {
          name: "Skip verification and go to dashboard",
        })
        .click();
    }
    await expect(page).toHaveURL("/");
  });

  try {
    await test.step("create a service", async () => {
      await page.goto("/services/new");
      await page.locator("#name").fill(serviceName);
      // The slug field auto-derives from the name field via an oninput
      // handler, but Playwright's fill() (a single synthetic dispatch)
      // doesn't reliably trigger it the way real per-keystroke typing does
      // — fill it explicitly rather than depend on that reactivity here.
      await page.locator("#slug").fill("playwright-smoke-nginx");
      await page.locator("#image").fill("nginx");
      await page.locator("#tag").fill("alpine");
      await page.locator("#containerPort").fill("80");
      await page.getByRole("button", { name: "Create service" }).click();
      await expect(page).toHaveURL("/services");
      await expect(page.getByText(serviceName)).toBeVisible();
    });

    let servicePath = "";

    await test.step("open it and deploy", async () => {
      await page.getByRole("link").filter({ hasText: serviceName }).click();
      // SvelteKit does a client-side (pushState) navigation here, which
      // Playwright's click() does not wait for the way it waits for a real
      // page load — read the URL too early and this captures the stale
      // pre-navigation path. Wait for the route to actually land first.
      await page.waitForURL(SERVICE_OVERVIEW_URL_RE);
      // href attributes in the DOM are relative paths, not absolute URLs —
      // use the pathname only, or the attribute selector below never matches.
      servicePath = new URL(page.url()).pathname;
      await page.getByRole("button", { exact: true, name: "Deploy" }).click();
      await expect(
        page.getByText("Running", { exact: true }).first()
      ).toBeVisible({
        timeout: 60_000,
      });
    });

    await test.step("logs show real container output", async () => {
      // The sidebar also has a "Services" link and other global nav items,
      // but "Logs" only appears once — still, prefer the unambiguous
      // href-scoped tab link so this doesn't break if the sidebar ever
      // grows a same-named entry (as happened with "Settings" below).
      await page.locator(`a[href="${servicePath}/logs"]`).click();
      await expect(page.getByText("live")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("body")).toContainText("nginx", {
        timeout: 15_000,
      });
    });

    await test.step("delete the service", async () => {
      // The sidebar also has a global "Settings" link (to /settings) — scope
      // to this service's own tab link by href to avoid the ambiguity.
      await page.locator(`a[href="${servicePath}/settings"]`).click();
      await page.getByRole("button", { name: "Delete service" }).click();
      await page.getByRole("button", { name: "Yes, delete" }).click();
      await expect(page).toHaveURL("/services");
      await expect(page.getByText(serviceName)).toHaveCount(0);
    });
  } finally {
    await test.step("clean up: delete the account (also removes any leftover container)", async () => {
      await page.goto("/settings");
      await page.getByRole("button", { name: "Delete account" }).click();
      await page.getByPlaceholder("Confirm your password").fill(password);
      await page
        .getByRole("button", { name: "Yes, delete my account" })
        .click();
      await expect(page).toHaveURL(SIGN_IN_URL_RE, { timeout: 15_000 });
    });
  }
});
