import { test, expect } from "@playwright/test";
import { chatIsReadyToChat, createAuthenticatedContext } from "./shared";
import { TAG_CI } from "./tags";

test(
  "User cannot see chat from another user",
  { tag: TAG_CI },
  async ({ browser }) => {
    // User 01 logs in and creates a new chat
    const { context: user01Context, page: user01Page } =
      await createAuthenticatedContext(browser, "user01@example.com");
    await user01Page.goto("/");
    const textbox = user01Page.getByRole("textbox", {
      name: "Type a message...",
    });
    await textbox.fill("This is a private message for user 01");
    await textbox.press("Enter");
    await expect(user01Page).toHaveURL(/\/chat\/[0-9a-fA-F-]+/);
    const chatUrl = user01Page.url();

    // User 02 logs in
    const { context: user02Context, page: user02Page } =
      await createAuthenticatedContext(browser, "user02@example.com", "admin");

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

    await user01Context.close();
    await user02Context.close();
  },
);
