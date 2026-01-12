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

    await chatIsReadyToChat(page, { expectAssistantResponse: true });

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
    );
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
