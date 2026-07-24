import { expect, test, type Browser, type Page } from "@playwright/test";

import { chatIsReadyToChat, selectModel } from "./shared";
import { TAG_CI } from "./tags";

/**
 * Regression guard for ERMAIN-485 ("Geteilte Chats zeigen alle Bearbeitungen
 * und Regenerierungen"): the shared view must render only the active thread,
 * never the branches produced by edits/regenerations.
 *
 * We assert at the API level — the shared page is fed by the dedicated
 * `GET /share-links/{id}/messages` route, which always filters server-side. A
 * DOM-only check would pass for a cosmetic frontend filter that still leaks
 * branches over the wire, so we inspect the recipient's actual network
 * response and require zero `is_message_in_active_thread: false` entries. We
 * also pin the shared view against the owner's own active-view roles so the
 * test can't pass for the wrong reason.
 */

const messageBox = (page: Page) =>
  page.getByRole("textbox", { name: "Type a message..." });

const chatMessageRoles = async (page: Page): Promise<string[]> =>
  page
    .locator('[data-ui="chat-message"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-role") ?? ""),
    );

const loginForSharingTest = async (
  page: Page,
  email: string,
  password = "admin",
) => {
  await page.getByRole("button", { name: "Sign in with" }).click();
  await expect.poll(() => page.url(), { timeout: 10000 }).toContain("/auth");

  const emailInput = page.getByRole("textbox", { name: "email address" });
  await emailInput.waitFor({ state: "visible", timeout: 10000 });
  await emailInput.fill(email);

  const passwordInput = page.getByRole("textbox", { name: "Password" });
  await passwordInput.fill(password);
  await passwordInput.press("Enter");

  const chatTextbox = messageBox(page);
  const grantAccessButton = page.getByRole("button", { name: "Grant Access" });
  const grantAccessVisible = await grantAccessButton
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (grantAccessVisible) {
    await grantAccessButton.click();
  }

  await expect(chatTextbox).toBeVisible({ timeout: 10000 });
};

const createSharingTestContext = async (
  browser: Browser,
  email: string,
  password = "admin",
) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const chatTextbox = messageBox(page);
  const localAuthUsername = email.split("@")[0];

  await page.goto(`/?user=${encodeURIComponent(localAuthUsername)}`);

  try {
    await expect(chatTextbox).toBeVisible({ timeout: 5000 });
    return { context, page };
  } catch {
    await page.goto("/");
    await loginForSharingTest(page, email, password);
  }

  await expect(chatTextbox).toBeVisible({ timeout: 10000 });

  return { context, page };
};

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

test(
  "shared view shows only the active thread, not edited/regenerated branches",
  { tag: TAG_CI },
  async ({ browser }) => {
    test.setTimeout(180000);

    const owner = await test.step("Create owner session", async () =>
      createSharingTestContext(browser, "user01@example.com"));
    const recipient = await test.step("Create recipient session", async () =>
      createSharingTestContext(browser, "user02@example.com"));

    try {
      const { shareUrl, ownerRoles } = await test.step(
        "Owner builds a branched chat and shares it",
        async () => {
          // Record the chat's own generic-route messages URL as the owner
          // loads it, so the positive control below can re-fetch the full tree.
          let ownerMessagesUrl: string | undefined;
          owner.page.on("response", (response) => {
            if (
              response.request().method() === "GET" &&
              /\/api\/v1beta\/chats\/[^/]+\/messages/.test(response.url())
            ) {
              ownerMessagesUrl = response.url();
            }
          });

          await owner.page.goto("/");
          await chatIsReadyToChat(owner.page);
          await selectModel(owner.page, "Mock-LLM");

          // Two plain turns (texts avoid every mock trigger substring so each
          // resolves via the fast default response).
          await sendSettledMessage(owner.page, "hello", 1);
          await sendSettledMessage(owner.page, "hello2", 2);

          // Regenerate the first assistant reply -> orphans a branch.
          const firstAssistant = owner.page
            .getByTestId("message-assistant")
            .first();
          await firstAssistant.hover();
          const regenerateButton =
            firstAssistant.getByLabel("Regenerate response");
          await regenerateButton.waitFor({ state: "visible", timeout: 10000 });
          await regenerateButton.click();
          await chatIsReadyToChat(owner.page, { loadingTimeoutMs: 30000 });

          // Edit the first user message -> orphans another branch.
          const firstUser = owner.page.getByTestId("message-user").first();
          await firstUser.hover();
          const editButton = firstUser.getByLabel("Edit message");
          await editButton.waitFor({ state: "visible", timeout: 10000 });
          await editButton.click();

          const editTextbox = owner.page.getByTestId("message-editor-input");
          await expect(editTextbox).toBeVisible({ timeout: 30000 });
          await editTextbox.fill("hello edited");
          const saveButton = owner.page.getByTestId("message-editor-submit");
          await expect(saveButton).toBeEnabled();
          await saveButton.click();
          await chatIsReadyToChat(owner.page, { loadingTimeoutMs: 30000 });

          // Capture the owner's active-view roles: this is the ground truth the
          // shared view must reproduce exactly.
          const ownerRoles = await chatMessageRoles(owner.page);
          expect(ownerRoles.length).toBeGreaterThan(0);

          // Positive control: prove the edit + regenerate actually orphaned
          // branches server-side. Without it the shared-route assertion (no
          // `is_message_in_active_thread: false` rows) could pass vacuously if
          // no branch was ever created. The owner's own generic route returns
          // the full tree, including the discarded branches.
          expect(
            ownerMessagesUrl,
            "owner's generic messages route must have been observed",
          ).toBeTruthy();
          const ownerFullResponse = await owner.page.request.get(
            ownerMessagesUrl as string,
          );
          expect(ownerFullResponse.ok()).toBe(true);
          const ownerFullBody = (await ownerFullResponse.json()) as {
            messages: { is_message_in_active_thread: boolean }[];
          };
          const discardedBranches = ownerFullBody.messages.filter(
            (message) => message.is_message_in_active_thread === false,
          );
          expect(
            discardedBranches.length,
            "edit + regenerate must orphan at least one branch",
          ).toBeGreaterThan(0);

          await owner.page.getByRole("button", { name: "Share" }).click();
          const dialog = owner.page.getByRole("dialog", {
            name: "Share chat",
          });
          await expect(dialog).toBeVisible();

          const shareToggle = dialog.getByLabel("Toggle chat sharing");
          await shareToggle.click();

          const shareLinkField = dialog.getByLabel("Shared chat link");
          await expect(shareLinkField).toBeVisible();
          await expect(shareToggle).toBeChecked();
          const shareUrl = await shareLinkField.inputValue();
          expect(shareUrl).toContain("/chat-share/");

          await owner.page.keyboard.press("Escape");

          return { shareUrl, ownerRoles };
        },
      );

      await test.step(
        "Recipient's shared-messages response contains only the active thread",
        async () => {
          // Capture the recipient's response to the dedicated share-link route.
          const messagesResponsePromise = recipient.page.waitForResponse(
            (response) =>
              /\/api\/v1beta\/share-links\/[^/]+\/messages/.test(
                response.url(),
              ) && response.request().method() === "GET",
            { timeout: 20000 },
          );

          await recipient.page.goto(shareUrl);

          const response = await messagesResponsePromise;
          expect(response.ok()).toBe(true);
          const body = (await response.json()) as {
            messages: { role: string; is_message_in_active_thread: boolean }[];
          };

          // Server-side filter guarantee: no orphaned branches over the wire.
          const leaked = body.messages.filter(
            (message) => message.is_message_in_active_thread === false,
          );
          expect(leaked).toHaveLength(0);

          // The shared view must reproduce the owner's active view exactly.
          // The DOM's `data-role` collapses every non-user role to
          // "assistant", so normalize the API roles the same way to compare
          // like for like.
          const sharedRoles = body.messages
            .slice()
            .sort(
              (a, b) =>
                new Date(
                  (a as unknown as { created_at: string }).created_at,
                ).getTime() -
                new Date(
                  (b as unknown as { created_at: string }).created_at,
                ).getTime(),
            )
            .map((message) => (message.role === "user" ? "user" : "assistant"));
          expect(sharedRoles).toEqual(ownerRoles);

          // Sanity-check the rendered DOM matches too.
          await expect
            .poll(() => chatMessageRoles(recipient.page), { timeout: 15000 })
            .toEqual(ownerRoles);
          await expect(messageBox(recipient.page)).toHaveCount(0);
        },
      );
    } finally {
      await owner.context.close();
      await recipient.context.close();
    }
  },
);
