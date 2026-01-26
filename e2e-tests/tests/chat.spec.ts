import { test, expect } from "@playwright/test";
import { TAG_CI, TAG_NO_CI } from "./tags";
import { chatIsReadyToChat } from "./shared";

test(
  "Can upload a file and see it in the UI",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);

    // Start waiting for file chooser before clicking the button
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload Files" }).click();
    const fileChooser = await fileChooserPromise;

    const filePath = "test-files/sample-report-compressed.pdf";
    await fileChooser.setFiles(filePath);

    await expect(page.getByText("PDF", { exact: true })).toBeVisible();
    await expect(page.getByText("Attachments")).toBeVisible();
  },
);

test(
  "Can submit a message and get a response",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();

    await page.getByLabel("expand sidebar").click();

    await textbox.fill("Please write a short poem about the sun");
    await textbox.press("Enter");

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 15000,
    });

    // Verify that the URL is a chat URL and save the chat ID
    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);
    const url = page.url();
    const chatId = url.split("/").pop();

    // Verify that the new chat session appears in the sidebar
    const sidebar = page.getByRole("complementary");
    const chatSessionLink = sidebar.locator(`[data-chat-id="${chatId}"]`);
    await expect(chatSessionLink).toBeVisible();

    // Verify that ctrl-clicking the link opens a new tab
    const newPagePromise = page.context().waitForEvent("page");
    await chatSessionLink.click({ modifiers: ["ControlOrMeta"] });
    const newPage = await newPagePromise;
    await chatIsReadyToChat(newPage);
    expect(newPage.url()).toContain(`/chat/${chatId}`);
    await newPage.close();
  },
);

// Test matrix: Test submitting a message with artificial delays on different routes
test.describe("Can submit a message and get a response with slow routes", () => {
  const slowRoutes = [
    { route: "/api/v1beta/me/budget", pattern: "**/api/v1beta/me/budget*" },
    { route: "/api/v1beta/me/models", pattern: "**/api/v1beta/me/models*" },
    {
      route: "/api/v1beta/me/recent_chats",
      pattern: "**/api/v1beta/me/recent_chats*",
    },
    {
      route: "/api/v1beta/chats/*/messages",
      pattern: "**/api/v1beta/chats/*/messages*",
    },
    { route: "/api/v1beta/me/profile", pattern: "**/api/v1beta/me/profile*" },
    {
      route: "/api/v1beta/me/messages/submitstream",
      pattern: "**/api/v1beta/me/messages/submitstream*",
    },
  ];

  for (const slowRoute of slowRoutes) {
    test(`with slow ${slowRoute.route}`, { tag: TAG_CI }, async ({ page }) => {
      // Intercept the specified route and add a 2-second delay
      await page.route(slowRoute.pattern, async (route) => {
        console.log(
          `[E2E] Slowing down request to ${slowRoute.route} by 2 seconds`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.continue();
      });

      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });
      await expect(textbox).toBeVisible();

      await page.getByLabel("expand sidebar").click();

      await textbox.fill("Please write a short poem about the sun");
      await textbox.press("Enter");

      await chatIsReadyToChat(page, {
        expectAssistantResponse: true,
        loadingTimeoutMs: 15000,
      });

      // Verify that the URL is a chat URL and save the chat ID
      await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);
      const url = page.url();
      const chatId = url.split("/").pop();

      // Verify that the new chat session appears in the sidebar
      const sidebar = page.getByRole("complementary");
      const chatSessionLink = sidebar.locator(`[data-chat-id="${chatId}"]`);
      await expect(chatSessionLink).toBeVisible();

      // Verify that ctrl-clicking the link opens a new tab
      const newPagePromise = page.context().waitForEvent("page");
      await chatSessionLink.click({ modifiers: ["ControlOrMeta"] });
      const newPage = await newPagePromise;
      await chatIsReadyToChat(newPage);
      expect(newPage.url()).toContain(`/chat/${chatId}`);
      await newPage.close();
    });
  }
});

test(
  "Uploading a file that is too large shows an error",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);

    // Start waiting for file chooser before clicking the button
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload Files" }).click();
    const fileChooser = await fileChooserPromise;

    const filePath = "test-files/big-file-20mb.pdf";
    await fileChooser.setFiles(filePath);

    // Use data-testid for robust error checking
    await expect(page.getByTestId("file-upload-error")).toBeVisible({
      // Increased timeout, as uploading a 20MB file can take a while
      timeout: 30000,
    });

    // Verify the error message content
    await expect(page.getByTestId("file-upload-error")).toContainText(
      "File is too large",
      { timeout: 30000 },
    );
  },
);

test(
  "Uploading an unsupported file type shows an error and blocks upload",
  { tag: TAG_CI },
  async ({ page }) => {
    // Track network requests to verify no upload request is made
    const uploadRequests: string[] = [];
    await page.route("**/api/v1beta/me/files*", async (route) => {
      uploadRequests.push(route.request().url());
      await route.continue();
    });

    await page.goto("/");
    await chatIsReadyToChat(page);

    // Start waiting for file chooser before clicking the button
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload Files" }).click();
    const fileChooser = await fileChooserPromise;

    // Create a test file with an unsupported extension (.zip)
    // Using a Buffer to create an in-memory file
    await fileChooser.setFiles({
      name: "test-archive.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("fake zip content for testing"),
    });

    // Use data-testid for robust error checking
    await expect(page.getByTestId("file-upload-error")).toBeVisible({
      timeout: 10000,
    });

    // Verify the error message mentions the file cannot be processed
    await expect(page.getByTestId("file-upload-error")).toContainText(
      "cannot be processed",
      { timeout: 10000 },
    );

    // Verify that the specific filename is mentioned
    await expect(page.getByTestId("file-upload-error")).toContainText(
      "test-archive.zip",
      { timeout: 10000 },
    );

    // Verify that no upload request was made (file was blocked before upload)
    expect(uploadRequests.length).toBe(0);

    // Verify no file appears in the attachments
    await expect(page.getByText("Attachments")).not.toBeVisible();
  },
);

test(
  "Uploading multiple files with some unsupported blocks all files",
  { tag: TAG_CI },
  async ({ page }) => {
    // Track network requests to verify no upload request is made
    const uploadRequests: string[] = [];
    await page.route("**/api/v1beta/me/files*", async (route) => {
      uploadRequests.push(route.request().url());
      await route.continue();
    });

    await page.goto("/");
    await chatIsReadyToChat(page);

    // Start waiting for file chooser before clicking the button
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload Files" }).click();
    const fileChooser = await fileChooserPromise;

    // Upload multiple files: one valid PDF and one invalid ZIP
    await fileChooser.setFiles([
      {
        name: "valid-document.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("fake pdf content"),
      },
      {
        name: "invalid-archive.zip",
        mimeType: "application/zip",
        buffer: Buffer.from("fake zip content"),
      },
    ]);

    // Use data-testid for robust error checking
    await expect(page.getByTestId("file-upload-error")).toBeVisible({
      timeout: 10000,
    });

    // Verify the error message mentions the invalid file
    await expect(page.getByTestId("file-upload-error")).toContainText(
      "invalid-archive.zip",
      { timeout: 10000 },
    );

    // Verify that no upload request was made (all files blocked)
    expect(uploadRequests.length).toBe(0);

    // Verify no files appear in the attachments
    await expect(page.getByText("Attachments")).not.toBeVisible();
  },
);

// no-ci for right now, as sometimes the LLM doesn't accept that it has ability to analyze images
test(
  "Can upload an image and get AI response about its contents",
  { tag: TAG_NO_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);

    // Start waiting for file chooser before clicking the button
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload Files" }).click();
    const fileChooser = await fileChooserPromise;

    // Upload the test image
    const filePath = "test-files/image_1.png";
    await fileChooser.setFiles(filePath);

    // Verify the image file appears in the UI
    await expect(page.getByText("image_1.png")).toBeVisible();
    await expect(page.getByText("Attachments")).toBeVisible();

    // Submit a message asking about the image contents
    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();
    await textbox.fill(
      "Can you please tell me what the contents of the image are?",
    );
    await textbox.press("Enter");

    // Wait for the assistant response
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 30000,
    });

    // Get the assistant message content
    const assistantMessage = page.getByTestId("message-assistant");
    await expect(assistantMessage).toBeVisible();

    // Verify that the response mentions "cat" (case-insensitive)
    const messageText = await assistantMessage.textContent();
    expect(messageText?.toLowerCase()).toContain("cat");
  },
);
