import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, sendFirstMessage } from "./shared";

const isFeedbackRequest =
  (method: string) => (r: import("@playwright/test").Response) =>
    r.url().includes("/feedback") && r.request().method() === method;

test(
  "Can submit, view, and retract message feedback",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");
    await chatIsReadyToChat(page);

    await sendFirstMessage(page, "Please write a short poem about the sun");
    await chatIsReadyToChat(page, {
      expectAssistantResponse: true,
      loadingTimeoutMs: 15000,
    });

    const assistantMessage = page.getByTestId("message-assistant").first();
    const dislikeButton = assistantMessage.getByLabel("Dislike message");
    const dialog = page.getByRole("dialog");

    // Submit negative feedback; with comments enabled a comment dialog opens
    await assistantMessage.hover();
    const submitResponse = page.waitForResponse(isFeedbackRequest("PUT"));
    await dislikeButton.click();
    expect((await submitResponse).status()).toBe(200);
    await dialog.getByRole("button", { name: "Skip" }).click();
    await expect(dialog).toHaveCount(0);

    // Clicking the active thumb opens the view dialog, which offers Remove
    await assistantMessage.hover();
    await dislikeButton.click();
    await expect(dialog.getByText("Your Feedback")).toBeVisible();
    await expect(dialog.getByText("You found this unhelpful")).toBeVisible();

    const deleteResponse = page.waitForResponse(isFeedbackRequest("DELETE"));
    await dialog.getByRole("button", { name: "Remove" }).click();
    expect((await deleteResponse).status()).toBe(204);
    await expect(dialog).toHaveCount(0);

    // The thumb unfills once the refetched messages no longer carry feedback
    await expect(dislikeButton.locator("svg")).not.toHaveClass(
      /fill-theme-error-fg/,
    );

    // Clicking the thumb now submits fresh feedback instead of opening the view dialog
    await assistantMessage.hover();
    const resubmitResponse = page.waitForResponse(isFeedbackRequest("PUT"));
    await dislikeButton.click();
    expect((await resubmitResponse).status()).toBe(200);
    await dialog.getByRole("button", { name: "Skip" }).click();
  },
);
