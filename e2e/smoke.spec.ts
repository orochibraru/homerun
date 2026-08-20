import { expect, test } from "bun:test";
import {
	cleanUpThrowawayAccount,
	createBasicService,
	makeThrowawayUser,
	signUpThrowawayUser,
} from "./helpers";
import { Page } from "./webview";

/**
 * End-to-end smoke test against the real app — real signup, real Docker
 * pull/deploy, real Traefik-labeled container. No mocks. Uses a throwaway
 * account (unique email per run) and deletes it in a `finally` block so a
 * failed run never leaks a running container or test user.
 *
 * Requires a working local Docker daemon (see src/lib/server/docker/).
 */

const user = makeThrowawayUser("smoke");
const serviceName = "Webview Smoke Nginx";
const SERVICE_PATH_RE = /^\/services\/[^/]+$/;

test("sign up, deploy a service, verify it runs, clean up", async () => {
	const page = await Page.create();
	try {
		// sign up
		await signUpThrowawayUser(page, user);
		expect(await page.pathname()).toBe("/");

		// create a service
		await createBasicService(page, {
			containerPort: "80",
			image: "nginx",
			name: serviceName,
			slug: "webview-smoke-nginx",
			tag: "alpine",
		});
		expect(await page.waitForText(serviceName)).toBe(true);

		// open it and deploy
		await page.clickText("a", serviceName);
		// SvelteKit does a client-side (pushState) navigation here, which
		// isn't a real page load the way navigate() waits for — wait for
		// the route to actually land first.
		const servicePath = await page.waitForPath(SERVICE_PATH_RE);
		await page.clickText("button", "Deploy");
		expect(await page.waitForText("Running", { timeoutMs: 60_000 })).toBe(true);

		// logs show real container output
		// The sidebar also has a "Services" link and other global nav items,
		// but "Logs" only appears once — still, prefer the unambiguous
		// href-scoped tab link so this doesn't break if the sidebar ever
		// grows a same-named entry (as happened with "Settings" below).
		await page.click(`a[href="${servicePath}/logs"]`);
		expect(await page.waitForText("live", { timeoutMs: 15_000 })).toBe(true);
		expect(await page.waitForText("nginx", { timeoutMs: 15_000 })).toBe(true);

		// delete the service
		// The sidebar also has a global "Settings" link (to /settings) — scope
		// to this service's own tab link by href to avoid the ambiguity.
		await page.click(`a[href="${servicePath}/settings"]`);
		await page.clickText("button", "Delete service");
		await page.clickText("button", "Yes, delete");
		await page.waitForPath("/services");
		expect(await page.waitForTextGone(serviceName, { timeoutMs: 5_000 })).toBe(
			true,
		);
	} finally {
		// clean up: delete the account (also removes any leftover container)
		await cleanUpThrowawayAccount(page, user.password);
		await page.close();
	}
}, 180_000);
