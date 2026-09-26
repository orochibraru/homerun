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
		{ name: "setup", testMatch: /setup\.ts$/ },
		{
			dependencies: ["setup"],
			name: "templates",
			testMatch: /deploy\.spec\.ts$/,
			use: { ...devices["Desktop Chrome"] },
		},
	],
	reporter: [["list"], ["./tests/e2e/templates/report.ts"]],
	retries: 1,
	testDir: "./tests/e2e/templates",
	timeout: 30 * 60_000,
	use: {
		baseURL: E2E_BASE_URL,
		trace: "retain-on-failure",
	},
	workers: Number(process.env.TEMPLATES_E2E_WORKERS ?? 3),
});
