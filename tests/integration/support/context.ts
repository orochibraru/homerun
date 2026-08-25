import { makeApiClient } from "./client";
import type { IntegrationContext } from "./setup";

const globalForIntegration = globalThis as unknown as {
	__integration_ctx?: IntegrationContext;
};

/** Reads the shared state setup.ts's global `beforeAll` (registered via bunfig.toml's preload) set up once for the whole run. Throws with a clear message if a test file is somehow run without that hook having fired, rather than a confusing "undefined" failure deep in a request. */
export function integrationContext(): IntegrationContext {
	const ctx = globalForIntegration.__integration_ctx;
	if (!ctx) {
		throw new Error(
			"Integration context not initialized : this only fills in once tests/integration/support/setup.ts's global beforeAll (wired into bunfig.toml's [test].preload) has actually run, which needs `bun test` to include at least one tests/integration/*.test.ts file.",
		);
	}
	return ctx;
}

/** A freshly constructed API client, authenticated as the bootstrap admin. Deliberately not memoized/hoisted to module scope by callers : integrationContext() only resolves once the global beforeAll has run, which is *after* every test file's own top-level code executes (bun:test collects/imports every file before running any hook) — call this from inside a test/beforeAll/describe callback, never at a test file's own module top level. */
export function apiClient() {
	const ctx = integrationContext();
	return makeApiClient(ctx.apiKey, ctx.origin);
}
