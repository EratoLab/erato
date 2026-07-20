import { expect, Locator, Page, test } from "@playwright/test";
import { chatIsReadyToChat, selectModel } from "./shared";
import { TAG_CI } from "./tags";

/**
 * Runs against the Mock-LLM so turns settle deterministically. The previous
 * `basic`-scenario version of these tests was skipped in CI because it drove a
 * real provider, whose latency and variable replies made the message-id waits
 * flaky.
 */

const messageBox = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Type a message..." });

const editTextbox = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Edit your message..." });

/** Send a message and wait for its turn to settle, asserting the turn counts. */
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

const openEditorFor = async (userMessage: Locator, page: Page) => {
  await userMessage.hover();
  const editButton = userMessage.getByLabel("Edit message");
  await editButton.waitFor({ state: "visible", timeout: 10000 });
  await editButton.click();
  await expect(editTextbox(page)).toBeVisible({ timeout: 30000 });
};

test.describe("Edit message", () => {
  test(
    "sends the edited message's own id and text, and no action facet",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(90000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectModel(page, "Mock-LLM");

      await sendSettledMessage(page, "Alpha one", 1);
      await sendSettledMessage(page, "Beta two", 2);
      await sendSettledMessage(page, "Gamma three", 3);

      const targetMessage = page.getByTestId("message-user").nth(1);
      await expect(targetMessage).toContainText("Beta two");
      const targetMessageId =
        await targetMessage.getAttribute("data-message-id");
      expect(targetMessageId).toBeTruthy();
      expect(targetMessageId).not.toMatch(/^temp-/);

      let requestBody: Record<string, unknown> | null = null;
      await page.route(
        "**/api/v1beta/me/messages/editstream",
        async (route) => {
          const postData = route.request().postData();
          if (postData) {
            requestBody = JSON.parse(postData) as Record<string, unknown>;
          }
          await route.continue();
        },
      );

      await openEditorFor(targetMessage, page);
      await editTextbox(page).fill("Beta two, edited");
      const saveButton = page.getByTestId("chat-input-save-edit");
      await expect(saveButton).toBeEnabled();
      await saveButton.click();

      await chatIsReadyToChat(page, { loadingTimeoutMs: 30000 });

      expect(requestBody).not.toBeNull();
      expect(requestBody?.message_id).toBe(targetMessageId);
      expect(requestBody?.replace_user_message).toBe("Beta two, edited");
      // The backend restores the message's own stored action facet when the
      // request omits it; sending the composer's live one would replace the
      // original context with whatever is currently open.
      expect(requestBody).not.toHaveProperty("action_facet");
    },
  );

  test(
    "offers the edit control on user messages only",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectModel(page, "Mock-LLM");

      await sendSettledMessage(page, "Alpha one", 1);

      const userMessage = page.getByTestId("message-user").first();
      await userMessage.hover();
      await expect(userMessage.getByLabel("Edit message")).toBeVisible();

      const assistantMessage = page.getByTestId("message-assistant").first();
      await assistantMessage.hover();
      await expect(assistantMessage.getByLabel("Edit message")).toHaveCount(0);
    },
  );

  test(
    "cancelling an edit leaves the message and the composer untouched",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectModel(page, "Mock-LLM");

      await sendSettledMessage(page, "Alpha one", 1);

      const userMessage = page.getByTestId("message-user").first();
      await openEditorFor(userMessage, page);
      await editTextbox(page).fill("discarded draft");

      await page.getByTestId("chat-input-cancel-edit").click();

      await expect(editTextbox(page)).toHaveCount(0);
      await expect(messageBox(page)).toBeVisible();
      await expect(messageBox(page)).toHaveValue("");
      await expect(userMessage).toContainText("Alpha one");
      await expect(page.getByTestId("message-user")).toHaveCount(1);
    },
  );
});
