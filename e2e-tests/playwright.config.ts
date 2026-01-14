import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
dotenv.config({ path: ".env" });

const buildBaseUrl = async () => {
  const url = process.env.BASE_URL;
  if (url) {
    return url;
  } else {
    console.warn(
      "BASE_URL environment variable is not set. Using http://localhost:4180 as default",
    );
    return "http://localhost:4180";
  }
};

const baseUrl = await buildBaseUrl();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: baseUrl,
    ignoreHTTPSErrors: baseUrl === "https://app.erato.internal",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
    contextOptions: {
      // Required for our local auth setup
      // permissions: ['http://0.0.0.0:*/*']
    },
  },

  /* Configure projects for major browsers */
  /* Projects are organized by test scenario with dedicated setup projects.
   * Each scenario has its own setup project that switches to the required k3d scenario.
   * Tests depend on their scenario's setup project to ensure the correct environment.
   */
  projects: [
    // Authentication setup - runs first
    { name: "setup", testMatch: /\/auth\.setup\.ts/ },

    // Scenario setup projects
    {
      name: "setup-basic",
      testMatch: /basic\.setup\.ts/,
      use: {
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "setup-tight-budget",
      testMatch: /tight-budget\.setup\.ts/,
      use: {
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "setup-assistants",
      testMatch: /assistants\.setup\.ts/,
      use: {
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },

    // Entra ID authentication setup - runs independently using Entra ID credentials
    { name: "setup-entra-id-auth", testMatch: /entra-id\.auth\.setup\.ts/ },

    // Entra ID scenario setup - switches to entra-id scenario
    {
      name: "setup-entra-id",
      testMatch: /entra-id\.setup\.ts/,
      use: {
        storageState: "playwright/.auth/entra-id.json",
      },
      dependencies: ["setup-entra-id-auth"],
    },

    // Chromium - Basic scenario tests
    {
      name: "chromium-basic",
      testIgnore: [
        /.*\.assistants\.spec\.ts$/,
        /.*\.entra-id\.spec\.ts$/,
        /.*\.tight-budget\.spec\.ts$/,
      ],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup-basic"],
    },

    // Chromium - Tight-budget scenario tests
    {
      name: "chromium-tight-budget",
      testMatch: /.*\.tight-budget\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup-tight-budget"],
    },

    // Chromium - Assistants scenario tests
    {
      name: "chromium-assistants",
      testMatch: /.*\.assistants\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup-assistants"],
    },

    // Firefox - Basic scenario tests
    {
      name: "firefox-basic",

      testIgnore: [
        /.*\.assistants\.spec\.ts$/,
        /.*\.entra-id\.spec\.ts$/,
        /.*\.tight-budget\.spec\.ts$/,
      ],
      use: {
        ...devices["Desktop Firefox"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup-basic"],
    },

    // Firefox - Tight-budget scenario tests
    {
      name: "firefox-tight-budget",
      testMatch: /.*\.tight-budget\.spec\.ts$/,
      use: {
        ...devices["Desktop Firefox"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup-tight-budget"],
    },

    // Firefox - Assistants scenario tests
    {
      name: "firefox-assistants",
      testMatch: /.*\.assistants\.spec\.ts$/,
      use: {
        ...devices["Desktop Firefox"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup-assistants"],
    },

    // Chromium - Entra ID scenario tests
    {
      name: "chromium-entra-id",
      testMatch: /.*\.entra-id\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/entra-id.json",
      },
      dependencies: ["setup-entra-id"],
    },

    // Firefox - Entra ID scenario tests
    {
      name: "firefox-entra-id",
      testMatch: /.*\.entra-id\.spec\.ts$/,
      use: {
        ...devices["Desktop Firefox"],
        storageState: "playwright/.auth/entra-id.json",
      },
      dependencies: ["setup-entra-id"],
    },

    // TODO: Currently deactivated, because there are issues with using `0.0.0.0` as host during auth flow
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
