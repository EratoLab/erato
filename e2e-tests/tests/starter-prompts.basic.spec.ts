import { expect, test } from "@playwright/test";

import { TAG_CI } from "./tags";

test(
  "Starter prompts prefill the chat input without submitting",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("starter-prompts-section")).toBeVisible();

    const researchPromptButton = page.getByTestId(
      "starter-prompt-research_topic",
    );
    await expect(researchPromptButton).toBeVisible();

    await researchPromptButton.click();

    await expect(
      page.getByRole("textbox", { name: /type a message/i }),
    ).toHaveValue(
      "Research this topic and summarize the most important findings.",
    );
    await expect(page.getByTestId("selected-facet-web_search")).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: /type a message/i }),
    ).toBeFocused();
    await expect(page.getByTestId("message-user")).toHaveCount(0);
    await expect(page).toHaveURL(/\/chat\/new$/);
  },
);
