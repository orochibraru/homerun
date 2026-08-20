import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	forbidOnly: !!process.env.CI,
	fullyParallel: false, // these tests hit real Docker/DB state : keep them serial
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	reporter: "list",
	retries: 0,
	testDir: "./e2e",
	timeout: 180_000, // real Docker image pull + container start, not mocked
	use: {
		baseURL: "http://localhost:5173",
		trace: "retain-on-failure",
	},
	webServer: {
		// NODE_ENV=test makes Bun load .env.test (DATABASE_URL pointing at a
		// separate homerun_test database) on top of .env, so every e2e run
		// hits its own disposable Postgres database rather than the
		// maintainer's real one. reuseExistingServer is
		// deliberately false, even outside CI : true would let this suite
		// silently attach to whatever's already listening on 5173 (e.g. the
		// maintainer's own `bun run dev`, backed by the real DB) instead of
		// spinning up the isolated instance below; failing loudly with
		// EADDRINUSE if that port's taken is the safer failure mode.
		command: "NODE_ENV=test bun run dev",
		reuseExistingServer: false,
		timeout: 30_000,
		url: "http://localhost:5173",
	},
	workers: 1,
});
