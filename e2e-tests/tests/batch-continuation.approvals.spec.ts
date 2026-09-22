import { expect, test, type Locator, type Page } from "@playwright/test";

import { chatIsReadyToChat, gotoAppPage } from "./shared";

/**
 * What a decision does to the turn it answers, beyond letting it go on.
 *
 * The single-approval path — one gated call, one card, one allow — is covered by
 * `mock-flows.many-models.spec.ts`. What is not covered from a browser anywhere
 * is what the continuation rebuilds: the calls the parked turn had already made,
 * the calls it had not made yet, and a stop that asks about more than one thing
 * at a time. Those are this file.
 *
 * The context a resumed turn is given cannot be seen in the DOM, so the mock LLM
 * answers these turns with the tool calls and results of the request it was
 * given (`ToolTrace`). The answer in the transcript IS the model's context, which
 * is what makes "the earlier call came back" an assertion rather than a hope.
 */

/**
 * Keyed by the mock LLM's BatchApprovalParkToolCalls rule: three calls in one
 * batch of which only the middle one needs a decision.
 */
const BATCH_PROMPT = "batch approval probe";

/** Keyed by PairedGatedTasksToolCalls: two tasks that both stop to ask. */
const PAIRED_TASKS_PROMPT = "run both gated probes as tasks";

/** The facet whose allowlist selects `erato/delegate_task`. */
const PLANNING_FACET = "Plan & delegate";

/** Its configured id, which is what the selected-facet chip is keyed by. */
const PLANNING_FACET_ID = "plan";

/** The gated tool of the batch, and of both paired children. */
const GATED_TOOL = "publish_approval_probe";

/** The call the batch had already made when it parked. */
const EARLIER_TOOL = "read_approval_fixture";

/** The call the park abandoned, which the decision has to pick back up. */
const PENDING_TOOL = "list_files";

/** What the origin's own answer says once both paired tasks are settled. */
const PAIRED_PARENT_ANSWER = "PAIRED-TASKS-PARENT-ANSWER";

/**
 * The briefs the two paired calls carry, which is what says which slot is which
 * without leaning on the order the answers came back in.
 */
const PAIRED_BRIEF_A = "Paired gated child brief A";
const PAIRED_BRIEF_B = "Paired gated child brief B";

/**
 * What each paired child's answer opens with: its own turn's tool trace, under a
 * marker only that child uses.
 *
 * The pair runs the same brief against the same tool, so a marker shared by both
 * would make their answers identical — and one child's result delivered into
 * both parent calls would read exactly like two children answering.
 */
const CHILD_A_TRACE = "PAIRED-CHILD-A-CONTEXT";
const CHILD_B_TRACE = "PAIRED-CHILD-B-CONTEXT";

/** Each paired slot, with the answer it owes and the one it must not carry. */
const PAIRED_CHILDREN = [
  { brief: PAIRED_BRIEF_A, own: CHILD_A_TRACE, sibling: CHILD_B_TRACE },
  { brief: PAIRED_BRIEF_B, own: CHILD_B_TRACE, sibling: CHILD_A_TRACE },
];

/** What a refused call leaves in the child's context, and so in its answer. */
const DENIAL_TEXT = "The user denied this tool call.";

/** Turns the origin turn, the children and the park take before a decision. */
const PARK_TIMEOUT_MS = 60000;

/** Turns the resumed run and the origin's closing answer take after it. */
const RESUME_TIMEOUT_MS = 90000;

const TASK_STEP =
  '[data-testid="tool-call-item"][data-tool-name="delegate_task"]';

const toolStep = (toolName: string) =>
  `[data-testid="tool-call-item"][data-tool-name="${toolName}"]`;

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

/** The two paired tasks, dispatched and parked on one card of two rows. */
const parkOnBothPairedTasks = async (page: Page): Promise<Locator> => {
  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);
  await selectPlanningFacet(page);
  await sendMessage(page, PAIRED_TASKS_PROMPT);

  const assistantMessage = page.getByTestId("message-assistant").last();
  const approval = assistantMessage.getByTestId("delegated-task-approval");
  await expect(approval).toBeVisible({ timeout: PARK_TIMEOUT_MS });
  // One card for the stop, one row per child that asked. Two rows are the whole
  // point: a stop that covers several decisions is settled in one request, and
  // that is the shape neither the single MCP card nor an integration test drives
  // through a client.
  await expect(approval).toHaveAttribute("data-item-count", "2");
  const items = approval.getByTestId("delegated-task-approval-item");
  await expect(items).toHaveCount(2);
  for (const item of await items.all()) {
    await expect(item).toContainText(GATED_TOOL);
    // The child chat the row covers, matched as an id rather than as "not
    // empty": an attribute that had been dropped altogether would satisfy the
    // latter.
    await expect(item).toHaveAttribute(
      "data-child-chat-id",
      /^[0-9a-fA-F-]{36}$/,
    );
  }
  return assistantMessage;
};

test("resumes an approved batch with the call it had already made back in the model's context, and runs the call the park abandoned", async ({
  page,
}) => {
  // The batch, the park, the decision and the resumed turn are one test; the
  // default budget covers none of it.
  test.setTimeout(240000);

  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);
  await sendMessage(page, BATCH_PROMPT);

  const assistantMessage = page.getByTestId("message-assistant").last();

  const approval = assistantMessage.getByTestId("mcp-tool-approval");
  await expect(approval).toBeVisible({ timeout: PARK_TIMEOUT_MS });
  await expect(approval).toHaveAttribute("data-tool-name", GATED_TOOL);

  // The park is mid-batch, which is what this file is about: the call before the
  // gated one has run and has its step, and the call after it has none, because
  // the park abandoned the rest of the queue.
  //
  // Read as ONE snapshot of the step list rather than as two waits: the two
  // halves are a claim about a single moment, and asserted separately the second
  // could be satisfied by a queue that had simply not got there yet.
  const parkedSteps = await assistantMessage
    .locator('[data-testid="tool-call-item"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-tool-name") ?? ""),
    );
  expect(parkedSteps.filter((name) => name === EARLIER_TOOL)).toHaveLength(1);
  expect(parkedSteps).not.toContain(PENDING_TOOL);

  await approval
    .getByRole("button", { name: "Allow once", exact: true })
    .click();

  // Answered, so gone: the card renders only while the stop is open.
  await expect(approval).toHaveCount(0, { timeout: RESUME_TIMEOUT_MS });

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });

  // Every call of the batch ran, including the one the park had abandoned.
  for (const toolName of [EARLIER_TOOL, GATED_TOOL, PENDING_TOOL]) {
    await expect(assistantMessage.locator(toolStep(toolName))).toHaveCount(1);
  }

  // The answer is the resumed request's own trace, so this is the model's
  // context: the call processed BEFORE the park is in it, with the result it
  // already had, ahead of the call that was decided and the one that followed.
  // A continuation that replayed only the decided call would answer without the
  // first entry — which is the defect this coverage exists for.
  await expect(assistantMessage).toContainText(
    new RegExp(
      // Each call names itself and is followed by what it returned; the result
      // is the MCP envelope the tool replied with, so the text it carries is
      // matched inside it rather than as the whole of it.
      [
        "BATCH-RESUMED-CONTEXT:",
        `${EARLIER_TOOL}\\[`,
        "closed-world approval fixture read",
        `${GATED_TOOL}\\[`,
        "approval probe published",
        `${PENDING_TOOL}\\[`,
      ].join(".*"),
      "s",
    ),
    { timeout: RESUME_TIMEOUT_MS },
  );
});

test("refuses a decision that answers only one of two open items, keeps the card answerable, and settles both once both are answered", async ({
  page,
}) => {
  test.setTimeout(300000);

  const assistantMessage = await parkOnBothPairedTasks(page);
  const approval = assistantMessage.getByTestId("delegated-task-approval");
  const items = approval.getByTestId("delegated-task-approval-item");

  const messageId = await assistantMessage.getAttribute("data-message-id");
  expect(messageId, "the parked assistant message carries its id").toBeTruthy();
  const approvalIds = await items.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-approval-id") ?? ""),
  );
  expect(approvalIds.filter(Boolean)).toHaveLength(2);

  // Through the API, because the card cannot be made to do this: it holds a
  // row's answer until every row has one, precisely because the server refuses
  // anything less. The refusal is what that behaviour rests on, so it is
  // asserted here rather than assumed.
  const partial = await page.request.post(
    "/api/v1beta/me/messages/continuestream",
    {
      data: {
        message_id: messageId,
        decisions: [{ approval_id: approvalIds[0], decision: "approve" }],
      },
    },
  );
  expect(partial.status()).toBe(400);
  const refusal = (await partial.json()) as {
    code?: string;
    missing?: string[];
  };
  expect(refusal.code).toBe("decisions_mismatch");
  expect(refusal.missing).toEqual([approvalIds[1]]);

  // Refused, not half-applied: the same two questions are still being asked and
  // the answer the user is about to give still covers them.
  await expect(approval).toBeVisible();
  await expect(approval).toHaveAttribute("data-item-count", "2");
  await expect(items).toHaveCount(2);

  // The first row's answer is held rather than sent, and says so.
  await items
    .first()
    .getByRole("button", { name: "Allow once", exact: true })
    .click();
  await expect(items.first()).toContainText(
    "Allowed — sent once every item is decided",
  );
  await expect(approval).toBeVisible();

  // The second answer completes the set, so now it goes.
  await items
    .last()
    .getByRole("button", { name: "Allow once", exact: true })
    .click();
  await expect(approval).toHaveCount(0, { timeout: RESUME_TIMEOUT_MS });

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });

  // Both children resumed, each made the call it had stopped on, and each
  // answer came back into the parent call that asked for it.
  const steps = assistantMessage.locator(TASK_STEP);
  await expect(steps).toHaveCount(2);
  for (const [index, child] of PAIRED_CHILDREN.entries()) {
    const step = steps.nth(index);
    // Which slot this is, taken from the brief the parent dispatched it with
    // rather than from the answer it came back with, or the claim would be
    // circular.
    await expect(step.getByTestId("delegation-brief")).toContainText(
      child.brief,
    );
    // The child's answer is its own tool trace, so the allowed call and the
    // result it returned are both in the answer this chat received. Asserted as
    // two substrings because the result is the MCP envelope the tool replied
    // with, not the bare text inside it.
    await expect(step).toContainText(`${child.own}: ${GATED_TOOL}[`, {
      timeout: RESUME_TIMEOUT_MS,
    });
    await expect(step).toContainText("approval probe published");
    // And its sibling's answer is NOT here: one result delivered into both
    // calls is otherwise indistinguishable from two children answering.
    await expect(step).not.toContainText(child.sibling);
    await expect(step.getByTestId("delegation-reason")).toHaveCount(0);
  }
  await expect(assistantMessage).toContainText(PAIRED_PARENT_ANSWER);
});

test("withdrawing denies both open items and the turn still finishes in prose", async ({
  page,
}) => {
  test.setTimeout(300000);

  const assistantMessage = await parkOnBothPairedTasks(page);
  const approval = assistantMessage.getByTestId("delegated-task-approval");

  // Withdraw is a decision, not a cancellation, and the card says so.
  const bulk = approval.getByTestId("delegated-task-approval-bulk");
  await expect(bulk).toContainText(
    "Withdrawing denies everything still open; the assistant answers with what it has.",
  );
  await bulk.getByTestId("tool-approval-withdraw").click();

  await expect(approval).toHaveCount(0, { timeout: RESUME_TIMEOUT_MS });

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });

  // Every open item was refused — BOTH children saw the denial in the context of
  // the turn that followed it, which is what their answer repeats. Read per
  // child, because a single refused child whose answer was delivered into both
  // slots would satisfy a count of two denials.
  const steps = assistantMessage.locator(TASK_STEP);
  await expect(steps).toHaveCount(2);
  for (const [index, child] of PAIRED_CHILDREN.entries()) {
    const step = steps.nth(index);
    await expect(step.getByTestId("delegation-brief")).toContainText(
      child.brief,
    );
    await expect(step).toContainText(child.own, {
      timeout: RESUME_TIMEOUT_MS,
    });
    await expect(step).toContainText(DENIAL_TEXT);
    await expect(step).not.toContainText(child.sibling);
  }

  // And the turn finished anyway: a denial ends the call, not the run, so the
  // origin model answered on top of two refused children.
  await expect(assistantMessage).toContainText(PAIRED_PARENT_ANSWER);
  await expect(page.getByTestId("chat-message-error")).toHaveCount(0);
});
