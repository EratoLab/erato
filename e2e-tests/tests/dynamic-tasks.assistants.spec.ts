import { expect, test, type Page } from "@playwright/test";

import { chatIsReadyToChat, gotoAppPage } from "./shared";

/**
 * Runs in the `assistants` scenario, not `many-models`, and the reason is
 * load-bearing: a delegated child run carries no provider of its own and falls
 * back to the deployment default. Here the only provider is the mock, so the
 * child answers from the scripted rules. In many-models the default is a live
 * model, which answers the child turn itself.
 */

/**
 * Keyed by the mock LLM server's DynamicTaskParentToolCall rule, which answers
 * it with a `delegate_task` call the model "planned" itself. Distinct from the
 * mention route's prompt so the two routes never answer each other's turns.
 */
const TASK_PROMPT = "run the probe as a task";

/** The facet whose allowlist selects `erato/delegate_task`. */
const PLANNING_FACET = "Plan & delegate";

/** Its configured id, which is what the selected-facet chip is keyed by. */
const PLANNING_FACET_ID = "plan";

/** Turns the whole task run — child turn plus the origin's answer — take. */
const RUN_TIMEOUT_MS = 60000;

const TASK_STEP =
  '[data-testid="tool-call-item"][data-tool-name="delegate_task"]';

/**
 * Selects the planning facet, which is what offers the tool: enabling the
 * feature is deliberately not enough on its own.
 *
 * Facets are rows of the composer's "Tools" dropdown, not bare toggles, so the
 * menu has to be opened before the row exists. Selecting one renders it as its
 * own chip beside the trigger, which is what confirms the selection stuck.
 */
const selectPlanningFacet = async (page: Page) => {
  const trigger = page.locator(
    'button[aria-controls="facet-selector-dropdown"]',
  );
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click();
  await page
    .getByRole("menuitem", { name: PLANNING_FACET, exact: true })
    .click();
  await expect(
    page.getByTestId(`selected-facet-${PLANNING_FACET_ID}`),
  ).toBeVisible();
};

const sendTaskMessage = async (page: Page) => {
  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await textbox.click();
  await textbox.pressSequentially(TASK_PROMPT);
  await expect(textbox).toHaveValue(TASK_PROMPT);

  const submitResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1beta/me/messages/submitstream"),
    { timeout: 10000 },
  );
  await textbox.press("Enter");
  const response = await submitResponse;
  expect(
    response.ok(),
    `submitstream should open a 2xx stream, got ${response.status()}`,
  ).toBe(true);
  await page.waitForURL(/\/chat\/[0-9a-fA-F-]+/, { timeout: 15000 });
};

test("runs a model-planned task and brings its answer back into the chat", async ({
  page,
}) => {
  // The origin turn, the whole task run and the origin's closing answer are
  // one test; the default budget covers none of it.
  test.setTimeout(180000);

  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);
  await selectPlanningFacet(page);
  await sendTaskMessage(page);

  const assistantMessage = page.getByTestId("message-assistant").last();

  // While the task runs, the origin chat's step is in flight. The first frame
  // has no envelope yet, so the title arrives with the first progress frame —
  // both are inside the same card.
  const runningStep = assistantMessage.locator(
    `${TASK_STEP}[data-tool-status="in_progress"]`,
  );
  await expect(runningStep).toHaveCount(1, { timeout: RUN_TIMEOUT_MS });
  // Titled by its route, not by an assistant: under the default persona a
  // task child carries the origin chat's assistant name, so the name would
  // not tell the two routes apart.
  await expect(runningStep).toContainText("Running a task", {
    timeout: RUN_TIMEOUT_MS,
  });
  // The brief is the only thing on the step that says WHAT is running.
  await expect(runningStep.getByTestId("delegation-brief")).toContainText(
    "count the available mock files",
    { timeout: RUN_TIMEOUT_MS },
  );
  await expect(runningStep.getByTestId("delegation-open-run")).toBeVisible();

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RUN_TIMEOUT_MS,
  });

  // The finished turn folds the step behind the answer that followed it; it
  // stays mounted, so presence-based matchers still see it.
  const settledStep = assistantMessage.locator(TASK_STEP);
  await expect(settledStep).toHaveCount(1);
  await expect(settledStep).toContainText("Ran a task");
  // The sub-task's answer came back as the result of the call, and the origin
  // model answered on top of it.
  await expect(settledStep).toContainText("TASK-CHILD-ANSWER");
  await expect(assistantMessage).toContainText("TASK-PARENT-ANSWER");

  // A completed run says nothing extra: no error pill, no reason line.
  await expect(settledStep.getByTestId("delegation-reason")).toHaveCount(0);
});
