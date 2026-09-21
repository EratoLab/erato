import { expect, test, type Locator, type Page } from "@playwright/test";

import { chatIsReadyToChat, gotoAppPage } from "./shared";

/**
 * What happens to the OTHER side of a parked child: the sibling that finished
 * first, the child's own chat, and the run after a denial.
 *
 * The park itself and the approve-and-finish path are covered by
 * `gated-task-approval.approvals.spec.ts`, and a stop covering two decisions by
 * `batch-continuation.approvals.spec.ts`. What neither of them can say is
 * whether a denial ends the call or the run, whether a park vacates the slot its
 * sibling's result is owed to, and whether the child's own chat is a second
 * decision surface. Those are this file.
 *
 * All three read a property that is only visible from a client. The denial is
 * the sharpest: an integration test can assert the turn completed, but only the
 * transcript shows the child speaking on top of the refusal — so the child's
 * answer here is its own turn's tool trace, and the refusal text is in it or
 * the claim fails.
 */

/** Keyed by the mock LLM's RefusedTaskParentToolCall rule: one gated child. */
const REFUSED_TASK_PROMPT = "refuse the gated probe task";

/**
 * Keyed by MixedGatedTasksToolCalls: two children of which only the first stops,
 * so the turn has to settle the second before it asks about the first.
 */
const MIXED_TASKS_PROMPT = "run one gated and one plain probe as tasks";

/** Keyed by GatedTaskParentToolCall, whose park test 3 borrows to visit. */
const GATED_TASK_PROMPT = "run the gated probe as a task";

/** The facet whose allowlist selects `erato/delegate_task`. */
const PLANNING_FACET = "Plan & delegate";

/** Its configured id, which is what the selected-facet chip is keyed by. */
const PLANNING_FACET_ID = "plan";

/** The child's gated tool, and the server it lives on. */
const GATED_TOOL = "publish_approval_probe";
const GATED_SERVER = "mock_mcp_approval";

/** What a refused call leaves in the child's context, and so in its answer. */
const DENIAL_TEXT = "The user denied this tool call.";

/** What the refused child's answer opens with: its own turn's tool trace. */
const REFUSED_CHILD_TRACE = "REFUSED-CHILD-CONTEXT";

/** And what the origin says on top of a sub-task that was refused. */
const REFUSED_PARENT_ANSWER = "REFUSED-TASK-PARENT-ANSWER";

/** The mixed pair's two briefs, which is what says which slot is which. */
const MIXED_GATED_BRIEF = "Mixed gated child brief";
const MIXED_PLAIN_BRIEF = "Mixed plain child brief";

/** The ungated sibling's answer, committed before the turn asks about the other. */
const MIXED_PLAIN_ANSWER = "MIXED-PLAIN-CHILD-ANSWER";

/** The gated child's answer once allowed: its own trace. */
const MIXED_GATED_CHILD_TRACE = "MIXED-GATED-CHILD-CONTEXT";

const MIXED_PARENT_ANSWER = "MIXED-TASKS-PARENT-ANSWER";

/** What the child of the gated probe answers with once it is allowed to run. */
const GATED_CHILD_ANSWER = "GATED-TASK-CHILD-ANSWER";

/** Turns the origin turn, the children and the park take before a decision. */
const PARK_TIMEOUT_MS = 60000;

/** Turns the resumed run and the origin's closing answer take after it. */
const RESUME_TIMEOUT_MS = 90000;

const TASK_STEP =
  '[data-testid="tool-call-item"][data-tool-name="delegate_task"]';

/**
 * Selects the planning facet, which is what offers the tool: enabling the
 * feature is deliberately not enough on its own. Facets are rows of the
 * composer's "Tools" dropdown, so the menu has to be opened before the row
 * exists.
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

const sendMessage = async (page: Page, prompt: string) => {
  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await textbox.click();
  await textbox.pressSequentially(prompt);
  await expect(textbox).toHaveValue(prompt);

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

/** A fresh chat parked on the given prompt's task run. */
const parkOnTaskPrompt = async (
  page: Page,
  prompt: string,
): Promise<{ assistantMessage: Locator; approval: Locator }> => {
  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);
  await selectPlanningFacet(page);
  await sendMessage(page, prompt);

  const assistantMessage = page.getByTestId("message-assistant").last();
  const approval = assistantMessage.getByTestId("delegated-task-approval");
  await expect(approval).toBeVisible({ timeout: PARK_TIMEOUT_MS });
  return { assistantMessage, approval };
};

test("denies a parked child, which finishes in prose, and the origin turn completes on top of the refusal", async ({
  page,
}) => {
  // The origin turn, the child's park, the denial, the refused child's closing
  // turn and the origin's own answer are one test.
  test.setTimeout(240000);

  const { assistantMessage, approval } = await parkOnTaskPrompt(
    page,
    REFUSED_TASK_PROMPT,
  );

  // One card for the stop, one row for the one child that asked, naming the
  // CHILD's call: the `delegate_task` name on the item describes the dispatch,
  // so a row showing that instead would mean the question came from the wrong
  // side of the run.
  await expect(approval).toHaveAttribute("data-item-count", "1");
  const item = approval.getByTestId("delegated-task-approval-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(GATED_TOOL);
  await expect(item).toContainText(GATED_SERVER);
  await expect(item).not.toHaveAttribute("data-child-chat-id", "");

  const parkedStep = assistantMessage.locator(TASK_STEP);
  await expect(parkedStep).toContainText("Needs your decision", {
    timeout: PARK_TIMEOUT_MS,
  });

  await item.getByRole("button", { name: "Deny once", exact: true }).click();

  // Answered, so gone: the card renders only while the stop is open.
  await expect(approval).toHaveCount(0, { timeout: RESUME_TIMEOUT_MS });

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });

  // Deny is not kill. The child was told about the refusal and answered on top
  // of it: its answer is its own turn's tool trace, so the refused call and the
  // refusal text are both in the result this chat received. A child that had
  // been killed by the denial would have nothing here at all, and one that was
  // never told would report the call as having run.
  const settledStep = assistantMessage.locator(TASK_STEP);
  await expect(settledStep).toHaveCount(1);
  await expect(settledStep).toContainText(
    `${REFUSED_CHILD_TRACE}: ${GATED_TOOL}[`,
    { timeout: RESUME_TIMEOUT_MS },
  );
  await expect(settledStep).toContainText(DENIAL_TEXT);

  // And the turn it was dispatched from finished: a denial ends the call, not
  // the run, so the origin model answered rather than failing.
  await expect(assistantMessage).toContainText(REFUSED_PARENT_ANSWER, {
    timeout: RESUME_TIMEOUT_MS,
  });
  await expect(page.getByTestId("chat-message-error")).toHaveCount(0);
  // A denied child is a run that finished, not one that failed: the step has no
  // reason to explain afterwards.
  await expect(settledStep.getByTestId("delegation-reason")).toHaveCount(0);
});

test("commits the sibling that finished before it asks, and leaves the parked child at its own slot", async ({
  page,
}) => {
  test.setTimeout(240000);

  const { assistantMessage, approval } = await parkOnTaskPrompt(
    page,
    MIXED_TASKS_PROMPT,
  );

  // Two tasks, one question: the stop covers only the child that asked.
  await expect(approval).toHaveAttribute("data-item-count", "1");
  const item = approval.getByTestId("delegated-task-approval-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(GATED_TOOL);

  const steps = assistantMessage.locator(TASK_STEP);
  await expect(steps).toHaveCount(2);
  const gatedStep = steps.nth(0);
  const plainStep = steps.nth(1);

  // Park-after-settle, as ONE snapshot of both slots taken while the question is
  // open, with no retry window. Waiting for each half separately would prove
  // nothing about their order: this run is fast enough that a turn which asked
  // the instant its first child parked would still settle the sibling within any
  // polling budget. Read together, the snapshot says the sibling's result was
  // already committed when the card appeared.
  //
  // Which slot is which comes off the briefs rather than from the order, or the
  // claim about the order would be circular.
  const parkedSnapshot = await steps.evaluateAll((nodes) =>
    nodes.map((node) => node.textContent ?? ""),
  );
  expect(parkedSnapshot).toHaveLength(2);
  // Slot 0 is the child that stopped, because it was dispatched first, and its
  // placeholder is still sitting there saying so — a park that vacated its slot
  // would leave the two results in the wrong order.
  expect(parkedSnapshot[0]).toContain(MIXED_GATED_BRIEF);
  expect(parkedSnapshot[0]).toContain("Needs your decision");
  // Slot 1 is the sibling, finished and committed before the turn asked.
  expect(parkedSnapshot[1]).toContain(MIXED_PLAIN_BRIEF);
  expect(parkedSnapshot[1]).toContain(MIXED_PLAIN_ANSWER);

  await expect(gatedStep.getByTestId("delegation-reason")).toContainText(
    "Waiting for your decision",
  );

  await item.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(approval).toHaveCount(0, { timeout: RESUME_TIMEOUT_MS });

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });

  // The resumed child settled into the slot its placeholder was holding, and
  // the sibling behind it was not disturbed or re-run: still two slots, still
  // in dispatch order, each with its own child's answer.
  await expect(steps).toHaveCount(2);
  await expect(gatedStep).toContainText(
    `${MIXED_GATED_CHILD_TRACE}: ${GATED_TOOL}[`,
    { timeout: RESUME_TIMEOUT_MS },
  );
  await expect(gatedStep).toContainText("approval probe published");
  await expect(gatedStep.getByTestId("delegation-reason")).toHaveCount(0);
  await expect(plainStep).toContainText(MIXED_PLAIN_ANSWER);

  await expect(assistantMessage).toContainText(MIXED_PARENT_ANSWER, {
    timeout: RESUME_TIMEOUT_MS,
  });
});

test("sends a parked child's own card to the origin chat while it is asking, and takes the decision there once it is not", async ({
  page,
}) => {
  test.setTimeout(300000);

  const { approval } = await parkOnTaskPrompt(page, GATED_TASK_PROMPT);
  const item = approval.getByTestId("delegated-task-approval-item");
  await expect(item).toHaveCount(1);

  const childChatId = await item.getAttribute("data-child-chat-id");
  expect(childChatId, "the parked item names the child chat it covers").toMatch(
    /^[0-9a-fA-F-]{36}$/,
  );
  const originChatId = new URL(page.url()).pathname.split("/").pop();
  expect(originChatId, "the origin chat is the one we just sent in").toMatch(
    /^[0-9a-fA-F-]{36}$/,
  );

  // The child's own chat, opened while the origin's question is open. Its card
  // is there — the child really is parked, and durably so — but it is not a
  // second place to answer: the origin turn holds the slot the child's result is
  // owed to, and two live cards would let one call be decided twice with only
  // one of the decisions reaching the run that is waiting.
  await gotoAppPage(page, `/chat/${childChatId}`);
  const childCard = page.getByTestId("mcp-tool-approval");
  await expect(childCard).toBeVisible({ timeout: PARK_TIMEOUT_MS });
  await expect(childCard).toHaveAttribute("data-tool-name", GATED_TOOL);

  await childCard
    .getByRole("button", { name: "Allow once", exact: true })
    .click();

  // Where to go instead, as a link to the origin chat — and nothing else. The
  // refusal is not a failure of this card, so the wire envelope must not be
  // printed beside the sentence that explains it.
  const originLink = page.getByTestId("tool-approval-origin-link");
  await expect(originLink).toBeVisible({ timeout: 30000 });
  await expect(originLink).toHaveAttribute(
    "href",
    new RegExp(`${originChatId}$`),
  );
  await expect(page.getByText(/covered_by_parent/)).toHaveCount(0);
  // Refused, not settled: the question is still being asked here, because the
  // refusal lifts by itself and the card has to be answerable when it does.
  await expect(childCard).toBeVisible();

  // Archiving the origin is one of the ways it stops asking, and the only one
  // that leaves the child still parked — settling or withdrawing the stop
  // resumes the child as part of the same act. A parked child is NOT archived
  // with its origin, precisely so that this cannot orphan it.
  const archived = await page.request.post(
    `/api/v1beta/chats/${originChatId}/archive`,
    // The endpoint takes an (empty) JSON body; without one it answers 415.
    { data: {} },
  );
  expect(
    archived.ok(),
    `archiving the origin chat should succeed, got ${archived.status()}`,
  ).toBe(true);

  // Now the child's own card is the only surface left, and it answers.
  await gotoAppPage(page, `/chat/${childChatId}`);
  const reopenedCard = page.getByTestId("mcp-tool-approval");
  await expect(reopenedCard).toBeVisible({ timeout: PARK_TIMEOUT_MS });
  await reopenedCard
    .getByRole("button", { name: "Allow once", exact: true })
    .click();
  await expect(reopenedCard).toHaveCount(0, { timeout: RESUME_TIMEOUT_MS });
  await expect(page.getByTestId("tool-approval-origin-link")).toHaveCount(0);

  // The decision was taken and the call ran: the child answered in its own chat
  // on top of a result it had been blocked on since its origin was archived.
  await expect(page.getByTestId("message-assistant").last()).toContainText(
    GATED_CHILD_ANSWER,
    { timeout: RESUME_TIMEOUT_MS },
  );
  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });
});
