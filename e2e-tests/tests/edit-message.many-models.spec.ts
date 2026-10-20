import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { chatIsReadyToChat, selectModel } from "./shared";
import { TAG_CI } from "./tags";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF = "sample-report-compressed.pdf";

/**
 * Runs against the Mock-LLM so turns settle deterministically. The previous
 * `basic`-scenario version of these tests was skipped in CI because it drove a
 * real provider, whose latency and variable replies made the message-id waits
 * flaky.
 */

const messageBox = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Type a message..." });

const editTextbox = (page: Page): Locator =>
  page.getByTestId("message-editor-input");

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

/** Sends a message carrying the sample PDF and waits for its turn to settle. */
const sendWithFile = async (page: Page, text: string) => {
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /upload files/i }).click();
  await (
    await fileChooser
  ).setFiles(path.join(__dirname, "../test-files", PDF));
  await expect(
    page.getByRole("button", {
      name: /Preview attachment sample-report-compressed\.pdf/,
    }),
  ).toBeVisible({ timeout: 10000 });
  await sendSettledMessage(page, text, 1);
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
      const saveButton = page.getByTestId("message-editor-submit");
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

      await page.getByTestId("message-editor-cancel").click();

      await expect(editTextbox(page)).toHaveCount(0);
      await expect(messageBox(page)).toBeVisible();
      await expect(messageBox(page)).toHaveValue("");
      await expect(userMessage).toContainText("Alpha one");
      await expect(page.getByTestId("message-user")).toHaveCount(1);
    },
  );

  test(
    "the editor stages the message's file in the shared area above the field",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(90000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectModel(page, "Mock-LLM");
      await sendWithFile(page, "Summarise the report");

      await openEditorFor(page.getByTestId("message-user").first(), page);
      const editor = page.getByTestId("message-editor");
      const staged = editor.locator('[data-ui="composer-staged-area"]');
      await expect(
        staged.getByRole("button", {
          name: /Preview attachment sample-report-compressed\.pdf/,
        }),
      ).toBeVisible();
      // Above the field, where the composer and the sent message draw it.
      const area = await staged.boundingBox();
      const field = await editTextbox(page).boundingBox();
      expect(area && field).toBeTruthy();
      expect(area!.y + area!.height).toBeLessThanOrEqual(field!.y + 0.5);
      // A plain file is no context chip: there is no lane to name.
      await expect(
        editor.locator('[data-ui="composer-context-chip"]'),
      ).toHaveCount(0);

      // Escape from the file row cancels the edit, as it does in the field.
      await staged
        .getByRole("button", {
          name: /Preview attachment sample-report-compressed\.pdf/,
        })
        .focus();
      await page.keyboard.press("Escape");
      await expect(editor).toHaveCount(0);
      await expect(page.getByTestId("message-user").first()).toContainText(
        "Summarise the report",
      );
    },
  );

  test(
    "removing the file in the editor sends the edit without it",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(90000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectModel(page, "Mock-LLM");
      await sendWithFile(page, "Summarise the report");

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

      await openEditorFor(page.getByTestId("message-user").first(), page);
      const editor = page.getByTestId("message-editor");
      await editor
        .locator(`button[aria-label*="Remove ${PDF}"]:not([disabled])`)
        .first()
        .click();
      await expect(
        editor.locator('[data-ui="composer-staged-area"]'),
      ).toBeHidden();

      await editTextbox(page).fill("Summarise without the report");
      await page.getByTestId("message-editor-submit").click();
      await chatIsReadyToChat(page, { loadingTimeoutMs: 30000 });

      expect(requestBody).not.toBeNull();
      // An empty list is omitted, which the server reads as no files.
      expect(requestBody).not.toHaveProperty("replace_input_files_ids");
      expect(requestBody).not.toHaveProperty("action_facet");
      const edited = page.getByTestId("message-user").first();
      await expect(edited).toContainText("Summarise without the report");
      await expect(
        edited.getByRole("button", {
          name: /Preview attachment sample-report-compressed\.pdf/,
        }),
      ).toHaveCount(0);
    },
  );
});
