import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { loginWithEntraId, getScenarioData } from "./shared";
import { TAG_CI } from "./tags";

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
    return null;
  }

  try {
    const tomlContent = fs.readFileSync(autoTomlPath, "utf-8");
    return parseScenarioDataFromToml(tomlContent);
  } catch {
    return null;
  }
}

async function getScenarioDataWithFallback(page: Page) {
  let scenarioData = await getScenarioData(page);

  if (!scenarioData) {
    const scenarioName = await page.evaluate(() => {
      return (window as { K3D_TEST_SCENARIO?: string }).K3D_TEST_SCENARIO;
    });
    const effectiveScenario = scenarioName || "entra_id";
    scenarioData = await getScenarioDataLocalFallback(effectiveScenario);
  }

  if (scenarioData) {
    await page.addInitScript((data) => {
      (window as { SCENARIO_DATA?: Record<string, string> }).SCENARIO_DATA =
        data;
    }, scenarioData);
  }

  return scenarioData;
}

/**
 * Entra ID authentication tests
 * These tests require the entra_id scenario to be deployed with valid
 * Azure Entra ID credentials configured in e2e-secrets.toml
 */

test(
  "Can login & logout with Entra ID",
  { tag: TAG_CI },
  async ({ browser }) => {
    // Use a fresh context without saved auth state for login testing
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    // Navigate to the app
    await page.goto("/");

    // Get scenario data containing test user credentials
    const scenarioData = await getScenarioDataWithFallback(page);

    // Verify scenario data is available
    expect(scenarioData).toBeTruthy();
    expect(scenarioData?.entraid_user1_email).toBeTruthy();
    expect(scenarioData?.entraid_user1_password).toBeTruthy();

    console.log(
      `[ENTRA_ID_AUTH_TEST] Logging in with user1: ${scenarioData!.entraid_user1_email}`,
    );

    // Perform Entra ID login
    await loginWithEntraId(
      page,
      scenarioData!.entraid_user1_email,
      scenarioData!.entraid_user1_password,
    );

    // Verify successful login by checking for the chat interface
    await expect(
      page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeVisible({ timeout: 15000 });

    // Verify the textbox is enabled and ready for interaction
    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeEnabled({ timeout: 10000 });

    console.log("[ENTRA_ID_AUTH_TEST] ✅ Successfully logged in with Entra ID");

    // Now logout
    await page.getByRole("button", { name: "expand sidebar" }).click();
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Open menu" })
      .click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    // Verify logout by checking for the sign in button
    await expect(
      page.getByRole("button", { name: "Sign in with" }),
    ).toBeVisible({ timeout: 10000 });

    console.log("[ENTRA_ID_AUTH_TEST] ✅ Successfully logged out");

    await context.close();
  },
);
