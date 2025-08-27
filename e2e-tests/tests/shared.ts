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
export const waitForMessageIdsToStabilize = async (page: Page, expectedMessageCount?: number) => {
  const maxAttempts = 10;
  const delayBetweenChecks = 500; // Check every 500ms
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const userMessages = page.locator('[data-testid="message-user"]');
    const currentCount = await userMessages.count();
    
    // If we have an expected count, wait for it first
    if (expectedMessageCount && currentCount < expectedMessageCount) {
      await page.waitForTimeout(delayBetweenChecks);
      continue;
    }
    
    // Check if any messages still have temp IDs
    let hasAnyTempIds = false;
    
    for (let i = 0; i < currentCount; i++) {
      const messageId = await userMessages.nth(i).getAttribute("data-message-id");
      if (messageId && messageId.startsWith("temp-user-")) {
        hasAnyTempIds = true;
        break;
      }
    }
    
    if (!hasAnyTempIds) {
      console.log(`[TIMING_HELPER] ✅ All message IDs stabilized after ${attempt * delayBetweenChecks}ms`);
      return; // All IDs are stable (real UUIDs)
    }
    
    console.log(`[TIMING_HELPER] 🔄 Attempt ${attempt + 1}: Still waiting for temp IDs to be replaced...`);
    await page.waitForTimeout(delayBetweenChecks);
  }
  
  console.warn(`[TIMING_HELPER] ⚠️ Timeout: Some message IDs may still be temp after ${maxAttempts * delayBetweenChecks}ms`);
};

/**
 * Enhanced version of chatIsReadyToChat that also waits for message ID stabilization
 */
export const chatIsReadyToEditMessages = async (page: Page, expectedMessageCount?: number) => {
  // First ensure basic chat readiness
  await chatIsReadyToChat(page);
  
  // Then wait for message IDs to stabilize
  await waitForMessageIdsToStabilize(page, expectedMessageCount);
};
