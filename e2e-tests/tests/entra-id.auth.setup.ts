import { test as setup, expect } from "@playwright/test";
import { loginWithEntraId, getScenarioData } from "./shared";

const authFile = "playwright/.auth/entra-id.json";

/**
 * Authentication setup for Entra ID scenario.
 * This performs Entra ID authentication and saves the session state
 * for reuse in tests.
 */
setup("authenticate with Entra ID", async ({ page }) => {
  // Navigate to the app
  await page.goto("/");

  // Get scenario data containing test user credentials
  const scenarioData = await getScenarioData(page);

  // Verify scenario data is available
  if (
    !scenarioData?.entraid_user1_email ||
    !scenarioData?.entraid_user1_password
  ) {
    throw new Error(
      "Entra ID credentials not found in SCENARIO_DATA. " +
        "Make sure the entra_id scenario is deployed and e2e-secrets.toml is configured.",
    );
  }

  console.log(
    `[ENTRA_ID_AUTH_SETUP] Authenticating with user1: ${scenarioData.entraid_user1_email}`,
  );

  // Perform Entra ID authentication
  await loginWithEntraId(
    page,
    scenarioData.entraid_user1_email,
    scenarioData.entraid_user1_password,
  );

  // Wait until the page is ready with extended timeout for auth flow
  await expect(
    page.getByRole("textbox", { name: "Type a message..." }),
  ).toBeVisible({ timeout: 15000 });

  // Verify page is actually ready for interaction
  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await expect(textbox).toBeEnabled({ timeout: 10000 });

  console.log("[ENTRA_ID_AUTH_SETUP] ✅ Authentication complete, saving state");

  // Save authenticated state
  await page.context().storageState({ path: authFile });
});
