import { expect, Locator, Page, test } from "@playwright/test";
import { chatIsReadyToChat, selectModel } from "./shared";
import { TAG_CI } from "./tags";

/**
 * Stale turns are only visible while the replacement streams, so these tests
 * assert mid-stream and again after completion. The `long running <N>` mock
 * trigger streams one `Second N passed` chunk per second, which is what makes
 * the mid-stream window wide enough to assert in.
 */

const messageBox = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Type a message..." });

const stopButton = (page: Page): Locator =>
  page.getByTestId("chat-input-stop-generation");

const chatMessages = (page: Page): Locator =>
  page.locator('[data-ui="chat-message"]');

const messageRoles = async (page: Page): Promise<string[]> =>
  chatMessages(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-role") ?? ""),
  );

// `chatIsReadyToChat`'s `expectAssistantResponse` assertion is strict-mode, so
// it throws once a second assistant message exists; assert turn counts here.
const sendSettledMessage = async (
  page: Page,
  text: string,
  expectedTurns: number,
) => {
  const textbox = messageBox(page);
  await expect(textbox).toBeEnabled();
  await textbox.fill(text);
  await textbox.press("Enter");
  await chatIsReadyToChat(page, { loadingTimeoutMs: 30000 });

  await expect(page.getByTestId("message-user")).toHaveCount(expectedTurns);
  await expect(page.getByTestId("message-assistant")).toHaveCount(
    expectedTurns,
  );
};

// The texts avoid every mock trigger substring, so each turn resolves via the
// fast default response.
const seedThreeTurnConversation = async (page: Page) => {
  await sendSettledMessage(page, "Alpha one", 1);
  await sendSettledMessage(page, "Beta two", 2);
  await sendSettledMessage(page, "Gamma three", 3);
};

const waitForStreamingToStart = async (page: Page) => {
  await expect(stopButton(page)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Second 1 passed")).toBeVisible({
    timeout: 20000,
  });
};

const waitForStreamToFinish = async (page: Page, timeout = 60000) => {
  await expect(stopButton(page)).toHaveCount(0, { timeout });
};

// Exactly one prefix turn survives, and the replacement turn is last.
const expectSingleTrailingBranch = async (page: Page) => {
  await expect(page.getByTestId("message-user")).toHaveCount(2);
  await expect(page.getByTestId("message-assistant")).toHaveCount(2);

  expect(await messageRoles(page)).toEqual([
    "user",
    "assistant",
    "user",
    "assistant",
  ]);

  await expect(chatMessages(page).first()).toContainText("Alpha one");
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

      await expectSingleTrailingBranch(page);
      await expect(chatMessages(page).nth(2)).toContainText("long running 8");

      // The same state must survive the post-stream refetch.
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

      // Regenerate replays the existing user message, so the long-running
      // trigger has to be seeded into it.
      await sendSettledMessage(page, "Alpha one", 1);
      await sendSettledMessage(page, "long running 6", 2);
      await sendSettledMessage(page, "Gamma three", 3);

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
