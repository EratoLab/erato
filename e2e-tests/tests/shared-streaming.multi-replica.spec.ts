import { expect, test, type Page } from "@playwright/test";
import { chatIsReadyToChat } from "./shared";
import { TAG_CI } from "./tags";

const messageBox = (page: Page) =>
  page.getByRole("textbox", { name: "Type a message..." });
const stopButton = (page: Page) =>
  page.getByTestId("chat-input-stop-generation");
const firstTokenTimeout = 15000;

test.describe("shared streaming state", () => {
  test(
    "keeps a long-running generation consistent across five page reloads",
    { tag: TAG_CI },
    async ({ page }) => {
      test.setTimeout(120000);

      await page.goto("/");
      await chatIsReadyToChat(page);
      await expect(page.getByText("Mock-LLM", { exact: true })).toBeVisible({
        timeout: firstTokenTimeout,
      });

      await messageBox(page).fill("long running 30");
      await messageBox(page).press("Enter");
      await expect(stopButton(page)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText("Second 1 passed")).toBeVisible({
        timeout: firstTokenTimeout,
      });

      for (let reload = 1; reload <= 5; reload += 1) {
        await page.reload();
        await expect(messageBox(page)).toBeVisible({ timeout: 15000 });

        // The reload must reconnect to the active generation even when the
        // Service sends this request to a different backend pod.
        await expect(stopButton(page)).toBeVisible({ timeout: 15000 });
        await expect(page.getByText("Second 1 passed")).toBeVisible({
          timeout: firstTokenTimeout,
        });

        const assistant = page.getByTestId("message-assistant").last();
        await expect(assistant).not.toContainText(
          "The message could not be generated.",
        );
        await test.step(
          "reload " + reload + " preserved the active stream",
          async () => {
            await expect(assistant).toContainText("Second 1 passed");
          },
        );
      }

      await expect(stopButton(page)).toHaveCount(0, { timeout: 60000 });
      await expect(page.getByTestId("message-assistant").last()).toContainText(
        "Second 30 passed. Complete!",
        { timeout: 15000 },
      );
    },
  );
});
