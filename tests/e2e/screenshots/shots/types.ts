import type { Page } from "@playwright/test";
import { E2E_BASE_URL } from "../../support/config";

/** What the screenshot run seeded before any feature shot: the Acme stack and its services by slug (`web`, `cache`, `api`). */
export interface Seeded {
	serviceIds: Record<string, string>;
	stackId: string | null;
}

/** One screenshot: the page to open, text proving it rendered, and anything to click before capturing. */
export interface Shot {
	doc: string;
	expect: RegExp;
	name: string;
	path: (seeded: Seeded) => string;
	prepare?: (page: Page, seeded: Seeded) => Promise<void>;
}

/** A doc area's screenshots, with the state they need created once, after the base seed and before any capture. */
export interface ShotModule {
	setup?: (page: Page, seeded: Seeded) => Promise<void>;
	shots: Shot[];
}

/** Submits a SvelteKit form action the way the dashboard's own forms do, failing loudly when it's refused. */
export async function postAction(
	page: Page,
	path: string,
	form: Record<string, string>,
): Promise<unknown> {
	const res = await page.request.post(path, {
		form,
		headers: { origin: E2E_BASE_URL, "x-sveltekit-action": "true" },
	});
	const body = await res.json();
	if (!res.ok() || body.type === "failure" || body.type === "error") {
		throw new Error(`${path} refused: ${res.status()} ${JSON.stringify(body)}`);
	}
	return body;
}
