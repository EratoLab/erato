import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { TAG_CI } from "./tags";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test(
  "Assistant editor shows context warning after uploading long file with Mock-LLM 200k",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("/assistants/new");

    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    await page.getByLabel(/name/i).fill("Context Warning Validation");
    await page
      .getByLabel(/system prompt/i)
      .fill("You are a helpful assistant that should use uploaded files.");

    // Select the dedicated 200k context mock model.
    const defaultModelButton = page.locator(
      'button[aria-controls="model-selector-dropdown"]',
    );
    await expect(defaultModelButton).toBeVisible();
    await defaultModelButton.click();
    const modelItems = page.getByRole("menuitem");
    await expect(modelItems.first()).toBeVisible({ timeout: 15000 });
    const modelNames = (await modelItems.allTextContents()).map((text) =>
      text.trim(),
    );
    expect(modelNames).toContain("Mock-LLM 200k");
    await page
      .getByRole("menuitem", { name: "Mock-LLM 200k", exact: true })
      .click();
    await expect(defaultModelButton).toContainText("Mock-LLM 200k");

    // Upload large file that should push context usage over warning threshold.
    const longFilePath = path.join(
      __dirname,
      "../test-files/long-file-100k-words.pdf",
    );
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(longFilePath);

    // Wait for assistant-editor context warning to appear.
    await expect(
      page.getByText(
        /Using this much context may limit the chat session and reduce room for uploading additional files\./i,
      ),
    ).toBeVisible({ timeout: 60000 });
  },
);
