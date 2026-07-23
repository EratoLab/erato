import { test, expect, Page } from "@playwright/test";
import { TAG_CI } from "./tags";
import {
  chatIsReadyToChat,
  ensureOpenSidebar,
  RECENT_CHATS_URL,
  selectModel,
  sendFirstMessage,
} from "./shared";

/**
 * Per-chat generation status in the history sidebar. Mock-LLM gives
 * deterministic windows: `long running N` streams for N seconds, `delayed
 * error` waits ~5s and then fails the backend turn.
 */
const MOCK_MODEL = "Mock-LLM";

const GENERATING_URL = "/api/v1beta/me/generating";

const sidebarRow = (page: Page, chatId: string) =>
  page.getByRole("complementary").locator(`[data-chat-id="${chatId}"]`);

const sidebarRowLink = (page: Page, chatId: string) =>
  page.getByRole("complementary").locator(`a:has([data-chat-id="${chatId}"])`);

const rowIndicator = (page: Page, chatId: string) =>
  sidebarRow(page, chatId).getByTestId("chat-generation-status");

/**
 * Resolves once a recent_chats response lists the chat. A row that must
 * survive clicking New Chat (which drops the local placeholder) has to be
 * list-backed first; register before the action that triggers the refetch.
 */
const waitForChatListed = (page: Page, chatId: () => string) =>
  page.waitForResponse(
    async (response) => {
      if (!response.url().includes(RECENT_CHATS_URL) || !chatId()) {
        return false;
      }
      try {
        const body = (await response.json()) as { chats?: { id?: string }[] };
        return (
          Array.isArray(body.chats) &&
          body.chats.some((entry) => entry.id === chatId())
        );
      } catch {
        return false;
      }
    },
    { timeout: 30000 },
  );

test(
  "a running chat survives reload, finishes with its real title while unwatched, and clears on open",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);
    await selectModel(page, MOCK_MODEL);

    const chatId = await sendFirstMessage(page, "long running 12");
    const row = sidebarRow(page, chatId);
    const indicator = rowIndicator(page, chatId);
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(indicator).toHaveAttribute("data-status", "running");
    // The first paced token proves the reload happens mid-turn.
    await expect(page.getByText("Second 1 passed")).toBeVisible({
      timeout: 15000,
    });

    // Register before the reload: the reload wipes the client cache, so a
    // pre-reload listing is not enough.
    const listedAfterReload = waitForChatListed(page, () => chatId);

    // Running survives a reload — the indicator is backend-sourced.
    await page.reload();
    await ensureOpenSidebar(page);
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(indicator).toHaveAttribute("data-status", "running", {
      timeout: 10000,
    });

    await listedAfterReload;

    // Leave the chat; the backend turn keeps running without this tab's SSE.
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "New Chat", exact: true })
      .click();
    await expect(page).toHaveURL(/\/chat\/new$/);
    await expect(indicator).toHaveAttribute("data-status", "running");

    // The poll observes completion while the user is elsewhere.
    await expect(indicator).toHaveAttribute("data-status", "finished", {
      timeout: 45000,
    });
    const rowLink = sidebarRowLink(page, chatId);
    await expect(rowLink).toHaveAttribute("aria-label", /, Finished$/);
    // The generated title replaced both the untitled fallback and the
    // user-message stand-in; this does not depend on the summary's wording.
    await expect(rowLink).not.toHaveAttribute(
      "aria-label",
      /^(New Chat|long running)/,
    );

    // Opening the chat acknowledges the terminal status: the indicator clears.
    await rowLink.click();
    await expect(page).toHaveURL(new RegExp(`/chat/${chatId}$`));
    await expect(indicator).toHaveCount(0);
  },
);

test(
  "a turn that fails while unwatched shows Error, distinct from Finished, and clears on open",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(90000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);
    await selectModel(page, MOCK_MODEL);

    // Register before the send so the refetch that lists the chat cannot be
    // missed.
    let chatId = "";
    const listed = waitForChatListed(page, () => chatId);

    // `delayed error` gives a real running window to navigate away in.
    chatId = await sendFirstMessage(page, "delayed error");
    const row = sidebarRow(page, chatId);
    const indicator = rowIndicator(page, chatId);
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(indicator).toHaveAttribute("data-status", "running");

    await listed;

    // Leave during the delay window; the failure happens unwatched.
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "New Chat", exact: true })
      .click();
    await expect(page).toHaveURL(/\/chat\/new$/);
    await expect(indicator).toHaveAttribute("data-status", "running");

    // The poll picks up the errored outcome, distinct from Finished.
    await expect(indicator).toHaveAttribute("data-status", "error", {
      timeout: 30000,
    });
    await expect(indicator).toHaveAttribute("title", "Error");

    // Opening the chat acknowledges the error: the indicator clears.
    const rowLink = sidebarRowLink(page, chatId);
    await rowLink.click();
    await expect(page).toHaveURL(new RegExp(`/chat/${chatId}$`));
    await expect(indicator).toHaveCount(0);
  },
);

test(
  "the client polls /me/generating only while a chat is running",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);

    const generatingAt: number[] = [];
    page.on("request", (request) => {
      if (request.url().includes(GENERATING_URL)) {
        generatingAt.push(Date.now());
      }
    });

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);

    // Settle to an idle baseline: a still-running chat from an earlier test
    // would legitimately keep the poller alive.
    await expect(
      page
        .getByRole("complementary")
        .locator(
          '[data-testid="chat-generation-status"][data-status="running"]',
        ),
    ).toHaveCount(0, { timeout: 60000 });
    await page.waitForTimeout(2000);

    // The poll must be disabled while idle, not merely slowed down.
    const idleStart = Date.now();
    await page.waitForTimeout(8000);
    const idleCount = generatingAt.filter((t) => t >= idleStart).length;
    expect(
      idleCount,
      "an idle client must not send any /me/generating requests",
    ).toBe(0);

    // A running chat turns the poll on.
    await selectModel(page, MOCK_MODEL);
    const firstPoll = page.waitForRequest(
      (request) => request.url().includes(GENERATING_URL),
      { timeout: 20000 },
    );
    await sendFirstMessage(page, "long running 8");
    await firstPoll;

    // Let the turn finish so the suite leaves no running chat behind.
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 60000,
    });
  },
);

test(
  "a collapsed sidebar shows an aggregate activity badge while a chat runs",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(90000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);
    await selectModel(page, MOCK_MODEL);

    const chatId = await sendFirstMessage(page, "long running 15");
    await expect(rowIndicator(page, chatId)).toHaveAttribute(
      "data-status",
      "running",
    );

    // Another chat may legitimately be active in parallel, so assert a
    // count, not "1".
    await page.getByLabel("collapse sidebar").click();
    const badge = page.getByTestId("sidebar-generation-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^[1-9]\d*$/);

    // Let the turn finish so the suite leaves no running chat behind.
    await ensureOpenSidebar(page);
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 60000,
    });
  },
);

test(
  "a follow-up message keeps its running indicator despite a stale status poll",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);
    await selectModel(page, MOCK_MODEL);

    // The first turn's terminal row sits inside the retention window.
    const chatId = await sendFirstMessage(page, "long running 2");
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 30000,
    });

    // Replay the race deterministically: the first poll after the second
    // send answers with the previous generation's retention row.
    let staleReplayed = false;
    await page.route(`**${GENERATING_URL}*`, async (route) => {
      if (staleReplayed) {
        await route.continue().catch(() => {});
        return;
      }
      staleReplayed = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chats: [
            {
              chat_id: chatId,
              state: "completed",
              started_at: new Date(Date.now() - 60_000).toISOString(),
              ended_at: new Date(Date.now() - 55_000).toISOString(),
            },
          ],
        }),
      });
    });

    const indicator = rowIndicator(page, chatId);
    const composer = page.getByRole("textbox", { name: "Type a message..." });
    await composer.fill("long running 12");
    await composer.press("Enter");
    await expect(indicator).toHaveAttribute("data-status", "running");

    // The stale snapshot must not consume the running status.
    await expect.poll(() => staleReplayed, { timeout: 15000 }).toBe(true);
    for (let i = 0; i < 4; i += 1) {
      await page.waitForTimeout(1000);
      await expect(indicator).toHaveAttribute("data-status", "running");
    }
    await page.unroute(`**${GENERATING_URL}*`);

    // Let the turn finish so the suite leaves no running chat behind. (No
    // expectAssistantResponse: the chat holds two assistant messages by now
    // and that assertion is strict-mode single-element.)
    await chatIsReadyToChat(page, { loadingTimeoutMs: 60000 });
  },
);
