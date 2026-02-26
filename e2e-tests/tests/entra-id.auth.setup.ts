import { test as setup, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { loginWithEntraId, getScenarioData } from "./shared";

const authFile = "playwright/.auth/entra-id.json";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseScenarioDataFromToml(
  tomlContent: string,
): Record<string, string> | null {
  const scenarioDataMatch = tomlContent.match(
    /SCENARIO_DATA\s*=\s*\{([^}]+)\}/,
  );
  if (!scenarioDataMatch) {
    return null;
  }

  const inlineTableContent = scenarioDataMatch[1];
  const data: Record<string, string> = {};

  const keyValuePairs = inlineTableContent.split(",");
  for (const pair of keyValuePairs) {
    const [key, value] = pair.split("=").map((s) => s.trim());
    if (key && value) {
      data[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  return Object.keys(data).length > 0 ? data : null;
}

async function getScenarioDataLocalFallback(
  scenarioName: string,
): Promise<Record<string, string> | null> {
  const autoTomlPath = path.resolve(
    __dirname,
    `../../infrastructure/k3d/erato-local/config/erato.scenario-${scenarioName}.auto.toml`,
  );

  if (!fs.existsSync(autoTomlPath)) {
    console.warn(
      `[ENTRA_ID_AUTH_SETUP] Local scenario data file not found: ${autoTomlPath}`,
    );
    return null;
  }

  try {
    const tomlContent = fs.readFileSync(autoTomlPath, "utf-8");
    const parsed = parseScenarioDataFromToml(tomlContent);
    if (!parsed) {
      console.warn(
        `[ENTRA_ID_AUTH_SETUP] SCENARIO_DATA not found in local file: ${autoTomlPath}`,
      );
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn(
      `[ENTRA_ID_AUTH_SETUP] Failed reading local scenario data file: ${error}`,
    );
    return null;
  }
}

/**
 * Authentication setup for Entra ID scenario.
 * This performs Entra ID authentication and saves the session state
 * for reuse in tests.
 */
setup("authenticate with Entra ID", async ({ page }) => {
  // Navigate to the app
  await page.goto("/");

  // Try in-cluster scenario-data first.
  let scenarioData = await getScenarioData(page);

  // Local fallback for out-of-cluster setup:
  // read the currently active scenario's local auto TOML.
  if (!scenarioData) {
    const scenarioName = await page.evaluate(() => {
      return (window as { K3D_TEST_SCENARIO?: string }).K3D_TEST_SCENARIO;
    });
    const effectiveScenario = scenarioName || "entra_id";
    scenarioData = await getScenarioDataLocalFallback(effectiveScenario);
  }

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

  // Inject scenario data for this setup run to make it available in local/out-of-cluster mode.
  await page.addInitScript((data) => {
    (window as { SCENARIO_DATA?: Record<string, string> }).SCENARIO_DATA = data;
  }, scenarioData);

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
