import { test, expect, Page } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, ensureOpenSidebar } from "./shared";

const RECENT_CHATS_ROUTE = "**/api/v1beta/me/recent_chats*";
const RECENT_CHATS_URL = "/api/v1beta/me/recent_chats";
/** What ChatHistoryList renders for a chat without a resolved title. */
const UNTITLED_ROW_LABEL = "New Chat";

/**
 * Park every list request until released, so a row that shows up in that window
 * can only have come from local state. That is the whole point: a chat has no
 * messages yet when it is created, so the server would not list it at that
 * moment anyway.
 */
const holdRecentChats = async (page: Page) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(RECENT_CHATS_ROUTE, async (route) => {
    await released;
    // The page may have navigated on by now; a dead request is not a failure.
    await route.continue().catch(() => {});
  });

  return {
    release,
    /** Safe to call twice, and must run even when an assertion threw. */
    dispose: async () => {
      release();
      await page.unroute(RECENT_CHATS_ROUTE).catch(() => {});
    },
  };
};

/**
 * Park the submitstream response right after the `chat_created` frame, so the
 * window in which the chat exists but is not listable lasts as long as the test
 * needs instead of as long as the model happens to take. Must be installed
 * before the first navigation, and released before the turn can finish.
 */
const holdStreamAfterChatCreated = async (page: Page) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tapWindow = window as Window & { __releaseHeldStream?: () => void };
    tapWindow.__releaseHeldStream = () => release();

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      const response = await originalFetch(input, init);
      if (
        !url.includes("/api/v1beta/me/messages/submitstream") ||
        !response.body
      ) {
        return response;
      }

      const upstream = response.body.getReader();
      const decoder = new TextDecoder();
      let seen = "";
      let holding = false;

      const parked = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (holding) {
            await released;
          }
          const { done, value } = await upstream.read();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue(value);
          if (!holding) {
            // Frames can be split across chunks, so match on the running text.
            seen += decoder.decode(value, { stream: true });
            holding = seen.includes("chat_created");
          }
        },
        cancel(reason) {
          void upstream.cancel(reason).catch(() => {});
        },
      });

      return new Response(parked, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  });

  return {
    release: async () => {
      await page.evaluate(() => {
        (
          window as Window & { __releaseHeldStream?: () => void }
        ).__releaseHeldStream?.();
      });
    },
  };
};

/**
 * Resolves once the submitstream request is over, however it ends. Must be
 * registered before the turn is started.
 */
const waitForStreamEnd = (page: Page) =>
  new Promise<void>((resolve) => {
    const isStream = (url: string) =>
      url.includes("/api/v1beta/me/messages/submitstream");
    page.on("requestfinished", (request) => {
      if (isStream(request.url())) {
        resolve();
      }
    });
    page.on("requestfailed", (request) => {
      if (isStream(request.url())) {
        resolve();
      }
    });
  });

const chatIdFromUrl = (page: Page): string => {
  const match = /\/chat\/([0-9a-fA-F-]+)/.exec(page.url());
  if (!match) {
    throw new Error(`Expected a chat id in the URL, got: ${page.url()}`);
  }
  return match[1];
};

const sendFirstMessage = async (page: Page, message: string) => {
  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await textbox.fill(message);
  await textbox.press("Enter");

  // Navigation happens at chat_created, so the id is known long before the
  // turn ends.
  await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 15000 });
  return chatIdFromUrl(page);
};

test(
  "a new chat is listed in the sidebar as soon as it is created",
  { tag: TAG_CI },
  async ({ page }) => {
    const streamHold = await holdStreamAfterChatCreated(page);
    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);

    const sidebar = page.getByRole("complementary");
    const listHold = await holdRecentChats(page);

    try {
      const chatId = await sendFirstMessage(
        page,
        "Please write a short poem about the sun",
      );

      const row = sidebar.locator(`[data-chat-id="${chatId}"]`);
      const rowLink = sidebar.locator(`a:has([data-chat-id="${chatId}"])`);
      await expect(row).toBeVisible({ timeout: 5000 });
      // The row renders already highlighted, without waiting for the list.
      await expect(rowLink).toHaveAttribute("aria-current", "page");
      // Nothing has a title to offer yet, so the placeholder shows the
      // untitled-chat fallback.
      await expect(rowLink).toHaveAttribute("aria-label", UNTITLED_ROW_LABEL);

      // The completion path waits on this same request.
      listHold.release();
      await streamHold.release();

      await chatIsReadyToChat(page, {
        expectAssistantResponse: true,
        loadingTimeoutMs: 60000,
      });

      // The placeholder is replaced by the real row, not added alongside it.
      await expect(row).toHaveCount(1);
      // The summarizer-generated title takes over from the placeholder, which
      // renders the untitled-chat fallback. It arrives well after the turn.
      await expect(rowLink).not.toHaveAttribute(
        "aria-label",
        UNTITLED_ROW_LABEL,
        { timeout: 60000 },
      );
    } finally {
      await listHold.dispose();
    }
  },
);

test(
  "resuming a stream does not duplicate the new chat's sidebar row",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);

    const chatId = await sendFirstMessage(
      page,
      "Please write a long detailed poem about the sun",
    );
    const sidebar = page.getByRole("complementary");
    await expect(sidebar.locator(`[data-chat-id="${chatId}"]`)).toBeVisible({
      timeout: 5000,
    });

    // Only a reload taken while the turn is genuinely in flight resumes a
    // stream and replays chat_created; the Stop control is present iff a turn
    // is in flight.
    await expect(page.getByTestId("chat-input-stop-generation")).toBeVisible();
    await page.reload();
    await ensureOpenSidebar(page);
    await chatIsReadyToChat(page, { loadingTimeoutMs: 60000 });

    await expect(sidebar.locator(`[data-chat-id="${chatId}"]`)).toHaveCount(1);
  },
);

test(
  "removing a new chat before it is listed leaves no ghost row",
  { tag: TAG_CI },
  async ({ page }) => {
    const streamHold = await holdStreamAfterChatCreated(page);
    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);

    const sidebar = page.getByRole("complementary");
    const listHold = await holdRecentChats(page);

    try {
      const streamEnded = waitForStreamEnd(page);
      const chatId = await sendFirstMessage(
        page,
        "Please write a short poem about the moon",
      );

      const row = sidebar.locator(`[data-chat-id="${chatId}"]`);
      await expect(row).toBeVisible({ timeout: 5000 });
      // The turn is parked, so the removal below provably happens inside the
      // window where only local state accounts for the row.
      await expect(
        page.getByTestId("chat-input-stop-generation"),
      ).toBeVisible();

      // Remove the row while the list still cannot account for it, so nothing
      // but local state can take it away again.
      await row.hover();
      await row.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("menuitem", { name: "Remove" }).click();
      await page.getByRole("button", { name: "Confirm action" }).click();

      await expect(row).toHaveCount(0);

      // Archiving invalidates the list, so releasing lets the answer that
      // legitimately omits this chat land. The row must not come back with it.
      const listSettled = page.waitForResponse(
        (response) => response.url().includes(RECENT_CHATS_URL),
        { timeout: 30000 },
      );
      listHold.release();
      await listSettled;

      await expect(row).toHaveCount(0);
      // The turn outlives the removal, so let it end before calling it gone.
      await streamHold.release();
      await streamEnded;
      await expect(row).toHaveCount(0);
    } finally {
      await listHold.dispose();
    }
  },
);
