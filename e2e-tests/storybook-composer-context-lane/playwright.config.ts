import { defineConfig, devices } from "@playwright/test";

// Standalone harness against a running Storybook; deliberately outside
// `tests/` so the scenario projects in ../playwright.config.ts never pick it
// up.
export default defineConfig({
  testDir: ".",
  outputDir: "../test-results/storybook-composer-context-lane",
  reporter: "list",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.STORYBOOK_URL ?? "http://localhost:6301",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
