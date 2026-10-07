import { defineConfig } from "@playwright/test";
import { getBaseURL } from "./tests-e2e/global-setup.js";

/**
 * Playwright config for the DFW Tee-Times Worker.
 *
 * Run with: `npx playwright test`
 *
 * Requires a wrangler dev instance running at $PLAYWRIGHT_BASE_URL
 * (set automatically by global-setup, or override for staging).
 */
export default defineConfig({
  testDir: "./tests-e2e",
  // One worker process, serial — wrangler dev is single-tenant.
  workers: 1,
  fullyParallel: false,
  // Give wrangler dev time to start and pages to hydrate
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8788",
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});