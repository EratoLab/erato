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

const browsers = [
  { name: "chromium", device: devices["Desktop Chrome"] },
  { name: "firefox", device: devices["Desktop Firefox"] },
];

const standardScenarios = [
  { name: "basic", storageState: "playwright/.auth/user.json" },
  { name: "tight-budget", storageState: "playwright/.auth/user.json" },
  { name: "assistants", storageState: "playwright/.auth/user.json" },
  { name: "many-models", storageState: "playwright/.auth/user.json" },
];

const entraIdScenario = {
  name: "entra-id",
  storageState: "playwright/.auth/entra-id.json",
  setupDependency: "setup-entra-id",
};

const buildScenarioSetupProjects = (
  scenarios: Array<{ name: string; storageState: string }>,
) =>
  scenarios.map((scenario) => ({
    name: `setup-${scenario.name}`,
    testMatch: new RegExp(`${scenario.name}\\.setup\\.ts`),
    use: {
      storageState: scenario.storageState,
    },
    dependencies: ["setup"],
  }));

const buildScenarioProjects = ({
  scenarioName,
  storageState,
  setupDependency,
}: {
  scenarioName: string;
  storageState: string;
  setupDependency: string;
}) =>
  browsers.map((browser) => ({
    name: `${browser.name}-${scenarioName}`,
    testMatch: new RegExp(`.*\\.${scenarioName}\\.spec\\.ts$`),
    use: {
      ...browser.device,
      storageState,
    },
    dependencies: [setupDependency],
  }));

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
    ...buildScenarioSetupProjects(standardScenarios),

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

    ...standardScenarios.flatMap((scenario) =>
      buildScenarioProjects({
        scenarioName: scenario.name,
        storageState: scenario.storageState,
        setupDependency: `setup-${scenario.name}`,
      }),
    ),
    ...buildScenarioProjects({
      scenarioName: entraIdScenario.name,
      storageState: entraIdScenario.storageState,
      setupDependency: entraIdScenario.setupDependency,
    }),

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
