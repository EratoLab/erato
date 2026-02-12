import { expect, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chatIsReadyToChat } from "./shared";
import { TAG_CI } from "./tags";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const selectMockModel = async (page: Page) => {
  const modelSelectorButton = page.locator(
    'button[aria-controls="model-selector-dropdown"]',
  );
  await expect(modelSelectorButton).toBeVisible();
  await modelSelectorButton.click();
  await page.getByRole("menuitem", { name: "Mock-LLM", exact: true }).click();
  await expect(modelSelectorButton).toContainText("Mock-LLM");
};

const uploadFileInChat = async (
  page: Page,
  file:
    | string
    | {
        name: string;
        mimeType: string;
        buffer: Buffer;
      },
) => {
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /upload files/i }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(file);
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

test(
  "Mock-LLM cite files links open files in a new tab for assistant and chat uploads",
  { tag: TAG_CI },
  async ({ page }) => {
    const randomSuffix = Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, "0");
    const assistantName = `Mock Cite Files Assistant-${randomSuffix}`;

    const assistantPdfPath = path.join(
      __dirname,
      "../test-files/sample-report-compressed.pdf",
    );
    const acmePdfSourcePath = path.join(
      __dirname,
      "../test-files/multipage-test.pdf",
    );
    const acmePdfBuffer = fs.readFileSync(acmePdfSourcePath);

    await page.goto("/assistants/new");
    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    await page.getByLabel(/name/i).fill(assistantName);
    await page
      .getByLabel(/system prompt/i)
      .fill("You are a helpful assistant that cites files.");

    const assistantFileInput = page.locator('input[type="file"]');
    await assistantFileInput.setInputFiles(assistantPdfPath);
    await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole("button", { name: /create assistant/i }).click();
    await expect(page.getByText(/assistant created successfully/i)).toBeVisible(
      {
        timeout: 10000,
      },
    );
    await page.waitForURL("/assistants", { timeout: 10000 });

    const assistantButton = page.getByRole("button", {
      name: new RegExp(assistantName),
    });
    await expect(assistantButton).toBeVisible();
    await assistantButton.click();

    await chatIsReadyToChat(page);
    await selectMockModel(page);

    await uploadFileInChat(page, {
      name: "Acme_Inc_Company_Overview.pdf",
      mimeType: "application/pdf",
      buffer: acmePdfBuffer,
    });
    await expect(page.getByText("Acme_Inc_C")).toBeVisible({
      timeout: 10000,
    });

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();
    await textbox.fill("cite files");
    await textbox.press("Enter");

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 30000,
    });

    const latestAssistantMessage = page.getByTestId("message-assistant").last();
    await expect(latestAssistantMessage).toBeVisible();

    const citationLinks = latestAssistantMessage.getByRole("link", {
      name: "Link",
    });
    await expect(citationLinks).toHaveCount(2);

    const chatUrlWithoutHash = page.url().split("#")[0];

    for (let i = 0; i < 2; i++) {
      const popupPromise = page.context().waitForEvent("page");
      await citationLinks.nth(i).click();
      const popup = await popupPromise;

      await expect
        .poll(() => popup.url(), { timeout: 10000 })
        .not.toBe("about:blank");
      const popupUrl = popup.url();

      const popupUrlWithoutHash = popupUrl.split("#")[0];
      expect(popupUrlWithoutHash).not.toBe(chatUrlWithoutHash);

      await popup.close();
    }
  },
);
