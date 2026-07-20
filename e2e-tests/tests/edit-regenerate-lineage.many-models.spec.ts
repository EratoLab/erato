import { expect, Locator, Page, test } from "@playwright/test";
import { chatIsReadyToChat, selectModel } from "./shared";
import { TAG_CI } from "./tags";

/**
 * ERMAIN-469: editing or regenerating a message that is NOT the last turn must
 * drop every later turn immediately, not just the next assistant.
 *
 * The backend deactivates the whole tail and reactivates only the new lineage,
 * but the frontend used to prune just one message pair. The survivors kept
 * their original (older) `createdAt`, and since the message list sorts purely
 * by that timestamp they rendered ABOVE the optimistic edit and its streaming
 * reply — until the post-stream refetch silently removed them.
 *
 * The bug is only visible WHILE streaming, so these tests assert mid-stream and
 * then again after completion (to prove nothing re-orders). `long running <N>`
 * streams one `Second N passed` chunk per second, which is what makes that
 * window wide enough to assert in.
 */

const messageBox = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Type a message..." });

const stopButton = (page: Page): Locator =>
  page.getByTestId("chat-input-stop-generation");

/** Every rendered message, in DOM order. */
const chatMessages = (page: Page): Locator =>
  page.locator('[data-ui="chat-message"]');

/** The rendered roles, in DOM order — the thing the bug actually corrupted. */
const messageRoles = async (page: Page): Promise<string[]> =>
  chatMessages(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-role") ?? ""),
  );

/** Send a message that falls through to the default mock and wait for the turn. */
const sendSettledMessage = async (page: Page, text: string) => {
  const textbox = messageBox(page);
  await expect(textbox).toBeEnabled();
  await textbox.fill(text);
  await textbox.press("Enter");
  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: 30000,
  });
};

/**
 * Build `[u1, a1, u2, a2, u3, a3]`. The texts deliberately avoid every mock
 * trigger substring so each turn resolves via the fast default response.
 */
const seedThreeTurnConversation = async (page: Page) => {
  await sendSettledMessage(page, "Alpha one");
  await sendSettledMessage(page, "Beta two");
  await sendSettledMessage(page, "Gamma three");

  await expect(page.getByTestId("message-user")).toHaveCount(3);
  await expect(page.getByTestId("message-assistant")).toHaveCount(3);
};

/** Wait until the streamed turn is genuinely in flight, with content on screen. */
const waitForStreamingToStart = async (page: Page) => {
  await expect(stopButton(page)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Second 1 passed")).toBeVisible({
    timeout: 20000,
  });
};

const waitForStreamToFinish = async (page: Page, timeout = 60000) => {
  await expect(stopButton(page)).toHaveCount(0, { timeout });
};

/**
 * The whole point of ERMAIN-469: exactly one prefix turn survives, and the
 * replacement turn is last. Asserted identically mid-stream and post-refetch.
 */
const expectSingleTrailingBranch = async (page: Page) => {
  await expect(page.getByTestId("message-user")).toHaveCount(2);
  await expect(page.getByTestId("message-assistant")).toHaveCount(2);

  // The stale third turn must be gone, not merely re-sorted.
  await expect(page.getByText("Gamma three")).toHaveCount(0);

  expect(await messageRoles(page)).toEqual([
    "user",
    "assistant",
    "user",
    "assistant",
  ]);

  // The surviving prefix is the untouched first turn.
  await expect(chatMessages(page).first()).toContainText("Alpha one");
  // ...and the streaming reply is genuinely last, with nothing floating above.
  await expect(chatMessages(page).last()).toContainText("Second");
};

test.describe("Edit / regenerate lineage pruning", () => {
  test(
    "editing a non-last user message drops every later turn while the reply streams",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(120000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectModel(page, "Mock-LLM");

      await seedThreeTurnConversation(page);

      // Edit the SECOND user message — the case the bug was specific to.
      const secondUserMessage = page.getByTestId("message-user").nth(1);
      await expect(secondUserMessage).toContainText("Beta two");
      await secondUserMessage.hover();
      const editButton = secondUserMessage.getByLabel("Edit message");
      await editButton.waitFor({ state: "visible", timeout: 10000 });
      await editButton.click();

      const editTextbox = page.getByRole("textbox", {
        name: "Edit your message...",
      });
      await expect(editTextbox).toBeVisible({ timeout: 30000 });
      await editTextbox.fill("long running 8");

      const saveButton = page.getByTestId("chat-input-save-edit");
      await expect(saveButton).toBeEnabled();
      await saveButton.click();

      await waitForStreamingToStart(page);

      // MID-STREAM: this is the state ERMAIN-469 reported as broken.
      await expectSingleTrailingBranch(page);
      await expect(chatMessages(page).nth(2)).toContainText("long running 8");

      // And the corrected state must survive the post-stream refetch without a
      // visible re-order.
      await waitForStreamToFinish(page);
      await chatIsReadyToChat(page, { loadingTimeoutMs: 30000 });
      await expectSingleTrailingBranch(page);
      await expect(chatMessages(page).last()).toContainText("Complete!");
    },
  );

  test(
    "regenerating a non-last assistant message drops every later turn while the reply streams",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(120000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectModel(page, "Mock-LLM");

      // The regenerated turn replays its own user message, so the long-running
      // trigger has to live in that message rather than in the edit.
      await sendSettledMessage(page, "Alpha one");
      await sendSettledMessage(page, "long running 6");
      await sendSettledMessage(page, "Gamma three");
      await expect(page.getByTestId("message-assistant")).toHaveCount(3);

      const secondAssistantMessage = page
        .getByTestId("message-assistant")
        .nth(1);
      await secondAssistantMessage.hover();
      const regenerateButton = secondAssistantMessage.getByLabel(
        "Regenerate response",
      );
      await regenerateButton.waitFor({ state: "visible", timeout: 10000 });
      await regenerateButton.click();

      await waitForStreamingToStart(page);

      await expectSingleTrailingBranch(page);
      await expect(chatMessages(page).nth(2)).toContainText("long running 6");

      await waitForStreamToFinish(page);
      await chatIsReadyToChat(page, { loadingTimeoutMs: 30000 });
      await expectSingleTrailingBranch(page);
    },
  );
});
