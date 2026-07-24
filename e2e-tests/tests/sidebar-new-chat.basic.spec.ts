import { test, expect, Page } from "@playwright/test";
import { TAG_CI } from "./tags";
import {
  chatIsReadyToChat,
  chatIdFromUrl,
  ensureOpenSidebar,
  RECENT_CHATS_ROUTE,
  RECENT_CHATS_URL,
  sendFirstMessage,
} from "./shared";

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

/**
 * Deliver only the `chat_created` frame to the client and then end the stream
 * on demand, dropping everything after it (so `user_message_saved` is never
 * processed). Modelled on `holdStreamAfterChatCreated`, but it truncates the
 * stream at the frame boundary instead of parking the untouched remainder:
 * even when the backend batches `chat_created` and `user_message_saved` into
 * one chunk, only `chat_created` reaches the client. Must be installed before
 * the first navigation; `close()` ends the delivered stream.
 */
const closeStreamAfterChatCreated = async (page: Page) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let close: () => void = () => {};
    const closeRequested = new Promise<void>((resolve) => {
      close = resolve;
    });
    const tapWindow = window as Window & { __closeHeldStream?: () => void };
    tapWindow.__closeHeldStream = () => close();

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
      const encoder = new TextEncoder();
      let seen = "";
      let deliveredChatCreated = false;

      const truncated = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (deliveredChatCreated) {
            // The client has the chat_created frame; end the stream on trigger.
            await closeRequested;
            controller.close();
            void upstream.cancel().catch(() => {});
            return;
          }
          // Read until a complete chat_created frame is buffered, forward just
          // that frame, and stop reading so nothing after it is delivered.
          for (;;) {
            const { done, value } = await upstream.read();
            if (done) {
              controller.close();
              return;
            }
            seen += decoder.decode(value, { stream: true });
            const start = seen.indexOf("chat_created");
            const frameEnd = start !== -1 ? seen.indexOf("\n\n", start) : -1;
            if (frameEnd !== -1) {
              controller.enqueue(encoder.encode(seen.slice(0, frameEnd + 2)));
              deliveredChatCreated = true;
              return;
            }
          }
        },
        cancel(reason) {
          void upstream.cancel(reason).catch(() => {});
        },
      });

      return new Response(truncated, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  });

  return {
    close: async () => {
      await page.evaluate(() => {
        (
          window as Window & { __closeHeldStream?: () => void }
        ).__closeHeldStream?.();
      });
    },
  };
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
      // The aria-label stops being the untitled fallback once the backend row
      // carries any resolved title. That proves the local placeholder gave way
      // to the backend-titled row; the label flips for any non-empty title, so
      // it is not evidence that a summary specifically was generated.
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

test(
  "a first turn that ends before its message is saved leaves no ghost row",
  { tag: TAG_CI },
  async ({ page }) => {
    const streamClose = await closeStreamAfterChatCreated(page);
    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);

    const sidebar = page.getByRole("complementary");
    const listHold = await holdRecentChats(page);

    try {
      const chatId = await sendFirstMessage(
        page,
        "Please write a short poem about the moon",
      );
      const row = sidebar.locator(`[data-chat-id="${chatId}"]`);
      await expect(row).toBeVisible({ timeout: 5000 });
      // Only chat_created has been delivered, so the turn is provably parked
      // mid-flight with the placeholder showing.
      await expect(
        page.getByTestId("chat-input-stop-generation"),
      ).toBeVisible();

      // End the stream after chat_created and before user_message_saved. The
      // chat never gets a saved message, so it can never be listed; the only
      // thing that can take its placeholder away is the terminal
      // clearPendingChat on the stream's normal close.
      await streamClose.close();

      await expect(row).toHaveCount(0);
      // recent_chats is still held, so the removal cannot be the list dropping
      // the chat — only the close-path clear accounts for it.
      // eslint-disable-next-line playwright/no-wait-for-timeout -- additive grace recheck after the event-bounded absence assertion above
      await page.waitForTimeout(1000);
      await expect(row).toHaveCount(0);
    } finally {
      await listHold.dispose();
    }
  },
);
