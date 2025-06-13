import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, login, ensureOpenSidebar } from "./shared";

test(
  "Can open new chat page and input is focused",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    await login(page, "admin@example.com");

    await expect(
      page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeFocused();
  },
);

test(
  "Can archive a non-focused chat via the sidebar menu",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await login(page, "admin@example.com");

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await ensureOpenSidebar(page);

    // Create first chat
    await textbox.fill("2-line poem about the sun");
    await textbox.press("Enter");
    await chatIsReadyToChat(page, { expectAssistantResponse: true });
    const firstChatUrl = page.url();
    const firstChatId = firstChatUrl.split("/").pop();

    // Create second chat

    await page.goto("/");
    // await page.getByRole("button", { name: "New Chat" }).click();
    await chatIsReadyToChat(page);
    const textbox2 = page.getByRole("textbox", { name: "Type a message..." });
    await textbox2.fill("2-line poem about the moon");
    await textbox2.press("Enter");
    await chatIsReadyToChat(page, { expectAssistantResponse: true });
    const secondChatUrl = page.url();
    const secondChatId = secondChatUrl.split("/").pop();

    expect(page.url()).toEqual(secondChatUrl);
    await ensureOpenSidebar(page);
    // Focus the second chat (should already be focused)
    // Archive the first chat via sidebar
    const sidebar = page.getByRole("complementary");
    const firstChatSidebarItem = sidebar.locator(
      `[data-chat-id="${firstChatId}"]`,
    );
    await expect(firstChatSidebarItem).toBeVisible();
    // Open the menu for the first chat
    await firstChatSidebarItem
      .getByRole("button", { name: "Open menu" })
      .click();
    // Click 'Remove' in the menu
    await page.getByRole("menuitem", { name: "Remove" }).click();
    // Confirm in the dialog
    await page.getByRole("button", { name: "Confirm action" }).click();
    // The first chat should no longer be in the sidebar
    await expect(
      sidebar.locator(`[data-chat-id="${firstChatId}"]`),
    ).toHaveCount(0);
    // The second chat should still be present
    await expect(
      sidebar.locator(`[data-chat-id="${secondChatId}"]`),
    ).toBeVisible();
    // We should still be on the second chat page
    expect(page.url()).toEqual(secondChatUrl);
  },
);
