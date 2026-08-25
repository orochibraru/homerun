import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL } from "./tests/e2e/support/config";

/**
 * This repo's E2E suite (see tests/e2e/README.md for what's covered and
 * why this exists at all, given `tests/integration/README.md`'s own note
 * that a prior session removed the previous harness deliberately). Only one
 * worker: `global-setup.ts` boots one real app against one real fixed port
 * (see support/config.ts's own comment on why the port is fixed), so tests
 * in this suite share live server state across files rather than each
 * getting an isolated instance — write specs with that in mind (a fresh
 * account per spec file, not a shared fixture account, is the safe default).
 */
export default defineConfig({
	fullyParallel: false,
	globalSetup: "./tests/e2e/support/global-setup.ts",
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	reporter: "list",
	retries: 0,
	testDir: "./tests/e2e",
	timeout: 30_000,
	use: {
		baseURL: E2E_BASE_URL,
		trace: "retain-on-failure",
	},
	workers: 1,
});
