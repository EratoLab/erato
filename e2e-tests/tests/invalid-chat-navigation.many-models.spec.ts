import { test, expect, Page } from "@playwright/test";
import { TAG_CI } from "./tags";
import {
  abortActiveStreamingRequest,
  chatIsReadyToChat,
  ensureOpenSidebar,
  selectModel,
  sendFirstMessage,
  setupStreamingRequestAbortHook,
} from "./shared";

// These cases need a real streamed turn, so they select the Mock-LLM model,
// which only exists in the many-models scenario. Model-agnostic cases
// (invalid-id redirect, cross-user oracle) live in the .basic spec.

const SUBMIT_STREAM = "/api/v1beta/me/messages/submitstream";
const CHAT_MESSAGES = /\/api\/v1beta\/chats\/[0-9a-fA-F-]+\/messages/;

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

// F3 (DEFERRED): a turn whose resume can never complete must NOT spin forever.
// This asserts the DESIRED behavior and is skipped (test.fixme) until the
// no-progress watchdog lands — remove `.fixme` and tune the timeout to the
// watchdog once implemented. See ERMAIN-487. Verified current bug: with resume
// hung open, the Stop button stays and no error appears (assistant stuck).
test.fixme(
  "mid-stream drop + un-completable resume resolves to an error, not a hang",
  { tag: TAG_CI },
  async ({ page }) => {
    test.setTimeout(120000);
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

    // Make resume hang open forever (never fulfilled): the connection stays
    // "streaming", so the client can never reach assistant_message_completed.
    await page.route(
      "**/api/v1beta/me/messages/resumestream*",
      () => new Promise<void>(() => {}),
    );
    await abortActiveStreamingRequest(page);

    // DESIRED: the stuck turn is bounded — a no-progress watchdog surfaces a
    // visible error and clears the in-flight indicator instead of hanging.
    await expect(page.getByTestId("chat-send-error")).toBeVisible({
      timeout: 90000,
    });
    await expect(page.getByTestId("chat-input-stop-generation")).toHaveCount(0);
  },
);

// Archived chat: create a real chat, archive it, navigate back, and assert a
// send is rejected (409) and surfaces a visible error (B3 + F2).
test(
  "archived chat rejects a send with a visible error",
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

    // Archive it via the sidebar row menu.
    await ensureOpenSidebar(page);
    const sidebar = page.getByRole("complementary");
    const row = sidebar.locator(`[data-chat-id="${chatId}"]`).first();
    await row.hover();
    await row.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    // Wait for the archive to actually commit before sending, otherwise the
    // submit can read archived_at before it is set (a test race, not a bug).
    const archiveResp = page.waitForResponse(
      (r) =>
        r.url().includes(`/chats/${chatId}/archive`) &&
        r.request().method() === "POST",
      { timeout: 15000 },
    );
    await page.getByRole("button", { name: "Confirm action" }).click();
    await archiveResp;
    console.log(`[archived] archived chat ${chatId}`);

    // Navigate back to the now-archived chat and try to send.
    const messagesResp = page
      .waitForResponse((r) => CHAT_MESSAGES.test(r.url()), { timeout: 15000 })
      .catch(() => null);
    await page.goto(`/chat/${chatId}`);
    const textbox = textboxOf(page);
    await expect(textbox).toBeVisible();
    const mResp = await messagesResp;
    console.log(
      `[archived] after goto: url=${page.url()} messagesGET=${mResp ? mResp.status() : "n/a"}`,
    );

    const submitResp = page
      .waitForResponse((r) => r.url().includes(SUBMIT_STREAM), {
        timeout: 15000,
      })
      .catch(() => null);
    await textbox.fill("can you still hear me in the archive?");
    await textbox.press("Enter");
    const sResp = await submitResp;
    console.log(`[archived] submitstream=${sResp ? sResp.status() : "n/a"}`);
    // Archived chat stays readable, but a write must be rejected (B3), not accepted.
    expect(mResp?.status()).toBe(200);
    expect(sResp?.status()).toBe(409);
    // F2: the rejected send surfaces a visible error, not a silent failure.
    await expect(page.getByTestId("chat-send-error")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("chat-input-stop-generation")).toHaveCount(0);
    console.log("[archived] turnState:", JSON.stringify(await turnState(page)));
    console.log(
      "[archived] api>=400:",
      JSON.stringify(api.filter((a) => a.status >= 400)),
    );
  },
);
