import { expect, test } from "@playwright/test";

import {
  chatIsReadyToChat,
  createAuthenticatedContext,
  ensureOpenSidebar,
  selectModel,
} from "./shared";
import { TAG_CI } from "./tags";

import type { Page } from "@playwright/test";

const createChat = async (page: Page, message: string) => {
  await page.goto("/chat/new");
  await chatIsReadyToChat(page);
  await selectModel(page, "Mock-LLM");

  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await textbox.fill(message);
  await textbox.press("Enter");

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: 20000,
  });

  await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);
  return page.url().split("/").pop() ?? "";
};

test(
  "Archive all chats reloads recent chats and redirects to a fresh chat page",
  { tag: TAG_CI },
  async ({ browser, browserName }) => {
    test.setTimeout(90000);

    const email =
      browserName === "firefox" ? "user06@example.com" : "user05@example.com";
    const { context, page } = await createAuthenticatedContext(browser, email);

    try {
      const recentChatsRequests: number[] = [];
      await page.route("**/api/v1beta/me/recent_chats*", async (route) => {
        recentChatsRequests.push(Date.now());
        await route.continue();
      });

      const firstChatId = await createChat(page, "Delete-all-chats test one");
      const secondChatId = await createChat(page, "Delete-all-chats test two");

      expect(firstChatId).not.toBe(secondChatId);

      await ensureOpenSidebar(page);
      const sidebar = page.getByRole("complementary");
      await expect(
        sidebar.locator(`[data-chat-id="${firstChatId}"]`),
      ).toBeVisible();
      await expect(
        sidebar.locator(`[data-chat-id="${secondChatId}"]`),
      ).toBeVisible();

      const requestsBeforeArchive = recentChatsRequests.length;

      await page
        .getByRole("button")
        .filter({ has: page.getByTestId("avatar-identity") })
        .click();
      await page.getByRole("menuitem", { name: "Preferences" }).click();
      await page.getByRole("tab", { name: "Data" }).click();
      await page.getByRole("button", { name: "Archive all chats" }).click();

      const archiveAllResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1beta/me/chats/archive_all") &&
          response.request().method() === "POST",
      );

      await page.getByRole("button", { name: "Confirm action" }).click();
      await archiveAllResponsePromise;

      await expect
        .poll(() => recentChatsRequests.length, {
          timeout: 15000,
        })
        .toBeGreaterThan(requestsBeforeArchive);

      await expect(page).toHaveURL(/\/chat\/new$/);
      await expect(
        page.getByRole("dialog", { name: "Preferences" }),
      ).toHaveCount(0);
      await expect(
        sidebar.locator(`[data-chat-id="${firstChatId}"]`),
      ).toHaveCount(0);
      await expect(
        sidebar.locator(`[data-chat-id="${secondChatId}"]`),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  },
);
