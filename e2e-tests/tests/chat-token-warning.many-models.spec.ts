import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { chatIsReadyToChat } from "./shared";
import { TAG_CI } from "./tags";

import type { Page } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const selectModel = async (page: Page, name: string) => {
  const chatTextbox = page.getByRole("textbox", { name: "Type a message..." });
  await expect(chatTextbox).toBeVisible();
  const modelSelectorButton = chatTextbox
    .locator("xpath=ancestor::form[1]")
    .locator('button[aria-controls="model-selector-dropdown"]');
  await expect(modelSelectorButton).toBeVisible();
  await modelSelectorButton.click();
  await page.getByRole("menuitem", { name, exact: true }).click();
  await expect(modelSelectorButton).toContainText(name);
};

const uploadLongPdf = async (page: Page) => {
  const longFilePath = path.join(
    __dirname,
    "../test-files/long-file-100k-words.pdf",
  );
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /upload files/i }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(longFilePath);
  await expect(page.getByText("long-file-100k-words.pdf")).toBeVisible({
    timeout: 20000,
  });
};

const tokenWarningAlert = (page: Page) =>
  page.getByRole("alert").filter({
    hasText: /approaching token limit|token limit exceeded|token limit/i,
  });

test(
  "Normal chat shows token warning with Mock-LLM 100k for long file",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("/");
    await chatIsReadyToChat(page);

    await selectModel(page, "Mock-LLM 100k");
    await uploadLongPdf(page);

    await expect(tokenWarningAlert(page)).toBeVisible({ timeout: 60000 });
  },
);

test(
  "Normal chat does not show token warning with Mock-LLM 200k for same long file",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("/");
    await chatIsReadyToChat(page);

    await selectModel(page, "Mock-LLM 200k");
    await uploadLongPdf(page);

    await expect(tokenWarningAlert(page)).not.toBeVisible({ timeout: 10000 });
  },
);

test(
  "Normal chat warning appears after switching from Mock-LLM 200k to Mock-LLM 100k",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("/");
    await chatIsReadyToChat(page);

    await selectModel(page, "Mock-LLM 200k");
    await uploadLongPdf(page);
    await expect(tokenWarningAlert(page)).not.toBeVisible({ timeout: 10000 });

    await selectModel(page, "Mock-LLM 100k");
    await expect(tokenWarningAlert(page)).toBeVisible({ timeout: 60000 });
  },
);
