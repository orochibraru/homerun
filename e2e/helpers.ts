import type { Page } from "@playwright/test";

/**
 * Shared helpers for e2e specs. Every spec in this suite runs against the
 * real app (real Docker, real DB, real Traefik-labeled containers) : no
 * mocks : per playwright.config.ts, which points webServer at an isolated
 * NODE_ENV=test instance (see .env.test / DATABASE_URL) so this suite never
 * touches the maintainer's own database or a real dev session.
 *
 * All helpers here exist to keep that safe and consistent: throwaway
 * accounts only, cleanup in `finally`, one place to detect a broken page
 * rather than every spec reinventing it.
 *
 * NEVER point any of this at the maintainer's own account or a shared
 * instance : every test creates and deletes its own user.
 */

export interface ThrowawayUser {
	email: string;
	name: string;
	password: string;
}

// Matches "/", "/auth/sign-up/confirm", or "/onboarding" : the three
// possible landing spots right after signUp.email() establishes a session.
const POST_SIGNUP_URL_RE = /\/(onboarding|auth\/sign-up\/confirm)?$/;
const SIGN_IN_URL_RE = /\/auth\/sign-in/;

/** A unique-per-run throwaway account. Never reuse across test files. */
export function makeThrowawayUser(label: string): ThrowawayUser {
	const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	return {
		email: `pw-${label}-${unique}@example.com`,
		name: `Playwright ${label}`,
		password: "playwright-test-password",
	};
}

/**
 * Signs up a brand-new throwaway user and lands on the dashboard, skipping
 * email verification when the instance is running in dev mode (no SMTP).
 * On a blank/isolated test DB the first sign-up becomes the instance admin
 * (see auth.ts's bootstrap-admin hook) : that's intentional here, not a
 * side effect to work around.
 */
export async function signUpThrowawayUser(page: Page, user: ThrowawayUser) {
	await page.goto("/auth/sign-up");
	await page.locator("#name").fill(user.name);
	await page.locator("#email").fill(user.email);
	await page.locator("#password").fill(user.password);
	await page.locator("#confirm").fill(user.password);
	await page.getByRole("button", { name: "Create account" }).click();
	// signUp.email() establishes a session immediately, so there's a real
	// race between the sign-up page's own "already logged in" redirect and
	// its explicit post-signup navigation to /auth/sign-up/confirm : accept
	// either landing spot.
	await page.waitForURL(POST_SIGNUP_URL_RE, { timeout: 10_000 });

	if (page.url().includes("/auth/sign-up/confirm")) {
		await page
			.getByRole("button", { name: "Skip verification and go to dashboard" })
			.click();
		await page.waitForURL(POST_SIGNUP_URL_RE, { timeout: 10_000 });
	}

	// On a blank/isolated test DB this throwaway user is the instance's
	// first-ever account, so it's both the bootstrap admin and the one
	// forced through the onboarding wizard (see (protected)/+layout.server.ts's
	// onboarding guard) before anything else in the dashboard is reachable.
	// A plain goto("/") here (rather than trusting whatever URL the sign-up
	// flow's own client-side redirect settled on) forces a real round trip
	// through that guard's server `load`, so this can't race a client-side
	// navigation that hasn't reached it yet.
	await page.goto("/");
	if (page.url().includes("/onboarding")) {
		await completeOnboarding(page);
	}
}

/**
 * Clicks straight through the onboarding wizard (Core/Docker/Traefik/Email/
 * Review) and finishes it. Every field pre-fills with the instance's
 * current effective value (DB override falling back to the env default :
 * see onboarding/+page.svelte's own comment on this), so accepting the
 * defaults at each step is enough to pass validation; this doesn't attempt
 * to exercise entering different values.
 */
export async function completeOnboarding(page: Page) {
	const next = page.getByRole("button", { exact: true, name: "Next" });
	for (let i = 0; i < 4; i += 1) {
		await next.click();
	}
	await page.getByRole("button", { name: "Finish setup" }).click();
	await page.waitForURL("/", { timeout: 15_000 });
}

/**
 * Deletes the currently signed-in throwaway account from /settings : also
 * removes any leftover Docker containers/networks via cleanupUserResources.
 * Call this in a `finally` block so a failed test never leaks a user or a
 * running container.
 */
export async function deleteThrowawayAccount(page: Page, password: string) {
	await page.goto("/settings");
	await page.getByRole("button", { name: "Delete account" }).click();
	await page.getByPlaceholder("Confirm your password").fill(password);
	await page.getByRole("button", { name: "Yes, delete my account" }).click();
	await page.waitForURL(SIGN_IN_URL_RE, { timeout: 15_000 });
}

/**
 * Best-effort version of deleteThrowawayAccount for a `finally` block that
 * may run after signUpThrowawayUser itself failed partway (e.g. mid
 * onboarding) : in that case there's no session to delete, and letting a
 * cleanup failure throw here would replace the real test failure with a
 * confusing secondary one. Swallows errors (logging them) rather than
 * throwing; a genuine cleanup miss still leaves a throwaway user behind on
 * the (disposable, isolated : see .env.test) test DB, which is a cosmetic
 * annoyance there, not a leaked resource on a real instance.
 */
export async function cleanUpThrowawayAccount(page: Page, password: string) {
	if (page.url().includes("/auth/sign-in")) {
		return; // never got a session : nothing to delete
	}
	try {
		await deleteThrowawayAccount(page, password);
	} catch (err) {
		console.warn("cleanUpThrowawayAccount: best-effort cleanup failed:", err);
	}
}

export interface BasicServiceInput {
	containerPort: string;
	image: string;
	name: string;
	slug: string;
	tag: string;
}

/**
 * Fills and submits the services/new wizard's minimum viable
 * "bring-your-own-image" path and returns to /services. `name`/`slug`/
 * `image`/`tag` live on step 1 ("Basic info"); `containerPort` lives on
 * step 2 ("Networking") : both are hidden (`class:hidden`, not `{#if}`)
 * rather than unmounted while on the wrong step, but a hidden field can't
 * be `fill()`-ed, so this clicks "Next" between them rather than filling
 * every field up front. Steps 3/4 (Environment/Compute) have no required
 * fields, so clicking through them with no input is enough to reach the
 * real submit button ("Create service", only rendered on the last step).
 *
 * On success the `create` action redirects to `/projects/<projectId>` when
 * `projectId` was passed (back to the project it was created under),
 * otherwise to `/services` : not always the latter.
 */
export async function createBasicService(
	page: Page,
	input: BasicServiceInput,
	{ projectId }: { projectId?: string } = {},
) {
	await page.goto(
		projectId ? `/services/new?projectId=${projectId}` : "/services/new",
	);
	await page.locator("#name").fill(input.name);
	// The slug field auto-derives from name via an oninput handler, which
	// Playwright's fill() doesn't reliably trigger : fill it explicitly.
	await page.locator("#slug").fill(input.slug);
	await page.locator("#image").fill(input.image);
	await page.locator("#tag").fill(input.tag);
	await page.getByRole("button", { exact: true, name: "Next" }).click(); // → Networking
	await page.locator("#containerPort").fill(input.containerPort);
	await page.getByRole("button", { exact: true, name: "Next" }).click(); // → Environment
	await page.getByRole("button", { exact: true, name: "Next" }).click(); // → Compute
	await page.getByRole("button", { name: "Create service" }).click();
	await page.waitForURL(projectId ? `/projects/${projectId}` : "/services", {
		timeout: 15_000,
	});
}

export interface PageErrors {
	consoleErrors: string[];
	pageErrors: string[];
}

/**
 * Attaches listeners that record console.error() calls and uncaught
 * client-side exceptions for the rest of this page's life. Attach before
 * navigating, then assert both arrays are empty after the page settles.
 * A fresh instance per page/test : listeners aren't reset between calls.
 */
export function collectPageErrors(page: Page): PageErrors {
	const errors: PageErrors = { consoleErrors: [], pageErrors: [] };
	page.on("console", (msg) => {
		if (msg.type() === "error") {
			errors.consoleErrors.push(msg.text());
		}
	});
	page.on("pageerror", (err) => {
		errors.pageErrors.push(err.message);
	});
	return errors;
}

/**
 * True if the page is showing this app's own SvelteKit error boundary
 * (src/lib/components/error-page.svelte) rather than real content : that
 * component renders the HTTP status as a lone, large numeric heading.
 * Cheap way to catch a route that 404s/500s but doesn't otherwise throw a
 * console/page error worth failing on by itself.
 */
const HTTP_STATUS_HEADING_RE = /^\d{3}$/;

export async function isOnErrorPage(page: Page): Promise<boolean> {
	return await page
		.locator("h1", { hasText: HTTP_STATUS_HEADING_RE })
		.first()
		.isVisible()
		.catch(() => false);
}
