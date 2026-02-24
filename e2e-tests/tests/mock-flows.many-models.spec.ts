import { expect, Page, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  abortActiveStreamingRequest,
  chatIsReadyToChat,
  ensureOpenSidebar,
  setupStreamingRequestAbortHook,
} from "./shared";
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

const messageIsNotPresent = async (page: Page, messageId: string) => {
  const messageById = page.locator(`[data-message-id="${messageId}"]`);
  await expect
    .poll(async () => await messageById.count(), {
      timeout: 30000,
    })
    .toBe(0);
};

test(
  "Mock-LLM long-running streams continue independently across two chats",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();

    // Start first long-running chat
    await textbox.fill("long running 20");
    await textbox.press("Enter");
    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 10000 });
    const firstChatId = page.url().split("/").pop();
    expect(firstChatId).toBeTruthy();

    await expect(page.getByText("Second 5 passed")).toBeVisible({
      timeout: 20000,
    });

    // Start second long-running chat
    await page.goto("/chat/new");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    await textbox.fill("long running 25");
    await textbox.press("Enter");
    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 10000 });
    const secondChatId = page.url().split("/").pop();
    expect(secondChatId).toBeTruthy();
    expect(secondChatId).not.toBe(firstChatId);

    await expect(page.getByText("Second 5 passed")).toBeVisible({
      timeout: 20000,
    });

    // Switch back to first chat; it should not be complete yet, then complete.
    await ensureOpenSidebar(page);
    await page
      .getByRole("complementary")
      .locator(`[data-chat-id="${firstChatId}"]`)
      .click();
    await expect(page).toHaveURL(new RegExp(`/chat/${firstChatId}$`));

    await expect(page.getByText("Complete!")).toHaveCount(0);
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      "Second 20 passed",
      {
        timeout: 40000,
      },
    );
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      "Complete!",
      {
        timeout: 40000,
      },
    );

    // Switch to second chat; it should not be complete yet, then complete.
    await ensureOpenSidebar(page);
    await page
      .getByRole("complementary")
      .locator(`[data-chat-id="${secondChatId}"]`)
      .click();
    await expect(page).toHaveURL(new RegExp(`/chat/${secondChatId}$`));

    await expect(page.getByText("Complete!")).toHaveCount(0);
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      "Second 25 passed",
      {
        timeout: 50000,
      },
    );
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      "Complete!",
      {
        timeout: 50000,
      },
    );
  },
);

test(
  "Mock-LLM long-running stream survives hard reload and completes",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(90000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();

    await textbox.fill("long running 15");
    await textbox.press("Enter");

    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 10000 });
    await expect(page.getByText("Second 5 passed")).toBeVisible({
      timeout: 20000,
    });

    // Hard reload the page while stream is still in progress.
    await page.reload();

    await expect(page.getByText("Second 5 passed")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("Complete!")).toHaveCount(0);

    await expect(page.getByTestId("message-assistant").last()).toContainText(
      "Second 15 passed",
      {
        timeout: 30000,
      },
    );
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      "Complete!",
      {
        timeout: 30000,
      },
    );
  },
);

test(
  "Mock-LLM long-running stream resumes after network disruption",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);
    await setupStreamingRequestAbortHook(page);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();

    await textbox.fill("long running 20");
    await textbox.press("Enter");

    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 10000 });
    await expect(page.getByText("Second 5 passed")).toBeVisible({
      timeout: 20000,
    });

    // Interrupt the currently active stream request without reloading.
    await abortActiveStreamingRequest(page);

    // Streaming should recover and continue until completion.
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      "Second 20 passed",
      {
        timeout: 60000,
      },
    );
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      "Complete!",
      {
        timeout: 60000,
      },
    );
  },
);

test(
  "Mock-LLM delay shows optimistic user/loading quickly and completes within 5s",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();

    await textbox.fill("delay");
    await textbox.press("Enter");

    // Within 1s of submit we should already see optimistic user + assistant loading.
    await expect(page.getByTestId("message-user").last()).toContainText(
      "delay",
      {
        timeout: 1000,
      },
    );
    await expect(page.getByText("Loading")).toBeVisible({ timeout: 1000 });

    // Then streaming should complete in the next 10 seconds.
    await expect(page.getByText("Loading")).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByTestId("message-assistant").last()).toContainText(
      "After waiting for 5 seconds",
      {
        timeout: 10000,
      },
    );

    // Ensure no duplicate "delay" user message remains after optimistic reconciliation.
    await expect(
      page.getByTestId("message-user").filter({ hasText: "delay" }),
    ).toHaveCount(1);
  },
);

test(
  "File upload size error does not persist when switching back to an existing chat",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/chat/new");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();
    await textbox.fill("fast");
    await textbox.press("Enter");

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 20000,
    });
    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);
    const firstChatId = page.url().split("/").pop();
    expect(firstChatId).toBeTruthy();

    await page.goto("/chat/new");
    await chatIsReadyToChat(page);

    const bigFilePath = path.join(__dirname, "../test-files/big-file-20mb.pdf");
    await uploadFileInChat(page, bigFilePath);

    await expect(page.getByTestId("file-upload-error")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("file-upload-error")).toContainText(
      "File is too large",
      { timeout: 30000 },
    );

    await ensureOpenSidebar(page);
    await page
      .getByRole("complementary")
      .locator(`[data-chat-id="${firstChatId}"]`)
      .click();
    await expect(page).toHaveURL(new RegExp(`/chat/${firstChatId}$`));

    await expect(page.getByTestId("file-upload-error")).not.toBeVisible();
  },
);

test(
  "Draft message and selected files are preserved per chat when switching chats",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/chat/new");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();
    await textbox.fill("fast");
    await textbox.press("Enter");

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 20000,
    });
    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);
    const firstChatId = page.url().split("/").pop();
    expect(firstChatId).toBeTruthy();

    await page.goto("/chat/new");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    await textbox.fill("fast");
    await textbox.press("Enter");

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 20000,
    });
    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);
    const secondChatId = page.url().split("/").pop();
    expect(secondChatId).toBeTruthy();
    expect(secondChatId).not.toBe(firstChatId);

    await ensureOpenSidebar(page);
    await page
      .getByRole("complementary")
      .locator(`[data-chat-id="${firstChatId}"]`)
      .click();
    await expect(page).toHaveURL(new RegExp(`/chat/${firstChatId}$`));

    const firstChatDraft = "chat one draft text";
    await textbox.fill(firstChatDraft);
    const sampleReportPath = path.join(
      __dirname,
      "../test-files/sample-report-compressed.pdf",
    );
    await uploadFileInChat(page, sampleReportPath);
    await expect(page.getByText(/Attachments/i)).toBeVisible();
    await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible({
      timeout: 10000,
    });

    await ensureOpenSidebar(page);
    await page
      .getByRole("complementary")
      .locator(`[data-chat-id="${secondChatId}"]`)
      .click();
    await expect(page).toHaveURL(new RegExp(`/chat/${secondChatId}$`));

    await expect(textbox).toHaveValue("");
    await expect(page.getByText(/Attachments/i)).toHaveCount(0);

    const secondChatDraft = "chat two draft text";
    await textbox.fill(secondChatDraft);

    await ensureOpenSidebar(page);
    await page
      .getByRole("complementary")
      .locator(`[data-chat-id="${firstChatId}"]`)
      .click();
    await expect(page).toHaveURL(new RegExp(`/chat/${firstChatId}$`));

    await expect(textbox).toHaveValue(firstChatDraft);
    await expect(page.getByText(/Attachments/i)).toBeVisible();
    await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible({
      timeout: 10000,
    });

    await ensureOpenSidebar(page);
    await page
      .getByRole("complementary")
      .locator(`[data-chat-id="${secondChatId}"]`)
      .click();
    await expect(page).toHaveURL(new RegExp(`/chat/${secondChatId}$`));

    await expect(textbox).toHaveValue(secondChatDraft);
    await expect(page.getByText(/Attachments/i)).toHaveCount(0);
  },
);

test(
  "Mock-LLM MCP flow executes a normal tool call successfully",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();
    await textbox.fill("read mock file");
    await textbox.press("Enter");

    const latestAssistantMessage = page.getByTestId("message-assistant").last();
    await expect(latestAssistantMessage).toBeVisible();

    const toolCallsToggle = latestAssistantMessage.getByRole("button", {
      name: /Tool calls \(/i,
    });
    await expect(toolCallsToggle).toBeVisible({ timeout: 30000 });
    await toolCallsToggle.click();

    await expect(latestAssistantMessage).toContainText("read_file");

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 30000,
    });
    await expect(latestAssistantMessage).toContainText(
      "The secret content has been read successfully.",
      { timeout: 15000 },
    );
    await expect(
      latestAssistantMessage.getByTestId("chat-message-error"),
    ).toHaveCount(0);
  },
);

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

test(
  "Mock-LLM editing a file-based message preserves the attachment context",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(90000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const pdfPath = path.join(
      __dirname,
      "../test-files/sample-report-compressed.pdf",
    );

    await uploadFileInChat(page, pdfPath);
    await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible({
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

    const initialAssistantMessage = page
      .getByTestId("message-assistant")
      .last();
    await expect(initialAssistantMessage).toBeVisible();
    const initialAssistantMessageId =
      await initialAssistantMessage.getAttribute("data-message-id");
    expect(initialAssistantMessageId).toBeTruthy();
    await expect(
      initialAssistantMessage.getByRole("link", { name: "Link" }),
    ).toHaveCount(1);

    const userMessage = page
      .getByTestId("message-user")
      .filter({ hasText: "cite files" })
      .last();
    const userMessageId = await userMessage.getAttribute("data-message-id");
    expect(userMessageId).toBeTruthy();
    await userMessage.hover();

    const editButton = userMessage.getByLabel("Edit message");
    await editButton.waitFor({ state: "visible", timeout: 10000 });
    await editButton.click();

    const editTextbox = page.getByRole("textbox", {
      name: "Edit your message...",
    });
    await expect(editTextbox).toBeVisible({ timeout: 30000 });
    await editTextbox.clear();
    await editTextbox.fill("please cite files after edit");

    const saveButton = page.getByTestId("chat-input-save-edit");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 30000,
    });

    await messageIsNotPresent(page, userMessageId!);
    await messageIsNotPresent(page, initialAssistantMessageId!);

    const editedAssistantMessage = page.getByTestId("message-assistant").last();
    await expect(editedAssistantMessage).toBeVisible();
    await expect(
      editedAssistantMessage.getByRole("link", { name: "Link" }),
    ).toHaveCount(1);
  },
);

test(
  "Mock-LLM editing a file-based message can remove attachment context",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(90000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const pdfPath = path.join(
      __dirname,
      "../test-files/sample-report-compressed.pdf",
    );

    await uploadFileInChat(page, pdfPath);
    await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible({
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

    const initialAssistantMessage = page
      .getByTestId("message-assistant")
      .last();
    await expect(initialAssistantMessage).toBeVisible();
    const initialAssistantMessageId =
      await initialAssistantMessage.getAttribute("data-message-id");
    expect(initialAssistantMessageId).toBeTruthy();
    await expect(
      initialAssistantMessage.getByRole("link", { name: "Link" }),
    ).toHaveCount(1);

    const userMessage = page
      .getByTestId("message-user")
      .filter({ hasText: "cite files" })
      .last();
    const userMessageId = await userMessage.getAttribute("data-message-id");
    expect(userMessageId).toBeTruthy();
    await userMessage.hover();

    const editButton = userMessage.getByLabel("Edit message");
    await editButton.waitFor({ state: "visible", timeout: 10000 });
    await editButton.click();

    const editTextbox = page.getByRole("textbox", {
      name: "Edit your message...",
    });
    await expect(editTextbox).toBeVisible({ timeout: 30000 });

    await expect(page.getByText(/Attachments/i)).toBeVisible();
    await page
      .locator(
        'button[aria-label*="Remove sample-report-compressed.pdf"]:not([disabled])',
      )
      .first()
      .click({ timeout: 10000 });
    await expect(page.getByText(/Attachments/i)).not.toBeVisible();

    await editTextbox.clear();
    await editTextbox.fill("please cite files after removing file");

    const saveButton = page.getByTestId("chat-input-save-edit");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 30000,
    });

    await messageIsNotPresent(page, userMessageId!);
    await messageIsNotPresent(page, initialAssistantMessageId!);

    const editedAssistantMessage = page.getByTestId("message-assistant").last();
    await expect(editedAssistantMessage).toBeVisible();
    await expect(
      editedAssistantMessage.getByRole("link", { name: "Link" }),
    ).toHaveCount(0);
    await expect(editedAssistantMessage).toContainText(
      "No [Link](erato-file://<uuid",
    );
  },
);
