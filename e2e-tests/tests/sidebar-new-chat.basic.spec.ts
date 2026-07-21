import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, ensureOpenSidebar } from "./shared";

test(
  "a new chat is listed in the sidebar as soon as it is created",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);

    const sidebar = page.getByRole("complementary");

    // Hold the list endpoint back for as long as the assertions below run, so
    // a row that shows up in that window can only have come from local state.
    // That is the whole point: a chat has no messages yet when it is created,
    // so the server would not list it at that moment anyway. The delay is
    // lifted afterwards — the completion path waits on this same request.
    let holdList = true;
    await page.route("**/api/v1beta/me/recent_chats*", async (route) => {
      while (holdList) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await route.continue();
    });

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await textbox.fill("Please write a short poem about the sun");
    await textbox.press("Enter");

    // Navigation happens at chat_created, so the id is known long before the
    // turn ends.
    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 15000 });
    const chatId = page.url().split("/").pop();

    const row = sidebar.locator(`[data-chat-id="${chatId}"]`);
    await expect(row).toBeVisible({ timeout: 5000 });
    // The row renders already highlighted, without waiting for the list to load.
    await expect(
      sidebar.locator(`a:has([data-chat-id="${chatId}"])`),
    ).toHaveAttribute("aria-current", "page");

    holdList = false;

    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 60000,
    });

    // The placeholder is replaced by the real row, not added alongside it.
    await expect(row).toHaveCount(1);
    // The real title arrives and overwrites the empty placeholder title.
    await expect(row).not.toBeEmpty();
  },
);

test(
  "resuming a stream does not duplicate the new chat's sidebar row",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await textbox.fill("Please write a long detailed poem about the sun");
    await textbox.press("Enter");

    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 15000 });
    const chatId = page.url().split("/").pop();
    const sidebar = page.getByRole("complementary");
    await expect(sidebar.locator(`[data-chat-id="${chatId}"]`)).toBeVisible({
      timeout: 5000,
    });

    // Reloading mid-turn resumes the stream, which replays chat_created.
    await page.reload();
    await ensureOpenSidebar(page);
    await chatIsReadyToChat(page, { loadingTimeoutMs: 60000 });

    await expect(sidebar.locator(`[data-chat-id="${chatId}"]`)).toHaveCount(1);
  },
);
