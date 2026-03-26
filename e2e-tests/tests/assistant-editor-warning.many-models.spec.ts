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

test(
  "Assistant editor clears the context warning after removing the long file with Mock-LLM 200k",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("/assistants/new");

    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    await page.getByLabel(/name/i).fill("Context Warning Removal Validation");
    await page
      .getByLabel(/system prompt/i)
      .fill("You are a helpful assistant that should use uploaded files.");

    const defaultModelButton = page.locator(
      'button[aria-controls="model-selector-dropdown"]',
    );
    await expect(defaultModelButton).toBeVisible({ timeout: 15000 });
    await defaultModelButton.click();
    const modelItems = page.getByRole("menuitem");
    await expect(modelItems.first()).toBeVisible({ timeout: 15000 });
    await page
      .getByRole("menuitem", { name: "Mock-LLM 200k", exact: true })
      .click();
    await expect(defaultModelButton).toContainText("Mock-LLM 200k");

    const longFilePath = path.join(
      __dirname,
      "../test-files/long-file-100k-words.pdf",
    );
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(longFilePath);

    const contextWarning = page.getByText(
      /Using this much context may limit the chat session and reduce room for uploading additional files\./i,
    );
    await expect(contextWarning).toBeVisible({ timeout: 60000 });

    await page
      .getByRole("button", { name: /remove long-file-100k-words\.pdf/i })
      .click();

    await expect(contextWarning).toBeHidden({ timeout: 60000 });
    await expect(page.getByText(/estimating token usage\.\.\./i)).toBeHidden({
      timeout: 60000,
    });
  },
);

test(
  "Assistant editor does not show a false context overload for an existing attached file with Mock-LLM 200k",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);

    const randomSuffix = Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, "0");
    const assistantName = `Assistant Edit Context-${randomSuffix}`;

    await page.goto("/assistants/new");

    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    await page.getByLabel(/name/i).fill(assistantName);
    await page
      .getByLabel(/system prompt/i)
      .fill("You are a helpful assistant that should use uploaded files.");

    const defaultModelButton = page.locator(
      'button[aria-controls="model-selector-dropdown"]',
    );
    await expect(defaultModelButton).toBeVisible({ timeout: 15000 });
    await defaultModelButton.click();
    const modelItems = page.getByRole("menuitem");
    await expect(modelItems.first()).toBeVisible({ timeout: 15000 });
    await page
      .getByRole("menuitem", { name: "Mock-LLM 200k", exact: true })
      .click();
    await expect(defaultModelButton).toContainText("Mock-LLM 200k");

    const longFilePath = path.join(
      __dirname,
      "../test-files/long-file-100k-words.pdf",
    );
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(longFilePath);

    const warningText = page.getByText(
      /Using this much context may limit the chat session and reduce room for uploading additional files\./i,
    );
    await expect(warningText).toBeVisible({ timeout: 60000 });

    await page.getByRole("button", { name: /create assistant/i }).click();
    await expect(page.getByText(/assistant created successfully/i)).toBeVisible(
      { timeout: 5000 },
    );
    await page.waitForURL("/assistants", { timeout: 5000 });

    const assistantButton = page.getByRole("button", {
      name: new RegExp(assistantName),
    });
    await expect(assistantButton).toBeVisible();

    const assistantCard = assistantButton.locator("..");
    const menuButton = assistantCard.getByRole("button", {
      name: /menu|more|options/i,
    });
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    const editOption = page.getByRole("menuitem", { name: /edit/i });
    await expect(editOption).toBeVisible();
    await editOption.click();

    await expect(
      page.getByRole("heading", { name: /edit assistant/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /save changes/i }),
    ).toBeEnabled({ timeout: 60000 });
    await expect(
      page.getByText(
        /Context usage exceeds model capacity\. The assistant can't be created like this\./i,
      ),
    ).toBeHidden();
    await expect(warningText).toBeVisible({ timeout: 60000 });
  },
);
