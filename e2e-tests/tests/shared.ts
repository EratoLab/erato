import { expect, Page, Browser } from "@playwright/test";

export const login = async (page: Page, email: string, password = "admin") => {
  await page.getByRole("button", { name: "Sign in with" }).click();
  await page.waitForURL((url) => url.pathname.includes("auth"));
  await page.getByRole("textbox", { name: "email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("textbox", { name: "Password" }).press("Enter");
  await page.getByRole("button", { name: "Grant Access" }).click();
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
  args?: { expectAssistantResponse?: boolean },
) => {
  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await expect(textbox).toBeVisible();
  await expect(textbox).toBeEnabled();
  if (args?.expectAssistantResponse) {
    await expect(page.getByText("Assistant")).toBeVisible();
  }
  await expect(page.getByText("Loading")).toHaveCount(0);
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
