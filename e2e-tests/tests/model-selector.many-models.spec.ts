import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat } from "./shared";

test(
  "Model selector shows many models and allows selection",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");

    const modelSelectorButton = page.locator(
      'button[aria-controls="model-selector-dropdown"]',
    );
    await expect(modelSelectorButton).toBeVisible();

    await modelSelectorButton.click();

    const menu = page.locator("#model-selector-dropdown");
    await expect(menu).toBeVisible();

    const targetModel = "GPT-4.1 Mini";
    await page.getByRole("menuitem", { name: targetModel }).click();
    await expect(modelSelectorButton).toContainText(targetModel);
  },
);

test.describe("Can chat with different models", () => {
  const modelChatTests = [
    {
      modelName: "GPT-4.1",
      prompt: "Please answer in one short sentence about the sun.",
      tags: [TAG_CI],
    },
    {
      modelName: "GPT-4.1 Mini",
      prompt: "Please provide a brief greeting in exactly five words.",
      tags: [TAG_CI],
    },
    {
      modelName: "GPT-4o Mini",
      prompt: "Please give one concise sentence about software testing.",
      tags: [TAG_CI],
    },
    {
      modelName: "Mock-LLM",
      prompt: "Test",
      tags: [TAG_CI],
    },
  ] as const;

  for (const modelTest of modelChatTests) {
    test(
      `Chat request works with ${modelTest.modelName}`,
      { tag: modelTest.tags },
      async ({ page }) => {
        await page.goto("/");
        await chatIsReadyToChat(page);

        const modelSelectorButton = page.locator(
          'button[aria-controls="model-selector-dropdown"]',
        );
        await expect(modelSelectorButton).toBeVisible();

        await modelSelectorButton.click();
        await page
          .getByRole("menuitem", { name: modelTest.modelName, exact: true })
          .click();
        await expect(modelSelectorButton).toContainText(modelTest.modelName);

        const textbox = page.getByRole("textbox", {
          name: "Type a message...",
        });
        await expect(textbox).toBeVisible();

        const assistantMessageCountBefore = await page
          .getByTestId("message-assistant")
          .count();

        await textbox.fill(modelTest.prompt);
        await textbox.press("Enter");

        await chatIsReadyToChat(page, {
          expectAssistantResponse: true,
          loadingTimeoutMs: 20000,
        });

        await expect(page.getByTestId("message-assistant")).toHaveCount(
          assistantMessageCountBefore + 1,
        );
      },
    );
  }
});
