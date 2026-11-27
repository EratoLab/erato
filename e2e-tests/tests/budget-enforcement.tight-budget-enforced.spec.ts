import { expect, test } from "@playwright/test";
import { chatIsReadyToChat, createAuthenticatedContext } from "./shared";
import { TAG_CI } from "./tags";

test(
  "Refuses a real follow-up after the personal budget is exhausted",
  { tag: TAG_CI },
  async ({ browser, browserName }, testInfo) => {
    // Each browser and CI retry starts with an unused budget.
    const account = (browserName === "chromium" ? 1 : 4) + testInfo.retry;
    const { context, page } = await createAuthenticatedContext(
      browser,
      `user0${account}@example.com`,
      "admin",
    );

    try {
      await page.goto("/");
      await chatIsReadyToChat(page);
      const textbox = page.getByRole("textbox", { name: "Type a message..." });
      await textbox.fill("Hello, please respond with a brief greeting.");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      const draft = "Can you share one more greeting?";
      await textbox.fill(draft);
      const refusal = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1beta/me/messages/submitstream") &&
          response.request().method() === "POST",
      );
      await textbox.press("Enter");
      const response = await refusal;
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "budget_limit_reached",
      });
      await expect(page.getByTestId("chat-send-error")).toContainText(
        "Your personal generation budget has been reached.",
      );
      await expect(textbox).toHaveValue(draft);
    } finally {
      await context.close();
    }
  },
);
