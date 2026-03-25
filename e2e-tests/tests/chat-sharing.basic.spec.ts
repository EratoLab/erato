import { expect, test, type Browser, type Page } from "@playwright/test";

import { chatIsReadyToChat, ensureOpenSidebar } from "./shared";
import { TAG_CI } from "./tags";

const loginForSharingTest = async (
  page: Page,
  email: string,
  password = "admin",
) => {
  await page.getByRole("button", { name: "Sign in with" }).click();
  await expect.poll(() => page.url(), { timeout: 10000 }).toContain("/auth");

  if (page.url().includes("http://0.0.0.0:5556/")) {
    await page.goto(page.url().replace("0.0.0.0", "localhost"));
  }

  const emailInput = page.getByRole("textbox", { name: "email address" });
  await emailInput.waitFor({ state: "visible", timeout: 10000 });
  await emailInput.fill(email);

  const passwordInput = page.getByRole("textbox", { name: "Password" });
  await passwordInput.fill(password);
  await passwordInput.press("Enter");

  const chatTextbox = page.getByRole("textbox", { name: "Type a message..." });
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
  await context.route("http://0.0.0.0:5556/**", (route) =>
    route.continue({
      url: route.request().url().replace("0.0.0.0", "localhost"),
    }),
  );
  const page = await context.newPage();
  const chatTextbox = page.getByRole("textbox", { name: "Type a message..." });
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

test(
  "Users can share, view, and unshare a chat",
  { tag: TAG_CI },
  async ({ browser }) => {
    const owner = await test.step("Create owner session", async () =>
      createSharingTestContext(browser, "user01@example.com"));
    const recipient = await test.step("Create recipient session", async () =>
      createSharingTestContext(browser, "user02@example.com"));

    try {
      const shareUrl =
        await test.step("Owner creates a chat and enables sharing", async () => {
          await owner.page.goto("/");
          await chatIsReadyToChat(owner.page);

          const input = owner.page.getByRole("textbox", {
            name: "Type a message...",
          });
          await input.fill("Please answer with exactly: Shared hello");
          await input.press("Enter");

          await chatIsReadyToChat(owner.page, {
            expectAssistantResponse: true,
            loadingTimeoutMs: 15000,
          });
          await expect(owner.page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);

          await owner.page.getByRole("button", { name: "Share" }).click();
          const dialog = owner.page.getByRole("dialog", { name: "Share chat" });
          await expect(dialog).toBeVisible();
          await expect(dialog).toContainText(
            "The conversation may contain sensitive information",
          );

          const shareToggle = dialog.getByLabel("Toggle chat sharing");
          await shareToggle.click();

          const shareLinkField = dialog.getByLabel("Shared chat link");
          await expect(shareLinkField).toBeVisible();
          await expect(shareToggle).toBeChecked();
          const createdShareUrl = await shareLinkField.inputValue();
          expect(createdShareUrl).toContain("/chat-share/");

          await owner.page.keyboard.press("Escape");
          await expect(dialog).not.toBeVisible();
          await expect(
            owner.page.getByRole("button", { name: "Shared" }),
          ).toBeVisible();

          return createdShareUrl;
        });

      await test.step("Recipient can open the shared chat", async () => {
        await recipient.page.goto(shareUrl);
        await expect(
          recipient.page
            .getByTestId("message-assistant")
            .getByText("Shared hello")
            .last(),
        ).toBeVisible({ timeout: 15000 });
        await expect(
          recipient.page.getByRole("textbox", { name: "Type a message..." }),
        ).toHaveCount(0);
      });

      await test.step("Owner disables sharing from the sidebar menu", async () => {
        await ensureOpenSidebar(owner.page);
        const chatId = owner.page.url().split("/").pop();
        await owner.page
          .locator(`[data-chat-id="${chatId}"]`)
          .getByRole("button", { name: /menu|more|options/i })
          .click();
        await owner.page.getByRole("menuitem", { name: "Share" }).click();

        const reopenDialog = owner.page.getByRole("dialog", {
          name: "Share chat",
        });
        await expect(reopenDialog).toBeVisible();
        const reopenShareToggle = reopenDialog.getByLabel(
          "Toggle chat sharing",
        );
        await reopenShareToggle.click();
        await expect(reopenDialog.getByLabel("Shared chat link")).toHaveCount(
          0,
        );
        await expect(reopenShareToggle).not.toBeChecked();
        await owner.page.keyboard.press("Escape");
      });

      await test.step("Recipient can no longer access the shared chat", async () => {
        await recipient.page.reload();
        await expect(
          recipient.page.getByText("This shared chat is unavailable."),
        ).toBeVisible({ timeout: 15000 });
      });
    } finally {
      await owner.context.close();
      await recipient.context.close();
    }
  },
);
