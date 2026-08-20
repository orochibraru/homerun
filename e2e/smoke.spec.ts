import { expect, test } from "@playwright/test";
import {
  cleanUpThrowawayAccount,
  createBasicService,
  makeThrowawayUser,
  signUpThrowawayUser,
} from "./helpers";

/**
 * End-to-end smoke test against the real app — real signup, real Docker
 * pull/deploy, real Traefik-labeled container. No mocks. Uses a throwaway
 * account (unique email per run) and deletes it in a `finally` block so a
 * failed run never leaks a running container or test user.
 *
 * Requires a working local Docker daemon (see src/lib/server/docker/).
 */

const user = makeThrowawayUser("smoke");
const serviceName = "Playwright Smoke Nginx";
const SERVICE_OVERVIEW_URL_RE = /\/services\/[^/]+$/;

test("sign up, deploy a service, verify it runs, clean up", async ({
  page,
}) => {
  try {
    await test.step("sign up", async () => {
      await signUpThrowawayUser(page, user);
      await expect(page).toHaveURL("/");
    });

    await test.step("create a service", async () => {
      await createBasicService(page, {
        containerPort: "80",
        image: "nginx",
        name: serviceName,
        slug: "playwright-smoke-nginx",
        tag: "alpine",
      });
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
      await cleanUpThrowawayAccount(page, user.password);
    });
  }
});
