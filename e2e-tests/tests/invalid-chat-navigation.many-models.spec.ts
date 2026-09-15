import { test, expect, Page } from "@playwright/test";
import { TAG_CI } from "./tags";
import {
  abortActiveStreamingRequest,
  chatIsReadyToChat,
  ensureOpenSidebar,
  RECENT_CHATS_URL,
  selectModel,
  sendFirstMessage,
  setupStreamingRequestAbortHook,
} from "./shared";

// These cases need a real streamed turn, so they select the Mock-LLM model,
// which only exists in the many-models scenario. Model-agnostic cases
// (invalid-id redirect, cross-user oracle) live in the .basic spec.

const textboxOf = (page: Page) =>
  page.getByRole("textbox", { name: "Type a message..." });

/** Record every /api/v1beta response status for post-mortem diagnostics. */
function trackApi(page: Page) {
  const seen: { path: string; status: number }[] = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/v1beta/")) {
      seen.push({
        path: u.replace(/^https?:\/\/[^/]+/, "").split("?")[0],
        status: r.status(),
      });
    }
  });
  return seen;
}

/** Snapshot of the assistant-turn UI state (is it hung? did it error? answered?). */
async function turnState(page: Page) {
  return {
    stopVisible: await page
      .getByTestId("chat-input-stop-generation")
      .isVisible()
      .catch(() => false),
    loadingCount: await page.getByText("Loading").count(),
    errorCount: await page.getByTestId("chat-message-error").count(),
    sendErrorCount: await page.getByTestId("chat-send-error").count(),
    assistantCount: await page.getByTestId("message-assistant").count(),
    url: page.url(),
  };
}

// F2: on a working chat, force the submit endpoint to 500 and assert the user
// gets a VISIBLE send error (not a silent vanish / infinite spinner).
test(
  "submitstream 500 on a valid chat surfaces a visible error",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectModel(page, "Mock-LLM");
    await sendFirstMessage(page, "hello please answer briefly");
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 30000,
    });

    // Force the message endpoint to 500 for the next turn.
    await page.route("**/api/v1beta/me/messages/submitstream*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "injected 500 for e2e" }),
      }),
    );

    const textbox = textboxOf(page);
    await textbox.fill("this send should fail with 500");
    await textbox.press("Enter");

    // F2: a dismissible error is shown, and the turn does not spin forever.
    await expect(page.getByTestId("chat-send-error")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("chat-input-stop-generation")).toHaveCount(0);
    console.log(
      "[submit-500] turnState:",
      JSON.stringify(await turnState(page)),
    );
  },
);

// F3: a turn whose resume ends without a completion event must reconcile from
// the server, not spin forever. The backend now emits an Error before StreamEnd
// on failure; the client also reconciles on any inconclusive resume close. Here
// the resume returns immediately with no events (the minimal "no completion"
// case) and the client must clear the stuck turn.
test(
  "mid-stream drop + resume without completion reconciles instead of hanging",
  { tag: TAG_CI },
  async ({ page }) => {
    await setupStreamingRequestAbortHook(page);
    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectModel(page, "Mock-LLM");
    // A paced prompt so the turn stays streaming long enough to interrupt.
    await sendFirstMessage(page, "long running 6");

    // Wait until the turn is in flight (Stop button = isPendingResponse).
    await expect(page.getByTestId("chat-input-stop-generation")).toBeVisible({
      timeout: 15000,
    });

    // Resume returns a 200 that ends immediately with no completion event.
    await page.route("**/api/v1beta/me/messages/resumestream*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      }),
    );
    await abortActiveStreamingRequest(page);

    // Reconcile-on-close: no hang, the in-flight indicator clears.
    await expect(page.getByTestId("chat-input-stop-generation")).toHaveCount(
      0,
      {
        timeout: 15000,
      },
    );
  },
);

// Archived chat: create a real chat, archive it, reopen it and assert the page
// explains itself, refuses the composer, and comes back through the notice.
test(
  "archived chat closes its composer until it is unarchived",
  { tag: TAG_CI },
  async ({ page }) => {
    const api = trackApi(page);

    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectModel(page, "Mock-LLM");
    const chatId = await sendFirstMessage(page, "hello please answer briefly");
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 30000,
    });
    console.log(`[archived] created + completed chat ${chatId}`);

    // Through the API: archiving from the row menu is the sidebar's own case.
    const archiveResp = await page.request.post(
      `/api/v1beta/chats/${chatId}/archive`,
      { data: {} },
    );
    expect(archiveResp.status()).toBe(200);

    // The pinned list answers the same path and still carries the id, so skip
    // it; a failed listing has no ids at all and must not count either.
    const listWithoutChat = page.waitForResponse(
      async (r) => {
        if (
          !r.url().includes(RECENT_CHATS_URL) ||
          r.url().includes("pinned=true") ||
          !r.ok()
        ) {
          return false;
        }
        // A body the browser already discarded must not reject the wait.
        const body = await r.text().catch(() => null);
        return body !== null && !body.includes(chatId);
      },
      { timeout: 15000 },
    );
    // No readiness wait here: it ends on an enabled composer, which is exactly
    // what an archived chat must not have.
    await page.goto(`/chat/${chatId}`);
    const notice = page.getByTestId("archived-chat-notice");
    await expect(notice).toBeVisible({ timeout: 15000 });
    await expect(textboxOf(page)).toBeDisabled();
    await expect(page.getByTestId("message-user").first()).toBeVisible();
    await expect(page.getByTestId("message-assistant").first()).toBeVisible();

    await ensureOpenSidebar(page);
    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toBeVisible();
    const row = sidebar.locator(`[data-chat-id="${chatId}"]`);
    await listWithoutChat;
    await expect(row).toHaveCount(0);

    const unarchiveResp = page.waitForResponse(
      (r) =>
        r.url().includes(`/chats/${chatId}/unarchive`) &&
        r.request().method() === "POST",
      { timeout: 15000 },
    );
    await notice.getByRole("button", { name: "Unarchive" }).click();
    expect((await unarchiveResp).status()).toBe(200);

    await expect(notice).toHaveCount(0, { timeout: 15000 });
    await expect(textboxOf(page)).toBeEnabled({ timeout: 15000 });
    await expect(row.first()).toBeVisible({ timeout: 15000 });
    console.log(
      "[archived] api>=400:",
      JSON.stringify(api.filter((a) => a.status >= 400)),
    );
  },
);
