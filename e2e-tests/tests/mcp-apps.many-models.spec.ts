import { Browser, expect, Locator, Page, test } from "@playwright/test";
import { chatIsReadyToChat, login } from "./shared";
import { TAG_CI } from "./tags";

// The scenario's `mock_mcp_apps` server enables MCP Apps for the group of
// mcp-apps@example.com; `mock_mcp_apps_off` serves the same tools without it
// for mcp-apps-off@example.com.
const SANDBOX_PAGE =
  "https://mcp-apps.erato.internal:8443/public/common/mcp-apps-sandbox.html";

const selectMockModel = async (page: Page) => {
  const modelSelectorButton = page.locator(
    'button[aria-controls="model-selector-dropdown"]',
  );
  await expect(modelSelectorButton).toBeVisible();
  await modelSelectorButton.click();
  await page.getByRole("menuitem", { name: "Mock-LLM", exact: true }).click();
  await expect(modelSelectorButton).toContainText("Mock-LLM");
};

const createDexAuthenticatedContext = async (
  browser: Browser,
  email: string,
) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  await page.goto("/");
  await login(page, email);
  await chatIsReadyToChat(page);

  return { context, page };
};

/** Asks the mock LLM to call `show_counter` with `start` 41. */
const callCounterTool = async (page: Page) => {
  await page.goto("/");
  await chatIsReadyToChat(page);
  await selectMockModel(page);

  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await expect(textbox).toBeVisible();
  await textbox.fill("mcp apps counter");
  await textbox.press("Enter");

  const latestAssistantMessage = page.getByTestId("message-assistant").last();
  await expect(latestAssistantMessage).toBeVisible({ timeout: 15000 });
  const toolCallCard = latestAssistantMessage.locator(
    `[data-testid="tool-call-item"][data-tool-name="show_counter"]`,
  );
  await expect(toolCallCard).toHaveAttribute("data-tool-status", "success", {
    timeout: 15000,
  });
  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: 15000,
  });
  return latestAssistantMessage;
};

/** The counter the view shows, inside the sandbox page's frame. */
const viewCount = (message: Locator) =>
  message
    .frameLocator('[data-testid="mcp-app-view"]')
    .frameLocator("iframe")
    .locator("#count");

test(
  "An MCP Apps view renders in a sandboxed frame from the sandbox origin with the tool input, and again when the chat is reopened",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps@example.com",
    );
    try {
      const message = await callCounterTool(page);

      const frame = message.getByTestId("mcp-app-view");
      await expect(frame).toBeVisible({ timeout: 15000 });
      await expect(frame).toHaveAttribute(
        "sandbox",
        "allow-scripts allow-same-origin",
      );
      await expect(frame).toHaveAttribute("src", SANDBOX_PAGE);
      await expect(viewCount(message)).toHaveText("41", { timeout: 15000 });

      await page.reload();
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
      const reopened = page.getByTestId("message-assistant").last();
      await expect(reopened.getByTestId("mcp-app-view")).toBeVisible({
        timeout: 15000,
      });
      await expect(viewCount(reopened)).toHaveText("41", { timeout: 15000 });
    } finally {
      await context.close();
    }
  },
);

test(
  "Without MCP Apps enabled for the server, the same tool call shows no view frame",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-apps-off@example.com",
    );
    try {
      const message = await callCounterTool(page);

      await expect(message).toContainText(
        "The secret content has been read successfully.",
      );
      await expect(page.getByTestId("mcp-app-view")).toHaveCount(0);
    } finally {
      await context.close();
    }
  },
);
