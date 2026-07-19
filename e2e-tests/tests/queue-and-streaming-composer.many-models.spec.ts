import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { chatIsReadyToChat, ensureOpenSidebar } from "./shared";
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
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /upload files/i }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(file);
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

/** Wait until the whole turn (and any drained follow-up) has finished. */
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

      await startLongRunningStream(page, 6);

      const textbox = messageBox(page);
      await textbox.fill("fast");
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

      await startLongRunningStream(page, 6);

      const textbox = messageBox(page);
      await textbox.fill("fast");
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

      await startLongRunningStream(page, 10);

      const textbox = messageBox(page);

      // Queue the first candidate.
      await textbox.fill("alpha queued");
      await textbox.press("Enter");
      await expect(queuedChip(page)).toContainText("alpha queued");

      // Queuing a second one opens the danger confirmation dialog; the composer
      // draft is left intact behind it.
      await textbox.fill("beta queued");
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

      await startLongRunningStream(page, 6);

      const textbox = messageBox(page);
      await textbox.fill("fast");
      await textbox.press("Enter");
      await expect(queuedChip(page)).toBeVisible();

      await page.getByTestId("chat-input-queued-message-cancel").click();
      await expect(queuedChip(page)).toHaveCount(0);

      // Let the turn finish; nothing should be auto-sent.
      await waitForStreamToFinish(page);
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

      await startLongRunningStream(page, 6);

      const textbox = messageBox(page);
      await textbox.fill("fast");
      await textbox.press("Enter");
      await expect(queuedChip(page)).toBeVisible();

      // Click the chip → the queued draft comes back into the composer.
      await page.getByTestId("chat-input-queued-message-edit").click();
      await expect(queuedChip(page)).toHaveCount(0);
      await expect(textbox).toHaveValue("fast");

      // It is a plain draft again, so completing the turn sends nothing.
      await waitForStreamToFinish(page);
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
    "navigating away while a message is queued drops it to a draft and never background-sends",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(90000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectMockModel(page);

      await startLongRunningStream(page, 10);
      await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 10000 });
      const streamingChatId = page.url().split("/").pop();
      expect(streamingChatId).toBeTruthy();

      const textbox = messageBox(page);
      await textbox.fill("fast");
      await textbox.press("Enter");
      await expect(queuedChip(page)).toBeVisible();

      // Navigate away to a brand-new chat while the message is still queued.
      await ensureOpenSidebar(page);
      await page
        .getByRole("complementary")
        .getByRole("button", { name: "New Chat", exact: true })
        .click();
      await expect(page).toHaveURL(/\/chat\/new$/);
      await expect(queuedChip(page)).toHaveCount(0);

      // Return to the original chat: the queued payload came back as a draft
      // (never background-sent) and the chat still has a single user message.
      await ensureOpenSidebar(page);
      await page
        .getByRole("complementary")
        .locator(`[data-chat-id="${streamingChatId}"]`)
        .click();
      await expect(page).toHaveURL(new RegExp(`/chat/${streamingChatId}$`));

      await expect(messageBox(page)).toHaveValue("fast");
      await expect(queuedChip(page)).toHaveCount(0);
      await expect(page.getByTestId("message-user")).toHaveCount(1);
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
      // chat with its attachment.
      const chatCountAfter = await sidebar.locator("[data-chat-id]").count();
      expect(chatCountAfter).toBe(chatCountBaseline);
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

      await startLongRunningStream(page, 8);

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
