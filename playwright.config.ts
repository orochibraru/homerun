import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: false, // these tests hit real Docker/DB state — keep them serial
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: "list",
  retries: 0,
  testDir: "./e2e",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev",
    reuseExistingServer: true,
    timeout: 30_000,
    url: "http://localhost:5173",
  },
  workers: 1,
});
