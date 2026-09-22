import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat } from "./shared";

/**
 * The composer's approval pre-announcement, against a deployment that really
 * is configured to stop a dispatch.
 *
 * The unit tests pin the gate by feeding the component a feature config. They
 * cannot show that a real backend's `[delegation.tasks]` config arrives as
 * that feature config: the value crosses `frontend_environment.rs`, the
 * injected `window` globals, `env.ts` and `FeatureConfigProvider` before any
 * component sees it, and every one of those is a place the wiring could be
 * right in isolation and wrong end to end.
 *
 * This scenario is the interesting configuration rather than a contrived one:
 * `[delegation.tasks]` is enabled with `run_modes = ["wait", "async"]`, and
 * `[delegation.tasks.approval]` is left at its default `async_only`. So the
 * mode alone would say nothing is stopped — it is the offered `async` run
 * mode that makes the announcement true, which is exactly the coupling the
 * acceptance criteria single out.
 */
test.describe("Task approval advisory", () => {
  test(
    "announces the approval on a deployment whose policy can stop a dispatch",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);

      const advisory = page.locator('[data-ui="chat-task-plan-advisory"]');
      await expect(advisory).toBeVisible();

      // `async_only` stops background tasks and nothing else, so that is what
      // the line has to say. Asserting the wording rather than mere presence
      // is the point: copy that overstated the policy would be its own
      // surprise, and this scenario is the one mode where the distinction
      // between "everything" and "background work" is load-bearing.
      await expect(advisory).toContainText(/background task/i);
    },
  );
});
