/**
 * Thin Playwright-shaped convenience layer over Bun.WebView (Bun 1.4+),
 * this suite's browser-automation primitive since it replaced
 * @playwright/test. Bun.WebView itself only gives you `navigate`,
 * `evaluate`, CSS-selector `click`/`scrollTo`, and `type`-into-focused-
 * element — no `getByRole`/`getByText` locators, no Response object with a
 * status code, no dialog event, no built-in pushState-navigation wait. This
 * module exists to fill exactly those gaps once, here, rather than every
 * spec reinventing them.
 *
 * Backend is pinned to `"chrome"` rather than the default `"webkit"`:
 * `"webkit"` only runs on macOS, and Chrome/CDP is what unlocks
 * `Network.responseReceived` (HTTP status per navigation) and
 * `Runtime.exceptionThrown` (uncaught client exceptions) — both used below.
 * This also keeps dev (macOS) and CI (Linux) on the same rendering engine,
 * which WebKit-vs-Chrome would not.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 150;

/**
 * The isolated e2e instance's fixed host:port — see e2e/run.ts's own
 * comment for why this is a dedicated, unusual port bound explicitly to
 * 127.0.0.1 rather than the dev server's normal :5173. Exported so run.ts
 * and every spec agree on one value; overridable via E2E_BASE_URL for a
 * one-off manual run against a server started by hand.
 */
export const DEFAULT_BASE_URL = "http://127.0.0.1:43117";

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeException(data: {
	exceptionDetails?: { text?: string; exception?: { description?: string } };
}): string {
	const details = data.exceptionDetails;
	return (
		details?.exception?.description ?? details?.text ?? JSON.stringify(data)
	);
}

interface FrameTreeResult {
	frameTree: { frame: { id: string } };
}

interface NetworkResponseReceivedEvent {
	data: {
		frameId: string;
		type: string;
		response: { status: number };
	};
}

interface RuntimeExceptionThrownEvent {
	data: {
		exceptionDetails?: { text?: string; exception?: { description?: string } };
	};
}

/**
 * True if the page is showing this app's own SvelteKit error boundary
 * (src/lib/components/error-page.svelte) rather than real content — that
 * component renders the HTTP status as a lone, large numeric heading.
 */
const HTTP_STATUS_HEADING_RE = /^\d{3}$/;

/** One browser tab, isolated from every other `Page` (own cookie jar, own DOM). */
export class Page {
	readonly consoleErrors: string[] = [];
	readonly pageErrors: string[] = [];
	private readonly view: Bun.WebView;
	private readonly baseURL: string;
	private mainFrameId?: string;
	private lastDocStatus: number | undefined;

	private constructor(view: Bun.WebView, baseURL: string) {
		this.view = view;
		this.baseURL = baseURL;
	}

	static async create(baseURL: string = DEFAULT_BASE_URL): Promise<Page> {
		const page = new Page(
			new Bun.WebView({
				backend: "chrome",
				console: (type, ...args) => {
					if (type === "error") {
						page.consoleErrors.push(args.map(String).join(" "));
					}
				},
				height: 900,
				width: 1280,
			}),
			baseURL,
		);

		// The first navigate() establishes the CDP session `cdp()`/
		// `addEventListener()` need — see Bun.WebView's own docs on this.
		await page.view.navigate(baseURL);
		await page.view.cdp("Network.enable");
		await page.view.cdp("Runtime.enable");
		// Persists across every later navigation on this view (unlike a plain
		// evaluate(), which only affects the current document) — this is what
		// makes every native confirm()/alert() in this suite auto-accept
		// without a per-click dialog handler, Playwright-style.
		await page.view.cdp("Page.addScriptToEvaluateOnNewDocument", {
			source: "window.confirm = () => true; window.alert = () => {};",
		});
		const { frameTree } =
			await page.view.cdp<FrameTreeResult>("Page.getFrameTree");
		page.mainFrameId = frameTree.frame.id;

		page.view.addEventListener(
			"Network.responseReceived",
			(e: NetworkResponseReceivedEvent) => {
				if (e.data.frameId === page.mainFrameId && e.data.type === "Document") {
					page.lastDocStatus = e.data.response.status;
				}
			},
		);
		page.view.addEventListener(
			"Runtime.exceptionThrown",
			(e: RuntimeExceptionThrownEvent) => {
				page.pageErrors.push(describeException(e.data));
			},
		);

		return page;
	}

	/** Absolute pathname of the page's current URL (real navigation or pushState alike). */
	pathname(): Promise<string> {
		return this.view.evaluate<string>("location.pathname");
	}

	/**
	 * Navigate to a full page load and report the main document's HTTP
	 * status (`undefined` if the CDP event never fired in time — treat that
	 * as "couldn't determine", not as a pass).
	 */
	async goto(path: string): Promise<{ status: number | undefined }> {
		this.lastDocStatus = undefined;
		const url = path.startsWith("http") ? path : `${this.baseURL}${path}`;
		await this.view.navigate(url);
		return { status: this.lastDocStatus };
	}

	/**
	 * Fill a text input/textarea matched by a CSS selector (e.g. `"#email"`).
	 * Selects any existing value first — `type()` only inserts at the
	 * cursor, so a field with a pre-filled default (e.g. the tag field
	 * defaulting to `"latest"`) would otherwise end up with the new text
	 * merged into the old (`"latestalpine"`), not replacing it.
	 */
	async fill(selector: string, text: string, opts?: { timeoutMs?: number }) {
		await this.view.click(selector, { timeout: opts?.timeoutMs });
		await this.view.evaluate(
			`document.querySelector(${JSON.stringify(selector)})?.select()`,
		);
		await this.view.type(text);
	}

	/** Click the element matched by a CSS selector, scrolling it into view first. */
	async click(selector: string, opts?: { timeoutMs?: number }) {
		const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		await this.view.scrollTo(selector, { timeout }).catch(() => undefined);
		await this.view.click(selector, { timeout });
	}

	/**
	 * Click the first `<tag>` (optionally scoped inside `within`, a CSS
	 * selector for an ancestor container) whose trimmed textContent exactly
	 * matches `text` — the CSS-selector equivalent of Playwright's
	 * `getByRole(tag, { name: text }).click()`. Matching is substring by
	 * default (`opts.exact` for strict equality) — most of this app's
	 * button labels carry a decorative trailing icon/arrow as plain text
	 * (e.g. a submit button's real textContent is `"Create account →"`),
	 * which is exactly what Playwright's own non-exact `getByRole` name
	 * matching tolerated too. Polls for the element to exist (content is
	 * often still rendering right after a prior navigation/action) before
	 * handing off to the actionability-aware `click()` above.
	 */
	async clickText(
		tag: string,
		text: string,
		opts?: { within?: string; timeoutMs?: number; exact?: boolean },
	) {
		const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const deadline = Date.now() + timeout;
		const marker = `e2e-${Math.random().toString(36).slice(2, 10)}`;
		const scopeSelector = opts?.within ? `${opts.within} ${tag}` : tag;
		const exact = opts?.exact ?? false;

		let found = false;
		while (Date.now() < deadline) {
			found = await this.view.evaluate<boolean>(`(() => {
				const scope = document.querySelectorAll(${JSON.stringify(scopeSelector)});
				const match = [...scope].find((el) => {
					const t = el.textContent.trim();
					return ${JSON.stringify(exact)} ? t === ${JSON.stringify(text)} : t.includes(${JSON.stringify(text)});
				});
				if (!match) return false;
				match.setAttribute("data-e2e-mark", ${JSON.stringify(marker)});
				return true;
			})()`);
			if (found) {
				break;
			}
			await sleep(POLL_INTERVAL_MS);
		}
		if (!found) {
			throw new Error(
				`clickText: no <${tag}>${opts?.within ? ` within ${opts.within}` : ""} with text "${text}" found within ${timeout}ms`,
			);
		}
		await this.click(`[data-e2e-mark="${marker}"]`, {
			timeoutMs: Math.max(1000, deadline - Date.now()),
		});
	}

	/**
	 * Poll `document.body.innerText` (layout-aware — unlike textContent it
	 * excludes display:none/visibility:hidden content) for a substring or
	 * regex match. The Bun.WebView equivalent of
	 * `expect(page.getByText(text)).toBeVisible()`.
	 */
	async waitForText(
		match: string | RegExp,
		opts?: { timeoutMs?: number; within?: string },
	): Promise<boolean> {
		const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const deadline = Date.now() + timeout;
		const scopeSelector = opts?.within ?? "body";
		while (Date.now() < deadline) {
			const text = await this.view.evaluate<string>(
				`document.querySelector(${JSON.stringify(scopeSelector)})?.innerText ?? ""`,
			);
			const hit =
				typeof match === "string" ? text.includes(match) : match.test(text);
			if (hit) {
				return true;
			}
			await sleep(POLL_INTERVAL_MS);
		}
		return false;
	}

	/** Poll until `document.body.innerText` (or `within`'s) stops containing `text`. */
	async waitForTextGone(
		text: string,
		opts?: { timeoutMs?: number; within?: string },
	): Promise<boolean> {
		const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const deadline = Date.now() + timeout;
		const scopeSelector = opts?.within ?? "body";
		while (Date.now() < deadline) {
			const body = await this.view.evaluate<string>(
				`document.querySelector(${JSON.stringify(scopeSelector)})?.innerText ?? ""`,
			);
			if (!body.includes(text)) {
				return true;
			}
			await sleep(POLL_INTERVAL_MS);
		}
		return false;
	}

	/**
	 * Poll `location.pathname` for a match — the Bun.WebView equivalent of
	 * Playwright's `waitForURL()`. Necessary because SvelteKit's
	 * client-side (pushState) navigations never fire a
	 * `WKNavigationDelegate`-style "navigation finished" event, so
	 * `view.navigate()`/`onNavigated` never resolve/fire for them.
	 */
	async waitForPath(
		match: RegExp | string,
		opts?: { timeoutMs?: number },
	): Promise<string> {
		const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const deadline = Date.now() + timeout;
		let path = await this.pathname();
		while (Date.now() < deadline) {
			const hit = typeof match === "string" ? path === match : match.test(path);
			if (hit) {
				return path;
			}
			await sleep(POLL_INTERVAL_MS);
			path = await this.pathname();
		}
		throw new Error(
			`waitForPath: pathname never matched ${match} within ${timeout}ms (last seen: ${path})`,
		);
	}

	async isOnErrorPage(): Promise<boolean> {
		return await this.view.evaluate<boolean>(`(() => {
			const h1 = document.querySelector("h1");
			return !!h1 && ${HTTP_STATUS_HEADING_RE.toString()}.test(h1.textContent.trim());
		})()`);
	}

	async close() {
		this.view.close();
	}
}
