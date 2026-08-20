// One-off verification config, NOT committed. Points Playwright at a
// manually-started, isolated dev server on an alternate port (the real
// dev server on 5173 belongs to the maintainer and must not be touched).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: "list",
  retries: 0,
  testDir: "./e2e",
  timeout: 180_000,
  use: {
    baseURL: "http://localhost:5199",
    trace: "retain-on-failure",
  },
  workers: 1,
});
