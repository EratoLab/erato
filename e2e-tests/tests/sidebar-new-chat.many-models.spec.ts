import { test, expect, Page } from "@playwright/test";
import { TAG_CI } from "./tags";
import {
  chatIsReadyToChat,
  chatIdFromUrl,
  ensureOpenSidebar,
  RECENT_CHATS_ROUTE,
  RECENT_CHATS_URL,
  selectModel,
  sendFirstMessage,
} from "./shared";

/**
 * These tests need a turn that streams and completes on demand, but nothing
 * about the model's output. Mock-LLM gives that deterministically: `long
 * running N` streams `Second 1 passed … Second N passed`, one per second, so a
 * turn is provably in flight for N seconds and finished after — no dependence
 * on a real model's quota or speed. This is the same mechanism the
 * queue-and-streaming-composer suite uses. It lives in the many-models
 * scenario, which is why these tests are here rather than in the basic spec.
 */
const MOCK_MODEL = "Mock-LLM";

/**
 * Resolves once turn `turn` (1-indexed) has rendered its first streamed token:
 * its assistant reply has left the optimistic placeholder (a real, non-`temp-
 * assistant-` message id) *and* rendered its first markdown block. That moment
 * is after `user_message_saved` — so a window ending here captures the gated
 * refetch — and, for a multi-second reply, long before completion — so it
 * excludes the end-of-turn refetch. The `real >= turn` guard is load-bearing:
 * without it the still-present previous reply (already real, already holding a
 * block) would satisfy the predicate before this turn's reply even begins.
 */
const waitForFirstToken = (page: Page, turn: number) =>
  page.waitForFunction(
    (expected) => {
      const bubbles = Array.from(
        document.querySelectorAll('[data-testid="message-assistant"]'),
      );
      const isReal = (el: Element) => {
        const id = el.getAttribute("data-message-id") ?? "";
        return id !== "" && !id.startsWith("temp-assistant-");
      };
      if (bubbles.filter(isReal).length < expected) {
        return false;
      }
      const last = bubbles[bubbles.length - 1];
      return (
        last !== undefined &&
        isReal(last) &&
        last.querySelector("p,ul,ol,h1,h2,h3,pre,table") !== null
      );
    },
    turn,
    { timeout: 60000 },
  );

/**
 * Fulfil recent_chats normally but keep whichever chat is (or has been) open in
 * the URL out of every list response, so a just-created chat is never listable
 * and its row can only come from the placeholder. Unlike parking the request,
 * this does not hang the first turn's completion path (which awaits the list
 * refetch); a hung turn would keep a stream whose close would clear the
 * placeholder on its own, hiding whether the action under test is what cleared
 * it.
 */
const excludeOpenChatFromRecentChats = async (page: Page) => {
  const excluded = new Set<string>();
  await page.route(RECENT_CHATS_ROUTE, async (route) => {
    const response = await route.fetch();
    let body: {
      chats?: { id?: string }[];
      stats?: { returned_count?: number };
    };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      await route.fulfill({ response });
      return;
    }
    const match = /\/chat\/([0-9a-fA-F-]+)/.exec(page.url());
    if (match) {
      excluded.add(match[1]);
    }
    if (Array.isArray(body.chats) && excluded.size > 0) {
      const before = body.chats.length;
      body.chats = body.chats.filter((chat) => !excluded.has(chat.id ?? ""));
      if (body.stats && typeof body.stats.returned_count === "number") {
        body.stats.returned_count -= before - body.chats.length;
      }
    }
    await route.fulfill({ json: body });
  });
  return {
    dispose: async () => {
      await page.unroute(RECENT_CHATS_ROUTE).catch(() => {});
    },
  };
};

test(
  "resuming an in-flight stream replays chat_created without a duplicate sidebar row",
  { tag: TAG_CI },
  async ({ page }) => {
    // A paced turn plus a reload, resume, and completion runs past the default
    // per-test budget.
    test.setTimeout(120000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);
    await selectModel(page, MOCK_MODEL);

    const sidebar = page.getByRole("complementary");
    // A long paced turn, so the reload below attaches a resumestream to a task
    // that is provably still generating rather than one that already finished
    // and 404s.
    const chatId = await sendFirstMessage(page, "long running 12");
    const row = sidebar.locator(`[data-chat-id="${chatId}"]`);
    await expect(row).toBeVisible({ timeout: 5000 });
    // The first paced token confirms the turn is genuinely streaming.
    await expect(page.getByText("Second 1 passed")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("chat-input-stop-generation")).toBeVisible();

    // Register before the reload triggers it.
    const resumeResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1beta/me/messages/resumestream"),
      { timeout: 30000 },
    );

    await page.reload();
    await ensureOpenSidebar(page);

    const resumeResponse = await resumeResponsePromise;
    // A live task replays into a 2xx SSE stream; a finished/absent one 404s, so
    // 2xx is what proves the turn was genuinely resumed rather than having
    // quietly completed before the reload.
    expect(
      resumeResponse.ok(),
      `resumestream should replay a live task with a 2xx status, got ${resumeResponse.status()}`,
    ).toBe(true);

    // The placeholder that the replayed chat_created re-creates and the now-
    // listed row are the same chat; the dedup keeps them from rendering as two
    // rows. This is the assertion the dedup guards.
    await expect(row).toHaveCount(1);

    // Reading the body drains the resume SSE stream, which closes only when the
    // backend turn ends, so this doubles as waiting for completion. The stream
    // replays the whole event history from the start, so its body carries the
    // chat_created frame that re-created the placeholder.
    const resumeBody = await resumeResponse.text();
    expect(resumeBody).toContain("chat_created");

    // With the turn finished, confirm the client settles and the row is still
    // single, not duplicated by the placeholder outliving the listed row.
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 60000,
    });
    await expect(row).toHaveCount(1);
  },
);

test(
  "returning to an abandoned new chat via the sidebar shows its in-flight user message",
  { tag: TAG_CI },
  async ({ page }) => {
    // A paced turn that must outlive the abandon, the sidebar round-trip, the
    // resume, and completion runs past the default per-test budget.
    test.setTimeout(120000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);
    await selectModel(page, MOCK_MODEL);

    const sidebar = page.getByRole("complementary");

    // Resolve once the gated refetch has listed this chat, so its sidebar row is
    // backed by recent_chats and survives the New Chat below — which clears only
    // the placeholder. Registered before the send so the refetch cannot be
    // missed; the `chatId` guard skips list responses that predate the id.
    let chatId = "";
    const firstChatListed = page.waitForResponse(
      async (response) => {
        if (!response.url().includes(RECENT_CHATS_URL) || !chatId) {
          return false;
        }
        try {
          const body = (await response.json()) as { chats?: { id?: string }[] };
          return (
            Array.isArray(body.chats) &&
            body.chats.some((entry) => entry.id === chatId)
          );
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    );

    // A long paced turn, so the return below attaches a resumestream to a task
    // that is provably still generating rather than one that already 404s.
    chatId = await sendFirstMessage(page, "long running 20");
    const row = sidebar.locator(`[data-chat-id="${chatId}"]`);
    const rowLink = sidebar.locator(`a:has([data-chat-id="${chatId}"])`);
    await expect(row).toBeVisible({ timeout: 5000 });
    // The first paced token confirms the turn is genuinely streaming.
    await expect(page.getByText("Second 1 passed")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("chat-input-stop-generation")).toBeVisible();

    await firstChatListed;

    // Abandon the still-streaming chat by starting a new one. This is the
    // load-bearing step: New Chat aborts the live SSE socket (abortAllSSE), so
    // the return has to re-attach via resumestream and replay chat_created +
    // user_message_saved, which is what puts the user message back. Clicking a
    // different existing chat instead would preserve the socket and never resume.
    await page.getByRole("button", { name: "New Chat" }).click();
    await expect(page).toHaveURL(/\/chat\/new$/);

    // Register before the row click triggers the resume.
    const resumeResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1beta/me/messages/resumestream"),
      { timeout: 30000 },
    );

    // Return to the abandoned chat through its (now listed) sidebar row.
    await ensureOpenSidebar(page);
    await expect(rowLink).toBeVisible();
    await rowLink.click();
    await expect(page).toHaveURL(new RegExp(`/chat/${chatId}$`));

    const resumeResponse = await resumeResponsePromise;
    // A live task replays into a 2xx SSE stream; a finished/absent one 404s, so
    // 2xx proves the turn was genuinely resumed rather than already complete.
    expect(
      resumeResponse.ok(),
      `resumestream should replay a live task with a 2xx status, got ${resumeResponse.status()}`,
    ).toBe(true);

    // The replayed user message is shown exactly once, ahead of the resuming
    // assistant reply.
    await expect(page.getByTestId("message-user")).toHaveCount(1);
    await expect(page.getByTestId("message-user")).toContainText(
      "long running 20",
    );
    await page.waitForFunction(
      () => {
        const user = document.querySelector('[data-testid="message-user"]');
        const assistant = document.querySelector(
          '[data-testid="message-assistant"]',
        );
        return (
          !!user &&
          !!assistant &&
          (user.compareDocumentPosition(assistant) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0
        );
      },
      undefined,
      { timeout: 15000 },
    );

    // The turn finishes cleanly and the user message is still the only one.
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 60000,
    });
    await expect(page.getByTestId("message-user")).toHaveCount(1);
  },
);

test(
  "the list refetch fires on a new chat's first turn but not on a listed chat's next turn",
  { tag: TAG_CI },
  async ({ page }) => {
    // Two paced turns plus their completions run past the default budget.
    test.setTimeout(180000);

    // Timestamp every list request so each can be attributed to a turn's window.
    const recentChatsAt: number[] = [];
    page.on("request", (request) => {
      if (request.url().includes(RECENT_CHATS_URL)) {
        recentChatsAt.push(Date.now());
      }
    });

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);
    // A paced reply keeps the reply streaming for many seconds, so the
    // completion refetch stays well clear of the first-token window.
    await selectModel(page, MOCK_MODEL);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    const stop = page.getByTestId("chat-input-stop-generation");
    const countInWindow = (start: number, end: number) =>
      recentChatsAt.filter((t) => t >= start && t <= end).length;

    // Turn 1 — a brand-new chat. It has no saved message when it is created, so
    // the sidebar renders it from the local placeholder; the gate must refetch
    // the list on `user_message_saved` to swap in the real, now-listable row.
    const start1 = Date.now();
    await textbox.fill("long running 10");
    await textbox.press("Enter");
    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 15000 });
    await waitForFirstToken(page, 1);
    const turn1Count = countInWindow(start1, Date.now());

    // Let turn 1 fully finish so its completion refetch cannot bleed into the
    // next window.
    await expect(stop).toHaveCount(0, { timeout: 90000 });

    // Turn 2 — the same chat, now listed and no longer pending. The gate must
    // skip: no list refetch belongs in the window before the reply streams.
    const start2 = Date.now();
    await textbox.fill("long running 10");
    await textbox.press("Enter");
    await waitForFirstToken(page, 2);
    const turn2Count = countInWindow(start2, Date.now());

    await expect(stop).toHaveCount(0, { timeout: 90000 });

    expect(
      turn1Count,
      "a new chat's first turn must refetch the list once its user message is saved",
    ).toBeGreaterThanOrEqual(1);
    expect(
      turn2Count,
      "a listed chat's next turn must not refetch the list before its reply streams",
    ).toBe(0);
  },
);

test(
  "starting a new chat drops a finished but still-unlisted chat's placeholder",
  { tag: TAG_CI },
  async ({ page }) => {
    // A paced turn plus its completion runs past the default per-test budget.
    test.setTimeout(120000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);
    await selectModel(page, MOCK_MODEL);

    const sidebar = page.getByRole("complementary");
    // Keep this chat out of every list response so its row can only be the
    // placeholder, and its removal can only be a placeholder clear rather than
    // the list dropping it.
    const listExclude = await excludeOpenChatFromRecentChats(page);

    try {
      const chatId = await sendFirstMessage(page, "long running 2");
      const row = sidebar.locator(`[data-chat-id="${chatId}"]`);
      await expect(row).toBeVisible({ timeout: 5000 });
      // The placeholder is shown while the first turn is still in flight.
      await expect(
        page.getByTestId("chat-input-stop-generation"),
      ).toBeVisible();

      // Let the turn finish. The chat is now saved on the backend but excluded
      // from the list, so the placeholder is what still holds its row: the
      // clearing-on-list effect never fires for a chat that is never listed.
      await chatIsReadyToChat(page, {
        expectAssistantResponse: true,
        loadingTimeoutMs: 60000,
      });
      await expect(row).toHaveCount(1);

      // Starting a new chat abandons the finished-but-unlisted chat. Its
      // placeholder has to be cleared here or it lingers as a ghost row that
      // nothing else would ever remove.
      await page.getByRole("button", { name: "New Chat" }).click();

      await expect(row).toHaveCount(0);
      // The exclusion is still in force, so a late list response cannot be what
      // took the row away, and cannot bring it back either.
      await page.waitForTimeout(1000);
      await expect(row).toHaveCount(0);
    } finally {
      await listExclude.dispose();
    }
  },
);
