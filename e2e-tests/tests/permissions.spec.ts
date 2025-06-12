import { test, expect } from "@playwright/test";
import { chatIsReadyToChat, login } from "./shared";
import { TAG_CI } from "./tags";

test(
  "User cannot see chat from another user",
  { tag: TAG_CI },
  async ({ page, browser }) => {
    // User 01 logs in and creates a new chat
    await page.goto("/");
    await login(page, "user01@example.com");
    const textbox = page.getByRole("textbox", { name: "Type a message..." });
    await textbox.fill("This is a private message for user 01");
    await textbox.press("Enter");
    await expect(page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);
    const chatUrl = page.url();

    // User 02 logs in
    const user02Context = await browser.newContext();
    const user02Page = await user02Context.newPage();
    await user02Page.goto("/");
    await login(user02Page, "user02@example.com", "admin");

    // User 02 tries to access the chat from user 01
    await user02Page.goto(chatUrl);

    // The chat should not be visible
    await chatIsReadyToChat(user02Page);
    await expect(
      user02Page.getByText("This is a private message for user 01"),
    ).not.toBeVisible();

    // TODO: Adjust interaction? Either display a 404 page or redirect to base page
    // And the user should be on the base chat page, not the specific chat URL
    // await expect(user02Page).toHaveURL(/\/chat$/);

    await user02Context.close();
  },
);
