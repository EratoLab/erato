import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, ensureOpenSidebar } from "./shared";

test(
  "Can open new chat page and input is focused",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    await expect(
      page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeFocused();
  },
);

test(
  "Can archive a non-focused chat via the sidebar menu",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await ensureOpenSidebar(page);

    // Create first chat
    await textbox.fill("2-line poem about the sun");
    await textbox.press("Enter");
    await chatIsReadyToChat(page, { expectAssistantResponse: true });
    const firstChatUrl = page.url();
    const firstChatId = firstChatUrl.split("/").pop();

    // Create second chat

    await page.goto("/");
    // await page.getByRole("button", { name: "New Chat" }).click();
    await chatIsReadyToChat(page);
    const textbox2 = page.getByRole("textbox", { name: "Type a message..." });
    await textbox2.fill("2-line poem about the moon");
    await textbox2.press("Enter");
    await chatIsReadyToChat(page, { expectAssistantResponse: true });
    const secondChatUrl = page.url();
    const secondChatId = secondChatUrl.split("/").pop();

    expect(page.url()).toEqual(secondChatUrl);
    await ensureOpenSidebar(page);
    // Focus the second chat (should already be focused)
    // Archive the first chat via sidebar
    const sidebar = page.getByRole("complementary");
    const firstChatSidebarItem = sidebar.locator(
      `[data-chat-id="${firstChatId}"]`,
    );
    await expect(firstChatSidebarItem).toBeVisible();
    // Open the menu for the first chat
    await firstChatSidebarItem
      .getByRole("button", { name: "Open menu" })
      .click();
    // Click 'Remove' in the menu
    await page.getByRole("menuitem", { name: "Remove" }).click();
    // Confirm in the dialog
    await page.getByRole("button", { name: "Confirm action" }).click();
    // The first chat should no longer be in the sidebar
    await expect(
      sidebar.locator(`[data-chat-id="${firstChatId}"]`),
    ).toHaveCount(0);
    // The second chat should still be present
    await expect(
      sidebar.locator(`[data-chat-id="${secondChatId}"]`),
    ).toBeVisible();
    // We should still be on the second chat page
    expect(page.url()).toEqual(secondChatUrl);
  },
);

test(
  "Can rename a chat from the sidebar menu and clear the custom title",
  { tag: TAG_CI },
  async ({ page }) => {
    const renamedTitle = "Updated via E2E";
    const updateBodies: Array<Record<string, unknown> | undefined> = [];

    await page.route("**/api/v1beta/me/chats/*", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        const raw = request.postData();
        updateBodies.push(
          raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined,
        );
      }
      await route.continue();
    });

    await page.goto("/");
    await ensureOpenSidebar(page);

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await textbox.fill("give me a one-line poem");
    await textbox.press("Enter");
    await chatIsReadyToChat(page, { expectAssistantResponse: true });

    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);
    const chatId = page.url().split("/").pop();
    await ensureOpenSidebar(page);
    const sidebar = page.getByRole("complementary");
    const chatItem = sidebar.locator(`[data-chat-id="${chatId}"]`);
    await expect(chatItem).toBeVisible();

    // Rename chat
    await chatItem.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("dialog", { name: "Rename chat" }).waitFor();

    const customTitleInput = page.getByRole("textbox", {
      name: "Custom title",
    });
    await customTitleInput.fill(renamedTitle);
    await page.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByRole("dialog", { name: "Rename chat" })).toHaveCount(
      0,
    );

    await expect(chatItem.getByText(renamedTitle)).toBeVisible();
    await expect.poll(() => updateBodies.length).toBeGreaterThan(0);
    expect(updateBodies[0]).toEqual({
      title_by_user_provided: renamedTitle,
    });

    // Clear custom title (submit empty input)
    await ensureOpenSidebar(page);
    await chatItem.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("dialog", { name: "Rename chat" }).waitFor();

    await customTitleInput.fill("");
    await page.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByRole("dialog", { name: "Rename chat" })).toHaveCount(
      0,
    );

    await expect(chatItem.getByText(renamedTitle)).toHaveCount(0);
    await expect.poll(() => updateBodies.length).toBeGreaterThan(1);
    expect(updateBodies[1]).toEqual({});
  },
);

test(
  "Can paste an image from clipboard as a chat attachment",
  { tag: TAG_CI },
  async ({ page }) => {
    let uploadRequestCount = 0;
    await page.route("**/api/v1beta/me/files*", async (route) => {
      uploadRequestCount += 1;
      await route.continue();
    });

    await page.goto("/");

    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await expect(textbox).toBeVisible();
    await textbox.click();

    await page.evaluate(() => {
      const target = document.activeElement;
      if (!(target instanceof HTMLTextAreaElement)) {
        throw new Error("Expected active element to be the chat textarea");
      }

      const imageBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s5H8JYAAAAASUVORK5CYII=";
      const binary = atob(imageBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      const dataTransfer = new DataTransfer();
      const file = new File([bytes], "clipboard-image.png", {
        type: "image/png",
      });
      dataTransfer.items.add(file);

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(pasteEvent, "clipboardData", {
        value: dataTransfer,
      });

      target.dispatchEvent(pasteEvent);
    });

    await expect.poll(() => uploadRequestCount).toBeGreaterThan(0);
    await expect(page.getByText("Attachments")).toBeVisible();
    await expect(page.getByText(/clipboard-image/i)).toBeVisible();

    await textbox.fill("what is in this image?");
    await textbox.press("Enter");
    await chatIsReadyToChat(page, { expectAssistantResponse: true });
  },
);

test(
  "Can edit user preferences from the profile menu",
  { tag: TAG_CI },
  async ({ page }) => {
    const uniqueSuffix = Date.now();
    const nickname = `Max-${uniqueSuffix}`;
    const jobTitle = `Engineer-${uniqueSuffix}`;
    const customInstructions = `Be concise and practical. ${uniqueSuffix}`;
    const additionalInformation = `I work on backend systems. ${uniqueSuffix}`;
    const preferenceUpdates: Array<Record<string, unknown> | undefined> = [];

    await page.route("**/api/v1beta/me/profile/preferences*", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        const raw = request.postData();
        preferenceUpdates.push(
          raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined,
        );
      }
      await route.continue();
    });

    await page.goto("/");
    await chatIsReadyToChat(page);
    await ensureOpenSidebar(page);

    await page
      .getByRole("button")
      .filter({ has: page.getByTestId("avatar-identity") })
      .click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();

    await expect(
      page.getByRole("dialog", { name: "Preferences" }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "Nickname" }).fill(nickname);
    await page.getByRole("textbox", { name: "Job title" }).fill(jobTitle);
    await page
      .getByRole("textbox", {
        name: "Custom instructions for the assistant",
      })
      .fill(customInstructions);
    await page
      .getByRole("textbox", { name: "Additional information" })
      .fill(additionalInformation);

    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog", { name: "Preferences" })).toHaveCount(
      0,
    );

    await expect.poll(() => preferenceUpdates.length).toBeGreaterThan(0);
    expect(preferenceUpdates[0]).toEqual({
      preference_nickname: nickname,
      preference_job_title: jobTitle,
      preference_assistant_custom_instructions: customInstructions,
      preference_assistant_additional_information: additionalInformation,
    });

    await page
      .getByRole("button")
      .filter({ has: page.getByTestId("avatar-identity") })
      .click();
    await page.getByRole("menuitem", { name: "Preferences" }).click();

    await expect(page.getByRole("textbox", { name: "Nickname" })).toHaveValue(
      nickname,
    );
    await expect(page.getByRole("textbox", { name: "Job title" })).toHaveValue(
      jobTitle,
    );
  },
);
