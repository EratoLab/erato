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
 * Per-chat generation status in the history sidebar (Running / Finished /
 * Error), driven by the backend-persisted generation state plus the
 * `GET /me/generating` poll. Mock-LLM gives deterministic windows: `long
 * running N` streams for N seconds, `delayed error` waits ~5s and then fails
 * the backend turn — so Running is observable, and the terminal transition
 * happens while the test is provably elsewhere.
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
 * Resolves once a recent_chats response lists the chat. Clicking New Chat
 * clears only the local placeholder, so a row that must survive it has to be
 * list-backed first. Register before the action that triggers the listing
 * refetch; the `chatId()` guard skips responses that predate the id.
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
    // A 12s paced turn plus a reload and the post-completion poll window run
    // past the default per-test budget.
    test.setTimeout(120000);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);
    await selectModel(page, MOCK_MODEL);

    // Long enough that the reload and the New Chat hop below both land inside
    // the running window.
    const chatId = await sendFirstMessage(page, "long running 12");
    const row = sidebarRow(page, chatId);
    const indicator = rowIndicator(page, chatId);
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(indicator).toHaveAttribute("data-status", "running");
    // The first paced token confirms the turn is genuinely streaming, so the
    // reload provably happens mid-turn.
    await expect(page.getByText("Second 1 passed")).toBeVisible({
      timeout: 15000,
    });

    // Register before the reload: its list fetch is what must list the chat
    // (the reload wipes the client cache, so a pre-reload listing is not
    // enough), and nothing invalidates the list between here and then.
    const listedAfterReload = waitForChatListed(page, () => chatId);

    // Running survives a reload — the indicator is backend-sourced, not a
    // leftover of this tab's session.
    await page.reload();
    await ensureOpenSidebar(page);
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(indicator).toHaveAttribute("data-status", "running", {
      timeout: 10000,
    });

    // The row must be list-backed before New Chat drops the placeholder that
    // the replayed chat_created re-created.
    await listedAfterReload;

    // Leave the chat; the backend turn keeps running without this tab's SSE.
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "New Chat", exact: true })
      .click();
    await expect(page).toHaveURL(/\/chat\/new$/);
    await expect(indicator).toHaveAttribute("data-status", "running");

    // Completion is observed by the poll while the user is elsewhere: the row
    // flips to Finished and picks up the generated title in the same commit.
    await expect(indicator).toHaveAttribute("data-status", "finished", {
      timeout: 45000,
    });
    const rowLink = sidebarRowLink(page, chatId);
    await expect(rowLink).toHaveAttribute("aria-label", /, Finished$/);
    // The real generated title replaced the untitled fallback. Any non-empty
    // title flips the label, so this does not depend on the summary's wording.
    await expect(rowLink).not.toHaveAttribute("aria-label", /^New Chat/);

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

    // Register before the send so the user_message_saved-gated refetch that
    // lists the chat cannot be missed.
    let chatId = "";
    const listed = waitForChatListed(page, () => chatId);

    // `delayed error` holds the backend turn open ~5s and then fails it, so
    // there is a real running window to navigate away in — unlike the instant
    // pre-stream error mocks.
    chatId = await sendFirstMessage(page, "delayed error");
    const row = sidebarRow(page, chatId);
    const indicator = rowIndicator(page, chatId);
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(indicator).toHaveAttribute("data-status", "running");

    // The row must be list-backed before New Chat drops the placeholder.
    await listed;

    // Leave during the delay window; the failure happens unwatched.
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "New Chat", exact: true })
      .click();
    await expect(page).toHaveURL(/\/chat\/new$/);
    await expect(indicator).toHaveAttribute("data-status", "running");

    // The poll picks up the errored outcome: visibly distinct from Finished
    // via data-status and the label text.
    await expect(indicator).toHaveAttribute("data-status", "error", {
      timeout: 30000,
    });
    await expect(indicator).toHaveText(/Error/);

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
    // An 8s idle window plus an 8s paced turn and its completion run past the
    // default per-test budget.
    test.setTimeout(120000);

    // Timestamp every poll request so each can be attributed to a window.
    const generatingAt: number[] = [];
    page.on("request", (request) => {
      if (request.url().includes(GENERATING_URL)) {
        generatingAt.push(Date.now());
      }
    });

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);

    // Settle to a provably idle baseline first: a still-running chat from an
    // earlier test would legitimately keep the poller alive into the window.
    await expect(
      page
        .getByRole("complementary")
        .locator(
          '[data-testid="chat-generation-status"][data-status="running"]',
        ),
    ).toHaveCount(0, { timeout: 60000 });
    await page.waitForTimeout(2000);

    // With nothing running, the endpoint must see zero requests: the poll is
    // disabled, not merely slowed down.
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

    // Long enough that the collapse round-trip happens while still running.
    const chatId = await sendFirstMessage(page, "long running 15");
    await expect(rowIndicator(page, chatId)).toHaveAttribute(
      "data-status",
      "running",
    );

    // Expanded mode: the Recent section header carries a count chip. Another
    // chat may legitimately be active in parallel, so assert a count, not "1".
    const chip = page.getByTestId("sidebar-generation-count-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText(/^[1-9]\d*$/);

    // Collapsed mode: the rail toggle carries the same count as a badge, so
    // activity stays visible while the list itself is hidden.
    await page.getByLabel("collapse sidebar").click();
    const badge = page.getByTestId("sidebar-generation-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^[1-9]\d*$/);

    // Restore the sidebar and let the turn finish so the suite leaves no
    // running chat behind.
    await ensureOpenSidebar(page);
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 60000,
    });
  },
);
