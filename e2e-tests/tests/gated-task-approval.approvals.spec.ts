import { expect, test, type Page } from "@playwright/test";

import { chatIsReadyToChat, gotoAppPage } from "./shared";

/**
 * The one test that proves the `approvals` scenario is wired end to end: a task
 * child stopping on an approval-gated MCP call, the question surfacing on the
 * origin turn, and the answer carrying the whole run to completion.
 *
 * It needs both halves of the scenario at once, which is why the scenario
 * exists. The mock LLM has to be the only chat provider or a live model answers
 * the child turn instead of the scripted rules; the restrictive approval preset
 * has to be on or the child's call simply runs; and the gated server has to sit
 * outside the planning facet's allowlist, so the call under decision can only
 * have come from the child.
 */

/**
 * Keyed by the mock LLM server's GatedTaskParentToolCall rule, which answers it
 * with a `delegate_task` call whose brief drives the gated child. Deliberately
 * not a superstring of the ungated task probe's prompt: mock matching is
 * first-match substring, so an overlap would let one probe answer the other's
 * turns.
 */
const TASK_PROMPT = "run the gated probe as a task";

/** The facet whose allowlist selects `erato/delegate_task`. */
const PLANNING_FACET = "Plan & delegate";

/** Its configured id, which is what the selected-facet chip is keyed by. */
const PLANNING_FACET_ID = "plan";

/** The child's gated tool, and the server it lives on. */
const GATED_TOOL = "publish_approval_probe";
const GATED_SERVER = "mock_mcp_approval";

/** Turns the origin turn, the child turn and the park take before the click. */
const PARK_TIMEOUT_MS = 60000;

/** Turns the resumed child and the origin's closing answer take after it. */
const RESUME_TIMEOUT_MS = 60000;

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

test("parks a task child on its gated call and finishes the run in the origin chat once approved", async ({
  page,
}) => {
  // The origin turn, the child's park, the decision, the resumed child and the
  // origin's closing answer are one test; the default budget covers none of it.
  test.setTimeout(240000);

  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);
  await selectPlanningFacet(page);
  await sendTaskMessage(page);

  const assistantMessage = page.getByTestId("message-assistant").last();

  // The park: one card for the stop, one row for the one child that asked. The
  // row names the CHILD's call — the `delegate_task` name on the item describes
  // the dispatch, so a row showing that instead would mean the question was
  // copied from the wrong side of the run.
  const approval = assistantMessage.getByTestId("delegated-task-approval");
  await expect(approval).toBeVisible({ timeout: PARK_TIMEOUT_MS });
  await expect(approval).toHaveAttribute("data-item-count", "1");
  const item = approval.getByTestId("delegated-task-approval-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(GATED_TOOL);
  await expect(item).toContainText(GATED_SERVER);
  // The child chat the decision covers, which is what makes this the origin's
  // surface for another chat's question rather than its own.
  await expect(item).not.toHaveAttribute("data-child-chat-id", "");

  // The origin turn says so on the step as well as in the card: the task has
  // not failed and has not finished, it is waiting on the user.
  const parkedStep = assistantMessage.locator(TASK_STEP);
  await expect(parkedStep).toHaveCount(1);
  await expect(parkedStep).toContainText("Needs your decision", {
    timeout: PARK_TIMEOUT_MS,
  });
  await expect(parkedStep.getByTestId("delegation-reason")).toContainText(
    "Waiting for your decision",
  );

  await item.getByRole("button", { name: "Allow once", exact: true }).click();

  // The question is answered, so it is gone rather than merely covered by what
  // came after it: the card renders only while the stop is open.
  await expect(approval).toHaveCount(0, { timeout: RESUME_TIMEOUT_MS });

  // The approved call ran in the child, the child answered on top of its result,
  // and that answer came back into this chat as the result of the parent's call.
  const settledStep = assistantMessage.locator(TASK_STEP);
  await expect(settledStep).toContainText("GATED-TASK-CHILD-ANSWER", {
    timeout: RESUME_TIMEOUT_MS,
  });
  await expect(assistantMessage).toContainText("GATED-TASK-PARENT-ANSWER", {
    timeout: RESUME_TIMEOUT_MS,
  });

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });

  // The finished turn folds the step behind the answer that followed it; it
  // stays mounted, so presence-based matchers still see it.
  await expect(settledStep).toHaveCount(1);
  await expect(settledStep).toContainText("Ran a task");
  // A run that was approved reports no failure and no reason: the park is not
  // something the step has to explain afterwards.
  await expect(settledStep.getByTestId("delegation-reason")).toHaveCount(0);
});
