import { test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

const patched = new WeakSet<Page>();

/**
 * Makes `goto` and `reload` on `page` also wait until the app has hydrated
 * (the root layout sets `<html data-hydrated>` on mount), so a test never types
 * into or presses keys on server-rendered markup whose handlers aren't attached
 * yet. A page that isn't this app's (no `data-sveltekit-preload-data` body) is
 * left alone.
 */
export function waitForHydration(page: Page): void {
	if (patched.has(page)) {
		return;
	}
	patched.add(page);
	const hydrated = () =>
		page.waitForFunction(
			() =>
				!document.body?.hasAttribute("data-sveltekit-preload-data") ||
				document.documentElement.dataset.hydrated !== undefined,
		);
	const goto = page.goto.bind(page);
	const reload = page.reload.bind(page);
	page.goto = async (...args) => {
		const response = await goto(...args);
		await hydrated();
		return response;
	};
	page.reload = async (...args) => {
		const response = await reload(...args);
		await hydrated();
		return response;
	};
}

export const test = base.extend<object, object>({
	browser: [
		async ({ browser }, use) => {
			const newContext = browser.newContext.bind(browser);
			const newPage = browser.newPage.bind(browser);
			browser.newContext = async (...args) => {
				const context = await newContext(...args);
				context.on("page", waitForHydration);
				return context;
			};
			browser.newPage = async (...args) => {
				const page = await newPage(...args);
				waitForHydration(page);
				return page;
			};
			await use(browser);
		},
		{ scope: "worker" },
	],
	context: async ({ context }, use) => {
		for (const page of context.pages()) {
			waitForHydration(page);
		}
		context.on("page", waitForHydration);
		await use(context);
	},
});
