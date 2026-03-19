import { expect, test } from "@playwright/test";

import { TAG_CI } from "./tags";

test(
  "Starter prompts can switch the selected chat provider",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");

    const modelSelectorButton = page.locator(
      'button[aria-controls="model-selector-dropdown"]',
    );
    await expect(modelSelectorButton).toBeVisible();

    await page.getByTestId("starter-prompt-research_topic").click();

    await expect(modelSelectorButton).toContainText("Mock-LLM 200k");
    await expect(
      page.getByRole("textbox", { name: /type a message/i }),
    ).toHaveValue(
      "Research this topic and summarize the most important findings.",
    );
  },
);
