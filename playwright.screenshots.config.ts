import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL } from "./tests/e2e/support/config";

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
	testDir: "./tests/e2e/screenshots",
	timeout: 180_000,
	use: {
		baseURL: E2E_BASE_URL,
		trace: "retain-on-failure",
		viewport: { height: 900, width: 1440 },
	},
	workers: 1,
});
