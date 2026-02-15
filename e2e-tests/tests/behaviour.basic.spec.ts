import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, ensureOpenSidebar } from "./shared";

test(
  "Can open new chat page and input is focused",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

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

test(
  "Can rename a chat from the sidebar menu and clear the custom title",
  { tag: TAG_CI },
  async ({ page }) => {
    const renamedTitle = "Updated via E2E";
    const updateBodies: Array<Record<string, unknown> | undefined> = [];

    await page.route("**/api/v1beta/me/chats/*", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        const raw = request.postData();
        updateBodies.push(
          raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined,
        );
      }
      await route.continue();
    });

    await page.goto("/");
    await ensureOpenSidebar(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await textbox.fill("give me a one-line poem");
    await textbox.press("Enter");
    await chatIsReadyToChat(page, { expectAssistantResponse: true });

    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);
    const chatId = page.url().split("/").pop();
    await ensureOpenSidebar(page);
    const sidebar = page.getByRole("complementary");
    const chatItem = sidebar.locator(`[data-chat-id="${chatId}"]`);
    await expect(chatItem).toBeVisible();

    // Rename chat
    await chatItem.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("dialog", { name: "Rename chat" }).waitFor();

    const customTitleInput = page.getByRole("textbox", {
      name: "Custom title",
    });
    await customTitleInput.fill(renamedTitle);
    await page.getByRole("button", { name: "Rename" }).click();
    await expect(
      page.getByRole("dialog", { name: "Rename chat" }),
    ).toHaveCount(0);

    await expect(chatItem.getByText(renamedTitle)).toBeVisible();
    await expect.poll(() => updateBodies.length).toBeGreaterThan(0);
    expect(updateBodies[0]).toEqual({
      title_by_user_provided: renamedTitle,
    });

    // Clear custom title (submit empty input)
    await ensureOpenSidebar(page);
    await chatItem.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("dialog", { name: "Rename chat" }).waitFor();

    await customTitleInput.fill("");
    await page.getByRole("button", { name: "Rename" }).click();
    await expect(
      page.getByRole("dialog", { name: "Rename chat" }),
    ).toHaveCount(0);

    await expect(chatItem.getByText(renamedTitle)).toHaveCount(0);
    await expect.poll(() => updateBodies.length).toBeGreaterThan(1);
    expect(updateBodies[1]).toEqual({});
  },
);
