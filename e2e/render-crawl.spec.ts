import { expect, test } from "@playwright/test";
import {
	cleanUpThrowawayAccount,
	collectPageErrors,
	createBasicService,
	isOnErrorPage,
	makeThrowawayUser,
	signUpThrowawayUser,
} from "./helpers";

/**
 * Crawls every dashboard page as a signed-in admin and asserts each one
 * renders cleanly: no non-2xx/3xx navigation response, no console.error(),
 * no uncaught client-side exception, and it isn't showing this app's own
 * error boundary (src/lib/components/error-page.svelte).
 *
 * This is deliberately shallow : it doesn't exercise behavior (see
 * smoke.spec.ts and the other *.spec.ts files for that), it just catches
 * "this page is broken" regressions across the whole app in one pass.
 * Extend STATIC_ROUTES / SERVICE_TABS whenever a new page is added : a
 * page missing from those lists never gets crawled.
 *
 * Uses expect.soft so one broken page doesn't stop the rest of the crawl
 * from being checked in the same run : read the whole report, not just
 * the first failure.
 *
 * Project/service/volume names are suffixed with a run-unique id (not
 * fixed strings) because project.slug is globally unique and account
 * deletion doesn't cascade-delete project/storage_volume rows (a known,
 * documented gap : see schema.ts's Data model notes) : fixed slugs would
 * collide with the previous run's leftovers on an unwiped test DB.
 */

const user = makeThrowawayUser("crawl");
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PROJECT_PATH_RE = /\/projects\/[^/]+$/;
const SERVICE_PATH_RE = /\/services\/[^/]+$/;
const VOLUME_PATH_RE = /\/storage\/[^/]+$/;

// Routes reachable with no created entity beyond the throwaway account
// itself. Admin-only pages (users/settings/system-logs) are included
// because a throwaway sign-up on an isolated test DB becomes the instance
// admin (first user : see auth.ts's bootstrap-admin hook).
const STATIC_ROUTES = [
	"/",
	"/services",
	"/services/new",
	"/projects",
	"/projects/new",
	"/templates",
	"/templates/new",
	"/storage",
	"/storage/new",
	"/remote-hosts",
	"/profile",
	"/settings",
	"/users",
	"/system-logs",
	// Not "/system-logs/traefik" : that's a +server.ts stream endpoint the
	// system-logs page itself fetches from, not a page to navigate to.
];

// Service detail tabs, relative to the created service's own path.
const SERVICE_TABS = [
	"",
	"/logs",
	"/env",
	"/volumes",
	"/networking",
	"/terminal",
	"/errors",
	"/settings",
];

test("every dashboard page renders without error", async ({ page }) => {
	// Well beyond the default 180s (set for the deploy-heavy smoke test) :
	// this test does no image pulls, but sequentially visiting ~25 routes
	// plus the setup (sign-up, onboarding, project/service/volume creation)
	// and cleanup genuinely takes several minutes.
	test.setTimeout(900_000); // TEMP for QA diagnosis, will revert before finishing

	const errors = collectPageErrors(page);
	// Set for real right before the crawl starts (see below) : errors from
	// sign-up/onboarding/entity-creation aren't attributed to any of the
	// crawled routes.
	let sinceConsole = 0;
	let sincePageErr = 0;

	async function visit(path: string) {
		const response = await page.goto(path);
		// Let the page settle (client-side hydration, any onMount fetches)
		// before checking for late console/page errors. Logs/Terminal keep a
		// stream open on purpose, so "networkidle" never fires for those :
		// don't wait forever on it.
		await page.waitForLoadState("networkidle").catch(() => undefined);

		expect.soft(response?.status(), `${path} HTTP status`).toBeLessThan(400);
		expect
			.soft(await isOnErrorPage(page), `${path} shows the error boundary`)
			.toBe(false);

		const newConsoleErrors = errors.consoleErrors.slice(sinceConsole);
		const newPageErrors = errors.pageErrors.slice(sincePageErr);
		sinceConsole = errors.consoleErrors.length;
		sincePageErr = errors.pageErrors.length;

		expect.soft(newConsoleErrors, `${path} console.error() calls`).toEqual([]);
		expect.soft(newPageErrors, `${path} uncaught exceptions`).toEqual([]);
	}

	try {
		await signUpThrowawayUser(page, user);

		let projectPath = "";
		let servicePath = "";
		let volumePath = "";

		await test.step("create a project to crawl its detail page", async () => {
			await page.goto("/projects/new");
			await page.locator("#name").fill(`Playwright Crawl Project ${runId}`);
			await page.locator("#slug").fill(`pw-crawl-project-${runId}`);
			await page.getByRole("button", { name: "Create project" }).click();
			await expect(page).toHaveURL("/projects");
			await page
				.getByRole("link")
				.filter({ hasText: `Playwright Crawl Project ${runId}` })
				.click();
			await page.waitForURL(PROJECT_PATH_RE);
			projectPath = new URL(page.url()).pathname;
		});

		await test.step("create a service to crawl its tabs", async () => {
			const projectId = projectPath.split("/").pop();
			await createBasicService(
				page,
				{
					containerPort: "80",
					image: "nginx",
					name: `Playwright Crawl Nginx ${runId}`,
					slug: `pw-crawl-nginx-${runId}`,
					tag: "alpine",
				},
				{ projectId },
			);
			await page
				.getByRole("link")
				.filter({ hasText: `Playwright Crawl Nginx ${runId}` })
				.click();
			await page.waitForURL(SERVICE_PATH_RE);
			servicePath = new URL(page.url()).pathname;
		});

		await test.step("create a storage volume to crawl its detail page", async () => {
			await page.goto("/storage/new");
			await page.locator("#name").fill(`Playwright Crawl Volume ${runId}`);
			await page.getByRole("radio", { name: "Docker volume" }).check();
			await page.locator("#source").fill(`pw-crawl-volume-${runId}`);
			await page.getByRole("button", { name: "Create volume" }).click();
			await expect(page).toHaveURL("/storage");
			// Unlike the projects/services list, a volume's name isn't itself a
			// link : the only link on its row is the icon-only "Backup settings"
			// button. This is the only volume this run creates, so it's the only
			// match.
			await page.getByRole("link", { name: "Backup settings" }).click();
			await page.waitForURL(VOLUME_PATH_RE);
			volumePath = new URL(page.url()).pathname;
		});

		// Errors from sign-up/onboarding/entity-creation above are real if they
		// happen, but they're not attributable to a single crawled route :
		// start the per-route accounting fresh from here.
		sinceConsole = errors.consoleErrors.length;
		sincePageErr = errors.pageErrors.length;

		await test.step("crawl every static route", async () => {
			for (const path of STATIC_ROUTES) {
				await visit(path);
			}
		});

		await test.step("crawl the project detail page", async () => {
			await visit(projectPath);
		});

		await test.step("crawl the storage volume detail page", async () => {
			await visit(volumePath);
		});

		await test.step("crawl every service tab", async () => {
			for (const tab of SERVICE_TABS) {
				await visit(`${servicePath}${tab}`);
			}
		});
	} finally {
		await test.step("clean up: delete the account (also removes the service's container)", async () => {
			await cleanUpThrowawayAccount(page, user.password);
		});
	}
});
