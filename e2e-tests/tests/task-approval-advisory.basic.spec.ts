import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat } from "./shared";

/**
 * The other half of the advisory's contract: silence.
 *
 * The `basic` scenario configures no `[delegation]` at all, so it runs the
 * shipped defaults — tasks off, and an approval mode of `async_only` that
 * stops nothing because no run mode is offered. That is precisely the
 * "default deployment" the acceptance criteria require to stay quiet, and it
 * is worth an assertion against a real backend rather than a stubbed config:
 * the mode is published to clients ungated, so the only thing keeping this
 * deployment silent is the enabled flag arriving correctly.
 *
 * A composer that warned here would be announcing an interruption that
 * nothing in the deployment is able to perform.
 */
test.describe("Task approval advisory", () => {
  test(
    "says nothing on a default deployment",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);

      await expect(
        page.locator('[data-ui="chat-task-plan-advisory"]'),
      ).toHaveCount(0);
    },
  );
});
