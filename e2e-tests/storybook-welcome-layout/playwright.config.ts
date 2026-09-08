import { defineConfig, devices } from "@playwright/test";

// Standalone geometry harness against a running Storybook; deliberately
// outside `tests/` so the scenario projects in ../playwright.config.ts never
// pick it up.
export default defineConfig({
  testDir: ".",
  outputDir: "../test-results/storybook-welcome-layout",
  reporter: "list",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.STORYBOOK_URL ?? "http://localhost:6136",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
