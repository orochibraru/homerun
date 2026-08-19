import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false, // these tests hit real Docker/DB state — keep them serial
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 1,
	reporter: "list",
	timeout: 90_000,
	use: {
		baseURL: "http://localhost:5173",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "bun run dev",
		url: "http://localhost:5173",
		reuseExistingServer: true,
		timeout: 30_000,
	},
});
