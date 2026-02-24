import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { chatIsReadyToChat } from "./shared";
import { TAG_CI } from "./tags";

import type { Page } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const selectAssistantDefaultModel = async (page: Page) => {
  const defaultModelButton = page.locator(
    'button[aria-controls="model-selector-dropdown"]',
  );
  await expect(defaultModelButton).toBeVisible();
  await defaultModelButton.click();
  await page
    .getByRole("menuitem", { name: "Mock-LLM 200k", exact: true })
    .click();
  await expect(defaultModelButton).toContainText("Mock-LLM 200k");
};

test(
  "Assistant with Mock-LLM 200k exceeds token limit when same long file is uploaded again in chat",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(180000);

    const randomSuffix = Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, "0");
    const assistantName = `Mock 200k Limit Assistant-${randomSuffix}`;
    const longFilePath = path.join(
      __dirname,
      "../test-files/long-file-100k-words.pdf",
    );

    await page.goto("/assistants/new");
    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    await page.getByLabel(/name/i).fill(assistantName);
    await page
      .getByLabel(/system prompt/i)
      .fill("Use uploaded files as context.");

    await selectAssistantDefaultModel(page);

    const assistantFileInput = page.locator('input[type="file"]');
    await assistantFileInput.setInputFiles(longFilePath);
    await expect(page.getByText(/long-file-100k-words\.pdf/i)).toBeVisible({
      timeout: 30000,
    });

    await page.getByRole("button", { name: /create assistant/i }).click();
    await expect(page.getByText(/assistant created successfully/i)).toBeVisible(
      {
        timeout: 15000,
      },
    );
    await page.waitForURL("/assistants", { timeout: 10000 });

    const assistantButton = page.getByRole("button", {
      name: new RegExp(assistantName),
    });
    await expect(assistantButton).toBeVisible();
    await assistantButton.click();

    await chatIsReadyToChat(page);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /upload files/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(longFilePath);

    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /token limit exceeded|exceeds the token limit/i }),
    ).toBeVisible({ timeout: 60000 });
  },
);
