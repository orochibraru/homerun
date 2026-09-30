import process from "node:process";
import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL } from "./tests/e2e/support/config";

export default defineConfig({
	fullyParallel: true,
	globalSetup: [
		"./tests/e2e/support/global-setup.ts",
		"./tests/e2e/templates/traefik.ts",
	],
	projects: [
		{
			name: "setup",
			retries: 2,
			testMatch: /setup\.ts$/,
			timeout: 3 * 60_000,
		},
		{
			dependencies: ["setup"],
			name: "templates",
			testMatch: /deploy\.spec\.ts$/,
			use: { ...devices["Desktop Chrome"] },
		},
	],
	reporter: [["list"], ["./tests/e2e/templates/report.ts"]],
	retries: 0,
	testDir: "./tests/e2e/templates",
	timeout: 20 * 60_000,
	use: {
		actionTimeout: 30_000,
		baseURL: E2E_BASE_URL,
		navigationTimeout: 60_000,
		trace: "retain-on-failure",
	},
	workers: Number(process.env.TEMPLATES_E2E_WORKERS ?? 3),
});
