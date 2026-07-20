import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import {
  chatIsReadyToChat,
  ensureOpenSidebar,
  installStreamErrorTap,
  injectStreamError,
} from "./shared";
import { TAG_CI } from "./tags";

/**
 * End-to-end coverage for the "composer stays usable while a response streams"
 * (ERMAIN-466, PR #837) and "queue the next message + auto-send on completion"
 * (ERMAIN-470, PR #840) behaviours.
 *
 * These exercise the real Mock-LLM streaming path in the `many-models`
 * scenario. The `long running N` mock streams `Second 1 passed` … `Second N
 * passed. Complete!` at ~1s/chunk, which gives a controllable multi-second
 * window to interact with the composer mid-stream. `fast` returns
 * "Quick response!" quickly and is used as the queued follow-up message.
 *
 * Note: on this branch the textarea's `disabled` is driven by `composeLocked`
 * (upload/record only), NOT `isPendingResponse` — so it stays editable while a
 * response streams. The reliable "streaming in progress" signal is therefore
 * the Stop button (`chat-input-stop-generation`), not a disabled textarea.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const messageBox = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Type a message..." });

const stopButton = (page: Page): Locator =>
  page.getByTestId("chat-input-stop-generation");

const queuedChip = (page: Page): Locator =>
  page.getByTestId("chat-input-queued-message");

const selectMockModel = async (page: Page) => {
  const modelSelectorButton = page.locator(
    'button[aria-controls="model-selector-dropdown"]',
  );
  await expect(modelSelectorButton).toBeVisible();
  await modelSelectorButton.click();
  await page.getByRole("menuitem", { name: "Mock-LLM", exact: true }).click();
  await expect(modelSelectorButton).toContainText("Mock-LLM");
};

const uploadFileInChat = async (page: Page, file: string) => {
  // Set the file directly on the input. These tests cover upload ROUTING
  // (which chat the file lands on), not the chooser UI — and the visible
  // affordance differs by config (dedicated button vs unified "+" menu), so
  // clicking a specific button would couple them to one layout.
  await page.locator('input[type="file"]').first().setInputFiles(file);
};

/**
 * Re-assert the turn is still in flight immediately before a queue-affecting
 * action. If the stream ended early, the Queue affordance silently becomes
 * Send — this turns that into a loud failure at the right line instead of a
 * confusing assertion later.
 */
const expectStreamStillActive = async (page: Page) => {
  await expect(stopButton(page)).toBeVisible();
};

/**
 * Start a long-running streamed response and wait until it is actively
 * streaming (Stop button shown + first chunk visible).
 */
const startLongRunningStream = async (page: Page, seconds: number) => {
  const textbox = messageBox(page);
  await expect(textbox).toBeVisible();
  await textbox.fill(`long running ${seconds}`);
  await textbox.press("Enter");
  await expect(stopButton(page)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Second 1 passed")).toBeVisible({
    timeout: 15000,
  });
};

/**
 * Wait until no turn is in flight (Stop control gone). NOTE: this does NOT by
 * itself cover a drained follow-up — the Stop control is also absent in the
 * gap between a turn ending and the auto-sent turn starting, so callers that
 * expect a drain must first gate on the follow-up's user-message count (all
 * current callers do).
 */
const waitForStreamToFinish = async (page: Page, timeout = 40000) => {
  await expect(stopButton(page)).toHaveCount(0, { timeout });
};

test.describe("Streaming composer + message queue", () => {
  test(
    "composer stays editable and only offers Stop + Queue while a response streams",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(60000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      await startLongRunningStream(page, 10);

      const textbox = messageBox(page);
      // ERMAIN-466: the textarea remains editable mid-stream.
      await expect(textbox).toBeEnabled();
      await textbox.fill("draft typed while streaming");
      await expect(textbox).toHaveValue("draft typed while streaming");

      // Typing (and having content) does not submit a second message.
      await expect(page.getByTestId("message-user")).toHaveCount(1);

      // ERMAIN-470: with content mid-stream the trailing slot is exactly
      // Stop + Queue — neither the idle Send button nor the dictation-start
      // button is rendered (the "at most two trailing controls" rule).
      await expect(page.getByTestId("chat-input-queue-message")).toBeVisible();
      await expect(stopButton(page)).toBeVisible();
      await expect(page.getByTestId("chat-input-send-message")).toHaveCount(0);
      await expect(page.getByTestId("chat-input-record-audio")).toHaveCount(0);

      // Clean up: stop the stream so the test finishes quickly.
      await stopButton(page).click();
      await waitForStreamToFinish(page, 15000);
    },
  );

  test(
    "Enter while streaming queues the next message and auto-sends it on completion",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(60000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      await startLongRunningStream(page, 10);

      const textbox = messageBox(page);
      await textbox.fill("fast");
      await expectStreamStillActive(page);
      await textbox.press("Enter");

      // Queued, not sent: chip shows, composer clears, still one user message.
      await expect(queuedChip(page)).toBeVisible();
      await expect(queuedChip(page)).toContainText("fast");
      await expect(textbox).toHaveValue("");
      await expect(page.getByTestId("message-user")).toHaveCount(1);

      // Auto-sends once the first turn finishes → second user + assistant turn.
      await expect(page.getByTestId("message-user")).toHaveCount(2, {
        timeout: 40000,
      });
      await expect(queuedChip(page)).toHaveCount(0);
      await expect(page.getByTestId("message-user").last()).toContainText(
        "fast",
      );

      await waitForStreamToFinish(page);
      await expect(page.getByTestId("message-assistant").last()).toContainText(
        "Quick response!",
        { timeout: 15000 },
      );
    },
  );

  test(
    "the Queue button queues the next message just like Enter",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(60000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      await startLongRunningStream(page, 10);

      const textbox = messageBox(page);
      await textbox.fill("fast");
      await expectStreamStillActive(page);
      await page.getByTestId("chat-input-queue-message").click();

      await expect(queuedChip(page)).toBeVisible();
      await expect(queuedChip(page)).toContainText("fast");
      await expect(textbox).toHaveValue("");
      await expect(page.getByTestId("message-user")).toHaveCount(1);

      // And it still auto-sends on completion.
      await expect(page.getByTestId("message-user")).toHaveCount(2, {
        timeout: 40000,
      });
      await expect(queuedChip(page)).toHaveCount(0);
    },
  );

  test(
    "queuing a second message asks to replace, and Replace swaps the queued draft",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(60000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      // 20s window: this test has the longest interaction sequence in the
      // file (two dialog round-trips), and a throttled CI runner must never
      // see the stream end mid-sequence — Queue would silently become Send.
      await startLongRunningStream(page, 20);

      const textbox = messageBox(page);

      // Queue the first candidate.
      await textbox.fill("alpha queued");
      await expectStreamStillActive(page);
      await textbox.press("Enter");
      await expect(queuedChip(page)).toContainText("alpha queued");

      // Queuing a second one opens the danger confirmation dialog; the composer
      // draft is left intact behind it.
      await textbox.fill("beta queued");
      await expectStreamStillActive(page);
      await textbox.press("Enter");
      const dialog = page.getByRole("dialog", {
        name: "Replace the queued message?",
      });
      await expect(dialog).toBeVisible();

      // Keep queued → dialog closes, original queued message survives.
      // (The dialog buttons carry an aria-label for a11y, so match on their
      // visible text rather than their accessible name.)
      await dialog
        .getByRole("button")
        .filter({ hasText: "Keep queued" })
        .click();
      await expect(dialog).toBeHidden();
      await expect(queuedChip(page)).toContainText("alpha queued");
      await expect(textbox).toHaveValue("beta queued");

      // Queue again and confirm Replace → queued draft is swapped.
      await expectStreamStillActive(page);
      await textbox.press("Enter");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button").filter({ hasText: "Replace" }).click();
      await expect(dialog).toBeHidden();
      await expect(queuedChip(page)).toContainText("beta queued");
      await expect(textbox).toHaveValue("");

      // The replacement (not the discarded original) is what auto-sends.
      await expect(page.getByTestId("message-user")).toHaveCount(2, {
        timeout: 45000,
      });
      await expect(page.getByTestId("message-user").last()).toContainText(
        "beta queued",
      );
      await expect(
        page.getByTestId("message-user").filter({ hasText: "alpha queued" }),
      ).toHaveCount(0);
    },
  );

  test(
    "cancelling the queued message prevents the auto-send",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(60000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      await startLongRunningStream(page, 10);

      const textbox = messageBox(page);
      await textbox.fill("fast");
      await expectStreamStillActive(page);
      await textbox.press("Enter");
      await expect(queuedChip(page)).toBeVisible();

      await page.getByTestId("chat-input-queued-message-cancel").click();
      await expect(queuedChip(page)).toHaveCount(0);

      // Let the turn demonstrably complete (terminal token, not just the Stop
      // control disappearing), give an erroneous drain a beat to fire, and
      // only then assert nothing was auto-sent.
      await expect(page.getByTestId("message-assistant").last()).toContainText(
        "Complete!",
        { timeout: 30000 },
      );
      await waitForStreamToFinish(page);
      await page.waitForTimeout(1000);
      await expect(page.getByTestId("message-user")).toHaveCount(1);
      await expect(
        page
          .getByTestId("message-assistant")
          .filter({ hasText: "Quick response!" }),
      ).toHaveCount(0);
    },
  );

  test(
    "editing the queued message returns it to the composer and cancels the auto-send",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(60000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      await startLongRunningStream(page, 10);

      const textbox = messageBox(page);
      await textbox.fill("fast");
      await expectStreamStillActive(page);
      await textbox.press("Enter");
      await expect(queuedChip(page)).toBeVisible();

      // Click the chip → the queued draft comes back into the composer.
      await page.getByTestId("chat-input-queued-message-edit").click();
      await expect(queuedChip(page)).toHaveCount(0);
      await expect(textbox).toHaveValue("fast");

      // It is a plain draft again, so completing the turn sends nothing —
      // asserted only after the terminal token plus a grace beat, so a
      // late-firing drain would be caught.
      await expect(page.getByTestId("message-assistant").last()).toContainText(
        "Complete!",
        { timeout: 30000 },
      );
      await waitForStreamToFinish(page);
      await page.waitForTimeout(1000);
      await expect(page.getByTestId("message-user")).toHaveCount(1);
      await expect(textbox).toHaveValue("fast");
    },
  );

  test(
    "Stop returns the queued draft to the composer without sending",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(60000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      await startLongRunningStream(page, 10);

      const textbox = messageBox(page);
      await textbox.fill("fast");
      await expectStreamStillActive(page);
      await textbox.press("Enter");
      await expect(queuedChip(page)).toBeVisible();

      // Stopping aborts the turn and never auto-sends: the queued draft is
      // returned to the composer.
      await stopButton(page).click();
      await waitForStreamToFinish(page, 15000);

      await expect(queuedChip(page)).toHaveCount(0);
      await expect(textbox).toHaveValue("fast");
      await expect(page.getByTestId("message-user")).toHaveCount(1);
    },
  );

  test(
    "a turn that errors mid-stream returns the queued message to the composer and never sends",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(60000);

      // The tap lets us fail the stream at an exact moment — the only
      // stream-then-error mock (`hallucination loop`) aborts within
      // milliseconds, leaving no window to queue into.
      await installStreamErrorTap(page);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      await startLongRunningStream(page, 15);

      const textbox = messageBox(page);
      await textbox.fill("fast");
      await expectStreamStillActive(page);
      await textbox.press("Enter");
      await expect(queuedChip(page)).toBeVisible();
      await expect(page.getByTestId("message-user")).toHaveCount(1);

      // Fail the turn mid-stream: the client receives the same `error` event
      // the backend emits on a provider failure, then the stream ends.
      await injectStreamError(page);
      await waitForStreamToFinish(page, 15000);

      // The messagingError drain branch: queued content returns to the
      // composer, the chip clears, and nothing is ever sent — asserted again
      // after a grace beat so a late-firing drain would be caught.
      await expect(textbox).toHaveValue("fast");
      await expect(queuedChip(page)).toHaveCount(0);
      await expect(page.getByTestId("message-user")).toHaveCount(1);

      await page.waitForTimeout(1500);
      await expect(page.getByTestId("message-user")).toHaveCount(1);
      await expect(textbox).toHaveValue("fast");
      await expect(
        page
          .getByTestId("message-assistant")
          .filter({ hasText: "Quick response!" }),
      ).toHaveCount(0);
    },
  );

  test(
    "navigating away while a message is queued drops it to a draft and never background-sends",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(90000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      // Establish the chat with a completed turn FIRST, so the sidebar lists
      // it before we ever leave. The chats list only refetches on completion
      // events (focus refetches are a no-op inside the 60s staleTime), so a
      // chat abandoned mid-stream would not reliably appear in the sidebar —
      // and returning to it is the whole point of this test.
      const textbox = messageBox(page);
      await textbox.fill("fast");
      await textbox.press("Enter");
      await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 15000 });
      const streamingChatId = page.url().split("/").pop();
      expect(streamingChatId).toBeTruthy();
      await waitForStreamToFinish(page, 20000);
      await ensureOpenSidebar(page);
      const sidebarEntry = page
        .getByRole("complementary")
        .locator(`[data-chat-id="${streamingChatId}"]`);
      await expect(sidebarEntry).toBeVisible({ timeout: 15000 });

      // Now stream long enough to queue into.
      await startLongRunningStream(page, 10);

      await textbox.fill("fast");
      await expectStreamStillActive(page);
      await textbox.press("Enter");
      await expect(queuedChip(page)).toBeVisible();

      // Navigate away to a brand-new chat while the message is still queued.
      await page
        .getByRole("complementary")
        .getByRole("button", { name: "New Chat", exact: true })
        .click();
      await expect(page).toHaveURL(/\/chat\/new$/);
      // Neither the chip nor the payload leaks into the new chat's composer.
      await expect(queuedChip(page)).toHaveCount(0);
      await expect(messageBox(page)).toHaveValue("");

      // Return to the original chat via its (already-listed) sidebar entry.
      await ensureOpenSidebar(page);
      await expect(sidebarEntry).toBeVisible({ timeout: 15000 });
      await sidebarEntry.click();
      await expect(page).toHaveURL(new RegExp(`/chat/${streamingChatId}$`));

      // The queued payload came back as a draft. (No message-count assert
      // here: while the resumed stream is still in flight the history can
      // render without the mid-stream user message — a pre-existing resume
      // quirk unrelated to the queue. The count is checked after completion.)
      await expect(messageBox(page)).toHaveValue("fast");
      await expect(queuedChip(page)).toHaveCount(0);

      // "Never background-sends" can only be asserted after the abandoned
      // turn has demonstrably completed — before that, the drain this guards
      // against could not have fired yet.
      await expect(page.getByTestId("message-assistant").last()).toContainText(
        "Complete!",
        { timeout: 30000 },
      );
      await waitForStreamToFinish(page, 15000);
      await page.waitForTimeout(1500);
      // Exactly the two sent user messages — an auto-send would make it 3 —
      // and the queued text still sits in the composer.
      await expect(page.getByTestId("message-user")).toHaveCount(2);
      await expect(messageBox(page)).toHaveValue("fast");
      await expect(
        page
          .getByTestId("message-assistant")
          .filter({ hasText: "Quick response!" }),
      ).toHaveCount(1);
    },
  );

  test(
    "a file attached during a new chat's first-turn stream attaches to that chat instead of orphaning one",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(60000);

      await page.goto("/chat/new");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      // Send the first message of a brand-new chat and, WITHOUT waiting for the
      // chat id to settle, attach a file. This races the null→realId creation so
      // the upload happens while the committed chat id is still null — the exact
      // window ERMAIN-466 fixes by routing the upload to the in-flight chat
      // instead of spawning a separate, orphaned chat.
      const textbox = messageBox(page);
      await textbox.fill("long running 8");
      await textbox.press("Enter");
      // Bound the race: the submit must be in flight before the upload, or a
      // no-op run (send failed silently) would pass vacuously. This waits on
      // the turn starting, NOT on the chat id settling — the id race the test
      // exists for stays open.
      await expect(stopButton(page)).toBeVisible({ timeout: 10000 });

      const pdfPath = path.join(
        __dirname,
        "../test-files/sample-report-compressed.pdf",
      );
      await uploadFileInChat(page, pdfPath);

      // The attachment lands on the streaming chat (not a new one).
      await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible({
        timeout: 15000,
      });

      // The chat resolved to a single id and the view never jumped to a
      // different (orphan) chat.
      await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 10000 });
      const streamingChatId = page.url().split("/").pop();
      expect(streamingChatId).toBeTruthy();

      // Baseline the sidebar only once this chat is actually listed, so normal
      // first-turn chat creation isn't mistaken for an orphan. Any extra chat
      // spawned for the upload would push the count above this baseline.
      await ensureOpenSidebar(page);
      const sidebar = page.getByRole("complementary");
      await expect(
        sidebar.locator(`[data-chat-id="${streamingChatId}"]`),
      ).toBeVisible({ timeout: 15000 });
      const chatCountBaseline = await sidebar.locator("[data-chat-id]").count();

      await waitForStreamToFinish(page);

      // No orphan chat was created for the upload, and we're still on the same
      // chat with its attachment. Retrying assertion — the list refetches
      // asynchronously after completion.
      await expect(sidebar.locator("[data-chat-id]")).toHaveCount(
        chatCountBaseline,
        { timeout: 10000 },
      );
      await expect(page).toHaveURL(new RegExp(`/chat/${streamingChatId}$`));
      await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible();
    },
  );

  test(
    "a queued message carries its attachment through to the auto-sent turn",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(90000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      // 25s window: the upload below is allowed up to 15s, which must fit
      // inside the stream with margin — otherwise the queue click lands after
      // completion and silently sends instead.
      await startLongRunningStream(page, 25);

      // Attach a file mid-stream (routes to the streaming chat, ERMAIN-466),
      // then queue a "cite files" message that carries it. The queue stores
      // attachedFiles, and the drain must forward them on the auto-send
      // (ERMAIN-470) — otherwise the follow-up turn has no file to cite.
      const pdfPath = path.join(
        __dirname,
        "../test-files/sample-report-compressed.pdf",
      );
      await uploadFileInChat(page, pdfPath);
      await expect(page.getByText(/sample.*compressed.*pdf/i)).toBeVisible({
        timeout: 15000,
      });

      const textbox = messageBox(page);
      await textbox.fill("cite files");
      await expectStreamStillActive(page);
      await page.getByTestId("chat-input-queue-message").click();

      await expect(queuedChip(page)).toBeVisible();
      await expect(page.getByTestId("message-user")).toHaveCount(1);

      // On completion the queued message auto-sends WITH the attachment, so the
      // cite-files mock (which lists erato-file:// links found in the request)
      // answers with a citation link — proving the file reached the backend.
      await expect(page.getByTestId("message-user")).toHaveCount(2, {
        timeout: 45000,
      });
      await expect(queuedChip(page)).toHaveCount(0);

      await waitForStreamToFinish(page);
      const lastAssistant = page.getByTestId("message-assistant").last();
      await expect(
        lastAssistant.getByRole("link", { name: "Link" }).first(),
      ).toBeVisible({ timeout: 15000 });
    },
  );
});
