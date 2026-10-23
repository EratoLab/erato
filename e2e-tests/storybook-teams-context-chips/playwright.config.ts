import { defineConfig, devices } from "@playwright/test";

// Standalone harness against a running Storybook; deliberately outside
// `tests/` so the scenario projects in ../playwright.config.ts never pick it
// up.
export default defineConfig({
  testDir: ".",
  outputDir: "../test-results/storybook-teams-context-chips",
  reporter: "list",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.STORYBOOK_URL ?? "http://localhost:6304",
    // The picked messages' times are read back as written.
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
