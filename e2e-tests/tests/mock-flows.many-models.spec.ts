import { expect, Page, test } from "@playwright/test";
import { chatIsReadyToChat } from "./shared";
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

test(
  "Mock-LLM shows content-filter error for blocked prompt",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();
    await textbox.fill("erotic");
    await textbox.press("Enter");

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 20000,
    });

    const errorMessage = page.getByTestId("chat-message-error");
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText(
      "filtered due to the prompt triggering content management policy",
    );
  },
);

test(
  "Mock-LLM shows rate-limit error for rate limit prompt",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();
    await textbox.fill("rate limit");
    await textbox.press("Enter");

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 20000,
    });

    const errorMessage = page.getByTestId("chat-message-error");
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText(
      "Rate limit or quota exceeded. This can also happen if your input is too large.",
    );
  },
);
