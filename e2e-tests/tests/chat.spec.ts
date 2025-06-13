import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, login } from "./shared";

test(
  "Can upload a file and see it in the UI",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");

    await login(page, "admin@example.com");
    await chatIsReadyToChat(page);

    // Start waiting for file chooser before clicking the button
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("Upload Files").click();
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

    await login(page, "admin@example.com");
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
