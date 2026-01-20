import { expect, Page, Browser, test } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const login = async (page: Page, email: string, password = "admin") => {
  await page.getByRole("button", { name: "Sign in with" }).click();
  await page.waitForURL((url) => url.pathname.includes("auth"));
  await page.getByRole("textbox", { name: "email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("textbox", { name: "Password" }).press("Enter");
  await page.getByRole("button", { name: "Grant Access" }).click();
};

/**
 * Login via Azure Entra ID (Microsoft) authentication
 * This handles the Microsoft login flow which redirects to login.microsoftonline.com
 */
export const loginWithEntraId = async (
  page: Page,
  email: string,
  password: string,
) => {
  console.log(`[ENTRA_ID_LOGIN] Starting Entra ID login for: ${email}`);

  await page.getByRole("button", { name: "Sign in with" }).click();

  // Wait for redirect to Microsoft login page
  await page.waitForURL(
    (url) => url.hostname.includes("login.microsoftonline.com"),
    {
      timeout: 10000,
    },
  );
  console.log(`[ENTRA_ID_LOGIN] Redirected to Microsoft login page`);

  // Fill in email
  const emailInput = page.getByPlaceholder("Email, phone, or Skype");
  await emailInput.waitFor({ state: "visible", timeout: 10000 });
  await emailInput.fill(email);
  await emailInput.press("Enter");
  console.log(`[ENTRA_ID_LOGIN] Email submitted`);

  // Wait for password page and fill in password
  const passwordInput = page.getByPlaceholder("Password");
  await passwordInput.waitFor({ state: "visible", timeout: 10000 });
  await passwordInput.fill(password);
  await passwordInput.press("Enter");
  console.log(`[ENTRA_ID_LOGIN] Password submitted`);

  // Handle "Stay signed in?" prompt if it appears
  try {
    const staySignedInButton = page.getByRole("button", { name: "Yes" });
    await staySignedInButton.waitFor({ state: "visible", timeout: 5000 });
    await staySignedInButton.click();
    console.log(`[ENTRA_ID_LOGIN] Clicked 'Stay signed in' button`);
  } catch (e) {
    console.log(`[ENTRA_ID_LOGIN] No 'Stay signed in' prompt (this is okay)`);
  }

  // Wait for redirect back to the app
  await page.waitForURL(
    (url) => !url.hostname.includes("login.microsoftonline.com"),
    {
      timeout: 15000,
    },
  );
  console.log(`[ENTRA_ID_LOGIN] Redirected back to app, login complete`);
};

/**
 * Creates a new authenticated context for a different user
 * Use this when you need to test with a different user than the default admin@example.com
 */
export const createAuthenticatedContext = async (
  browser: Browser,
  email: string,
  password = "admin",
) => {
  // Create a fresh context without any stored authentication state
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  await page.goto("/");
  await login(page, email, password);

  // Wait for successful login
  await expect(
    page.getByRole("textbox", { name: "Type a message..." }),
  ).toBeVisible();

  return { context, page };
};

export const chatIsReadyToChat = async (
  page: Page,
  args?: { expectAssistantResponse?: boolean; loadingTimeoutMs?: number },
) => {
  await test.step(`Wait for chat to be ready to Chat (either initial or to wait for finish message streaming)`, async () => {
    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    // Expect that assistant message is visible during or after the stream
    if (args?.expectAssistantResponse) {
      await expect(page.getByTestId("message-assistant")).toBeVisible();
    }
    const loadingOpts = args?.loadingTimeoutMs
      ? { timeout: args?.loadingTimeoutMs }
      : {};
    await expect(page.getByText("Loading")).toHaveCount(0, loadingOpts);
    // Expect that assistant message is visible after the loading indicator has been removed (after stream finished)
    if (args?.expectAssistantResponse) {
      await expect(page.getByTestId("message-assistant")).toBeVisible();
    }
    await expect(textbox).toBeVisible();
    await expect(textbox).toBeEnabled();
  });
};

/**
 * Select a specific model by display name from the model dropdown
 */
export const selectModel = async (page: Page, modelDisplayName: string) => {
  // Click the model selector dropdown (it shows the current model name)
  // The dropdown button should be in the chat input area
  const modelSelector = page
    .locator(
      'button:has-text("GPT"), button:has-text("Test Model"), button:has-text("Llama")',
    )
    .first();
  await modelSelector.click();

  // Wait for dropdown menu to appear and click the desired model
  await page.getByRole("menuitem", { name: modelDisplayName }).click();

  // Wait a moment for the selection to take effect
  await page.waitForTimeout(500);
};

export const ensureOpenSidebar = async (page: Page) => {
  const expandButton = page.getByLabel("expand sidebar");
  if (await expandButton.isVisible()) {
    await expandButton.click();
  }
};

/**
 * Wait for message IDs to stabilize (temp-user-* → real UUIDs)
 * This handles the ~2 second window where messages have temp IDs before server replacement
 */
// Browser-specific expectations for ID stabilization
const browserCapabilities = {
  chromium: {
    tempIdPhase: "usually",
    stabilizationReliability: "high",
    maxWaitTime: 15000,
    strictTesting: true,
  },
  firefox: {
    tempIdPhase: "inconsistent",
    stabilizationReliability: "medium",
    maxWaitTime: 10000,
    strictTesting: false, // Firefox has known timing issues
  },
  webkit: {
    tempIdPhase: "unknown",
    stabilizationReliability: "unknown",
    maxWaitTime: 15000,
    strictTesting: false,
  },
};

export const waitForMessageIdsToStabilize = async (
  page: Page,
  expectedMessageCount?: number,
) => {
  // Detect browser for diagnostics
  const browserName =
    page.context().browser()?.browserType().name() || "unknown";
  const capabilities =
    browserCapabilities[browserName as keyof typeof browserCapabilities] ||
    browserCapabilities.webkit;

  const maxAttempts = Math.ceil(capabilities.maxWaitTime / 750);
  const delayBetweenChecks = 750;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Wait for network idle first to ensure messages are fully processed
      await page.waitForLoadState("networkidle");

      const userMessages = page.locator('[data-testid="message-user"]');
      const currentCount = await userMessages.count();

      // If we have an expected count, wait for it first
      if (expectedMessageCount && currentCount < expectedMessageCount) {
        await page.waitForTimeout(delayBetweenChecks);
        continue;
      }

      // Check if any messages still have temp IDs
      let hasAnyTempIds = false;
      const messageIds: string[] = [];
      const messageDetails: any[] = [];

      for (let i = 0; i < currentCount; i++) {
        try {
          // Wait for each message element to be stable
          await userMessages
            .nth(i)
            .waitFor({ state: "visible", timeout: 5000 });

          const messageElement = userMessages.nth(i);
          const messageId =
            await messageElement.getAttribute("data-message-id");
          const messageContent = await messageElement.textContent();
          const timestamp = Date.now();

          const detail = {
            index: i,
            messageId,
            content: messageContent?.substring(0, 50) + "...",
            timestamp,
            browser: browserName,
            isTemp: messageId?.startsWith("temp-user-") || false,
          };

          messageDetails.push(detail);

          if (!messageId) {
            hasAnyTempIds = true;
            break;
          }

          messageIds.push(messageId);

          if (messageId.startsWith("temp-user-")) {
            hasAnyTempIds = true;
            break;
          }
        } catch (error) {
          // Message element might not be ready yet, continue checking
          console.log(
            `[TIMING_HELPER-${browserName.toUpperCase()}] ⚠️ Could not get messageId for message ${i}, continuing... Error: ${error}`,
          );
          hasAnyTempIds = true; // Assume we need to wait more
          break;
        }
      }

      // Log detailed comparison for browser analysis
      if (attempt > 5) {
        // Only after a few attempts to avoid spam
        console.log(
          `[TIMING_HELPER-${browserName.toUpperCase()}] 📊 Message details:`,
          JSON.stringify(messageDetails, null, 2),
        );
      }

      if (!hasAnyTempIds && currentCount >= (expectedMessageCount || 1)) {
        console.log(
          `[TIMING_HELPER] ✅ All ${currentCount} message IDs stabilized after ${attempt * delayBetweenChecks}ms`,
        );
        console.log(
          `[TIMING_HELPER] 📋 Final message IDs: ${JSON.stringify(messageIds)}`,
        );
        return; // All IDs are stable (real UUIDs)
      }

      console.log(
        `[TIMING_HELPER] 🔄 Attempt ${attempt + 1}: Still waiting for temp IDs to be replaced...`,
      );
      await page.waitForTimeout(delayBetweenChecks);
    } catch (error) {
      console.log(
        `[TIMING_HELPER] ⚠️ Attempt ${attempt + 1} failed, retrying... Error: ${error}`,
      );
      await page.waitForTimeout(delayBetweenChecks);
    }
  }

  if (capabilities.strictTesting) {
    console.error(
      `[TIMING_HELPER] ❌ Timeout: Message IDs did not stabilize after ${maxAttempts * delayBetweenChecks}ms (${browserName})`,
    );

    // Log current state for debugging
    try {
      const userMessages = page.locator('[data-testid="message-user"]');
      const finalCount = await userMessages.count();
      console.error(
        `[TIMING_HELPER] 📊 Final count: ${finalCount}, Expected: ${expectedMessageCount}`,
      );

      for (let i = 0; i < finalCount; i++) {
        const messageId = await userMessages
          .nth(i)
          .getAttribute("data-message-id");
        console.error(`[TIMING_HELPER] 📊 Message ${i}: ${messageId}`);
      }
    } catch (e) {
      console.error(`[TIMING_HELPER] ❌ Could not log final state: ${e}`);
    }
  } else {
    console.warn(
      `[TIMING_HELPER] ⚠️ Message IDs did not stabilize after ${maxAttempts * delayBetweenChecks}ms (${browserName}) - continuing with current state (non-strict mode)`,
    );

    // Still log for diagnostic purposes but don't error
    try {
      const userMessages = page.locator('[data-testid="message-user"]');
      const finalCount = await userMessages.count();
      console.warn(
        `[TIMING_HELPER] 📊 Final count: ${finalCount}, Expected: ${expectedMessageCount}`,
      );

      for (let i = 0; i < finalCount; i++) {
        const messageId = await userMessages
          .nth(i)
          .getAttribute("data-message-id");
        const isTemp = messageId?.startsWith("temp-user-");
        console.warn(
          `[TIMING_HELPER] 📊 Message ${i}: ${messageId} ${isTemp ? "(TEMP - ACCEPTED IN NON-STRICT)" : "(REAL)"}`,
        );
      }
    } catch (e) {
      console.warn(`[TIMING_HELPER] ⚠️ Could not log diagnostic state: ${e}`);
    }
  }
};

/**
 * Enhanced version of chatIsReadyToChat that also waits for message ID stabilization
 */
export const chatIsReadyToEditMessages = async (
  page: Page,
  expectedMessageCount?: number,
) => {
  // First ensure basic chat readiness
  await chatIsReadyToChat(page);

  // Then wait for message IDs to stabilize
  await waitForMessageIdsToStabilize(page, expectedMessageCount);
};

/**
 * Wait for an edit operation to complete by watching for content changes
 * This handles the async nature of edit operations via SSE
 */
export const waitForEditToComplete = async (
  page: Page,
  messageLocator: any,
  expectedContent: string,
  timeout: number = 10000,
) => {
  console.log(
    `[EDIT_COMPLETION] Waiting for message content to update to: "${expectedContent}"`,
  );

  // Wait for the message content to actually change to the expected text
  // Playwright will automatically retry until timeout
  try {
    await expect(messageLocator).toContainText(expectedContent, { timeout });
    console.log(
      `[EDIT_COMPLETION] ✅ Message content successfully updated to: "${expectedContent}"`,
    );
  } catch (error) {
    // Log current content for debugging
    const currentContent = await messageLocator.textContent();
    console.error(
      `[EDIT_COMPLETION] ❌ Edit did not complete within ${timeout}ms`,
    );
    console.error(`[EDIT_COMPLETION] Expected: "${expectedContent}"`);
    console.error(`[EDIT_COMPLETION] Actual: "${currentContent}"`);
    throw error;
  }
};

/**
 * Wait for chat to return to compose mode after edit
 */
export const waitForEditModeToEnd = async (page: Page) => {
  // Wait for compose mode textbox to be visible
  await expect(
    page.getByRole("textbox", { name: "Type a message..." }),
  ).toBeVisible();

  // Ensure edit textbox is gone
  await expect(
    page.getByRole("textbox", { name: "Edit your message..." }),
  ).not.toBeVisible();

  console.log(`[EDIT_COMPLETION] ✅ Successfully returned to compose mode`);
};

/**
 * Wait for Erato page to be properly loaded by checking for API_ROOT_URL.
 */
async function waitForEratoPageReady(page: Page): Promise<void> {
  // Wait until either API_ROOT_URL is set or [data-testid="message-list"] exists
  await Promise.race([
    page.waitForFunction(() => (window as any).API_ROOT_URL !== undefined, {
      timeout: 10000,
    }),
    page.getByTestId("message-list").waitFor({ timeout: 10000 }),
  ]);
}

/**
 * Check if the test is running against a k3d environment.
 * K3d environments expose the K3D_TEST_SCENARIO variable via window.
 */
async function isK3dEnvironment(page: Page): Promise<boolean> {
  try {
    const scenario = await page.evaluate(() => {
      return (window as any).K3D_TEST_SCENARIO;
    });
    return scenario !== undefined;
  } catch (error) {
    console.warn(`[K3D_SCENARIO] Error checking k3d environment: ${error}`);
    return false;
  }
}

/**
 * Get the currently deployed test scenario.
 * Returns null if not in a k3d environment or if the scenario is not set.
 */
async function getCurrentScenario(page: Page): Promise<string | null> {
  try {
    const scenario = await page.evaluate(() => {
      return (window as any).K3D_TEST_SCENARIO;
    });
    return scenario || null;
  } catch (error) {
    console.warn(`[K3D_SCENARIO] Error getting current scenario: ${error}`);
    return null;
  }
}

/**
 * Get scenario-specific data from the E2E scenario data server.
 * This endpoint is publicly accessible (bypasses oauth2-proxy) to allow
 * E2E tests to retrieve authentication credentials before logging in.
 *
 * Returns null if the data cannot be fetched or parsed.
 *
 * Example usage:
 * ```typescript
 * const scenarioData = await getScenarioData(page);
 * if (scenarioData?.entraid_user1_email) {
 *   await loginWithEntraId(page, scenarioData.entraid_user1_email, scenarioData.entraid_user1_password);
 * }
 * ```
 */
export async function getScenarioData(
  page: Page,
): Promise<Record<string, any> | null> {
  try {
    // Fetch scenario data from the public endpoint
    const response = await page.request.get(
      "/e2e-scenario-data/scenario-data.toml",
    );

    if (!response.ok()) {
      console.warn(
        `[SCENARIO_DATA] Failed to fetch scenario data: ${response.status()} ${response.statusText()}`,
      );
      return null;
    }

    const tomlContent = await response.text();

    // Parse TOML content - we need to extract the [frontend.additional_environment] section
    // and specifically the SCENARIO_DATA inline table
    const scenarioDataMatch = tomlContent.match(
      /SCENARIO_DATA\s*=\s*\{([^}]+)\}/,
    );

    if (!scenarioDataMatch) {
      console.warn(`[SCENARIO_DATA] No SCENARIO_DATA found in TOML content`);
      return null;
    }

    // Parse the inline table: { key1 = "value1", key2 = "value2" }
    const inlineTableContent = scenarioDataMatch[1];
    const data: Record<string, any> = {};

    const keyValuePairs = inlineTableContent.split(",");
    for (const pair of keyValuePairs) {
      const [key, value] = pair.split("=").map((s) => s.trim());
      if (key && value) {
        // Remove quotes from value
        data[key] = value.replace(/^["']|["']$/g, "");
      }
    }

    console.log(
      `[SCENARIO_DATA] Successfully fetched scenario data with ${Object.keys(data).length} keys`,
    );
    return data;
  } catch (error) {
    console.warn(`[SCENARIO_DATA] Error getting scenario data: ${error}`);
    return null;
  }
}

/**
 * Ensure the correct test scenario is deployed before running a test.
 * This function works independently of the current page state by creating
 * a temporary page to check and switch scenarios.
 *
 * If not in k3d, emits a warning that manual setup is required.
 * If in k3d but wrong scenario, switches to the required scenario.
 *
 * @param page - The Playwright page object (used to get browser context)
 * @param requiredScenario - The scenario that this test requires ('basic', 'tight-budget', 'assistants', or 'entra_id')
 */
export async function ensureTestScenario(
  page: Page,
  requiredScenario: "basic" | "tight-budget" | "assistants" | "entra_id",
): Promise<void> {
  await test.step(`Ensure test scenario: ${requiredScenario}`, async () => {
    // Create a new page for scenario detection/switching, independent of current page state
    const context = page.context();
    const helperPage = await context.newPage();

    try {
      await test.step(`Navigate to Erato and check environment`, async () => {
        // Navigate to root and wait for Erato to be properly loaded
        await helperPage.goto("/");

        // Wait for Erato page to be ready (API_ROOT_URL should be present)
        await waitForEratoPageReady(helperPage);

        console.log(`[K3D_SCENARIO] Erato page loaded and ready`);
      });

      const isK3d = await isK3dEnvironment(helperPage);

      if (!isK3d) {
        console.warn(
          `[K3D_SCENARIO] ⚠️ Not running in k3d environment. ` +
            `Manual scenario setup required for: ${requiredScenario}`,
        );
        return;
      }

      const currentScenario = await getCurrentScenario(helperPage);

      if (currentScenario === requiredScenario) {
        console.log(
          `[K3D_SCENARIO] ✅ Already on scenario: ${requiredScenario}`,
        );
        return;
      }

      await test.step(`Switch from '${currentScenario}' to '${requiredScenario}'`, async () => {
        console.log(`[K3D_SCENARIO] 🔄 Switching scenarios...`);

        // Path to the switch-test-scenario script
        const scriptPath = path.resolve(
          __dirname,
          "../../infrastructure/scripts/switch-test-scenario",
        );

        try {
          // Run the switch script
          await test.step(`Run switch-test-scenario script`, async () => {
            const output = execSync(
              `${scriptPath} --scenario ${requiredScenario}`,
              {
                encoding: "utf-8",
                stdio: "pipe",
                timeout: 120000, // 2 minute timeout
              },
            );

            console.log(`[K3D_SCENARIO] Script output:\n${output}`);
          });

          // Wait for the scenario to actually switch by polling
          await test.step(`Wait for scenario switch to take effect`, async () => {
            const maxWaitTime = 120000; // 2 minutes
            const pollInterval = 2000; // 2 seconds
            const startTime = Date.now();

            while (Date.now() - startTime < maxWaitTime) {
              // Reload the helper page to get fresh environment variables
              await helperPage.reload();
              await waitForEratoPageReady(helperPage);

              // Check if scenario has changed
              const newScenario = await getCurrentScenario(helperPage);

              if (newScenario === requiredScenario) {
                console.log(
                  `[K3D_SCENARIO] ✅ Successfully switched to: ${requiredScenario}`,
                );
                return;
              }

              console.log(
                `[K3D_SCENARIO] ⏳ Waiting for scenario switch... ` +
                  `Current: ${newScenario}, Target: ${requiredScenario}`,
              );

              await helperPage.waitForTimeout(pollInterval);
            }

            throw new Error(
              `Timeout: Scenario did not switch to '${requiredScenario}' within ${maxWaitTime}ms`,
            );
          });
        } catch (error) {
          console.error(
            `[K3D_SCENARIO] ❌ Failed to switch scenario: ${error}`,
          );
          throw error;
        }
      });
    } finally {
      // Always close the helper page when done
      await helperPage.close();
    }
  });
}
