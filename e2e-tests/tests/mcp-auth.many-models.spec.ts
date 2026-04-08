import { Browser, expect, Page, test } from "@playwright/test";
import { chatIsReadyToChat, login } from "./shared";
import { TAG_CI } from "./tags";

const selectMockModel = async (page: Page) => {
  const modelSelectorButton = page.locator(
    'button[aria-controls="model-selector-dropdown"]',
  );
  await expect(modelSelectorButton).toBeVisible();
  await modelSelectorButton.click();
  await page.getByRole("menuitem", { name: "Mock-LLM", exact: true }).click();
  await expect(modelSelectorButton).toContainText("Mock-LLM");
};

const runMcpAuthFlow = async (
  page: Page,
  prompt: string,
  expectedToolName: string,
) => {
  await page.goto("/");
  await chatIsReadyToChat(page);
  await selectMockModel(page);

  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await expect(textbox).toBeVisible();
  await textbox.fill(prompt);
  await textbox.press("Enter");

  const latestAssistantMessage = page.getByTestId("message-assistant").last();
  await expect(latestAssistantMessage).toBeVisible();

  const toolCallsToggle = latestAssistantMessage.getByRole("button", {
    name: /Tool calls \(/i,
  });
  await expect(toolCallsToggle).toBeVisible({ timeout: 15000 });
  await toolCallsToggle.click();

  await expect(latestAssistantMessage).toContainText(expectedToolName);
  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: 15000,
  });
  await expect(
    latestAssistantMessage.getByTestId("chat-message-error"),
  ).toHaveCount(0);
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

test(
  "Mock-LLM MCP auth none flow executes the expected tool",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-auth-none@example.com",
    );
    try {
      await runMcpAuthFlow(page, "mcp auth none", "auth_none_probe");
    } finally {
      await context.close();
    }
  },
);

test(
  "Mock-LLM MCP auth fixed flow executes the expected tool",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-auth-fixed@example.com",
    );
    try {
      await runMcpAuthFlow(page, "mcp auth fixed", "auth_fixed_api_key_probe");
    } finally {
      await context.close();
    }
  },
);

test(
  "Mock-LLM MCP auth forwarded access flow executes the expected tool",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-auth-forwarded-access@example.com",
    );
    try {
      await runMcpAuthFlow(
        page,
        "mcp auth forwarded access",
        "auth_forwarded_access_probe",
      );
    } finally {
      await context.close();
    }
  },
);

test(
  "Mock-LLM MCP auth forwarded oidc flow executes the expected tool",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-auth-forwarded-oidc@example.com",
    );
    try {
      await runMcpAuthFlow(
        page,
        "mcp auth forwarded oidc",
        "auth_forwarded_oidc_probe",
      );
    } finally {
      await context.close();
    }
  },
);
