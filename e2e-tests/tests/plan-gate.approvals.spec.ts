import { expect, test, type Locator, type Page } from "@playwright/test";

import { chatIsReadyToChat, gotoAppPage } from "./shared";

/**
 * The dispatch-approval policy: whether a plan the model wrote is dispatched or
 * asked about, and what a per-task decision does to it.
 *
 * Every other approvals spec drives a question a CHILD raised, which means a
 * child already existed. This one is about the window before that: under `plan`
 * the batch is asked about before anything is created, so the assertion that
 * carries the file is the absence of child rows — a card on screen proves only
 * that something was drawn, while `origin_chat_id=<origin>` returning nothing
 * proves no task was launched behind it.
 *
 * All four tests send the SAME prompt and therefore the same batch. The only
 * thing that differs is which planning facet is selected, and the two facets
 * differ only in `[facets.facets.<id>.delegation.approval]`. That is what makes
 * the pair an A/B of the policy: a second prompt per policy would have left the
 * prompt as an explanation for the different outcome.
 */

/** Keyed by the mock LLM's PlannedTasksToolCalls rule: two awaited tasks. */
const PLANNED_TASKS_PROMPT = "plan two probe tasks";

/**
 * The facet carrying `mode = "plan"`. With `plan_min_tasks` at its default of 2,
 * the batch above is exactly at the threshold.
 */
const GATED_PLANNING_FACET = "Plan & confirm";
const GATED_PLANNING_FACET_ID = "plan_gate";

/**
 * The facet that overrides nothing, so the turn runs under the shipped global
 * default `mode = "async_only"`.
 */
const DEFAULT_PLANNING_FACET = "Plan & delegate";
const DEFAULT_PLANNING_FACET_ID = "plan";

/** The briefs the two planned calls carry, which is what tells the rows apart. */
const BRIEF_A = "Planned child brief A: report on the first planned step.";
const BRIEF_B = "Planned child brief B: report on the second planned step.";

/** Each planned child's answer, and so the result its slot settles with. */
const CHILD_ANSWER_A = "PLANNED-CHILD-A-ANSWER";
const CHILD_ANSWER_B = "PLANNED-CHILD-B-ANSWER";

/** What the origin's own answer opens with: the settled batch's tool trace. */
const PARENT_TRACE = "PLANNED-TASKS-CONTEXT";

/** What a declined task is reported to the model as. */
const PLAN_DENIAL_TEXT = "The user declined this task.";

/** Turns the origin's planning turn and the park take. */
const PARK_TIMEOUT_MS = 60000;

/** Turns the dispatched children and the origin's closing answer take. */
const RESUME_TIMEOUT_MS = 90000;

const TASK_STEP =
  '[data-testid="tool-call-item"][data-tool-name="delegate_task"]';

/**
 * Text that can only be in the origin's own answer, because the answer is the
 * last part of the message and every trace step is rendered before it.
 *
 * The steps carry the same refusal in their output, so an unordered match would
 * be satisfied by the transcript alone. Anchored on the answer's own prefix, a
 * match says the model was given this and said it back.
 */
const inParentAnswer = (...needles: string[]) =>
  new RegExp(
    [`${PARENT_TRACE}:`, ...needles].join(".*"),
    // `s` so `.` crosses the newlines between rendered blocks.
    "s",
  );

/**
 * Selects a planning facet, which is what offers the tool: enabling the feature
 * is deliberately not enough on its own. Facets are rows of the composer's
 * "Tools" dropdown, so the menu has to be opened before the row exists.
 */
const selectPlanningFacet = async (page: Page, name: string, id: string) => {
  const trigger = page.locator(
    'button[aria-controls="facet-selector-dropdown"]',
  );
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click();
  await page.getByRole("menuitem", { name, exact: true }).click();
  await expect(page.getByTestId(`selected-facet-${id}`)).toBeVisible();
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

const originChatIdOf = (page: Page): string => {
  const chatId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(chatId, "the origin chat is the one we just sent in").toMatch(
    /^[0-9a-fA-F-]{36}$/,
  );
  return chatId;
};

/**
 * The child chats this origin has spawned, read from the server rather than from
 * the transcript.
 *
 * A delegated run is hidden from the listing unless asked for, so both flags are
 * needed; the count is the only thing that can distinguish a gate that asked
 * before dispatching from one that asked after. The DOM cannot answer it — a
 * turn that had launched two children and then drawn a card would look the same.
 */
const childRunCount = async (page: Page, originChatId: string) => {
  const response = await page.request.get(
    `/api/v1beta/me/recent_chats?include_delegated=true&origin_chat_id=${originChatId}`,
  );
  expect(
    response.ok(),
    `listing the origin's delegated runs should succeed, got ${response.status()}`,
  ).toBe(true);
  const listing = (await response.json()) as { chats: unknown[] };
  return listing.chats.length;
};

/** A fresh chat parked on the two-task plan, under the `plan` policy. */
const parkOnPlannedBatch = async (
  page: Page,
): Promise<{
  assistantMessage: Locator;
  approval: Locator;
  items: Locator;
  originChatId: string;
}> => {
  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);
  await selectPlanningFacet(
    page,
    GATED_PLANNING_FACET,
    GATED_PLANNING_FACET_ID,
  );
  await sendMessage(page, PLANNED_TASKS_PROMPT);

  const assistantMessage = page.getByTestId("message-assistant").last();
  const approval = assistantMessage.getByTestId("task-plan-approval");
  await expect(approval).toBeVisible({ timeout: PARK_TIMEOUT_MS });
  await expect(approval).toHaveAttribute("data-approval-kind", "task_plan");
  // One card for the batch, one row per planned task: a plan can be pruned, so
  // the card has to ask per task rather than about the batch as a whole.
  await expect(approval).toHaveAttribute("data-item-count", "2");
  const items = approval.getByTestId("task-plan-approval-item");
  await expect(items).toHaveCount(2);
  // In the order the model asked for them, named by the brief it wrote — the
  // only thing that identifies a task, which has no assistant name of its own.
  await expect(items.nth(0)).toContainText(BRIEF_A);
  await expect(items.nth(1)).toContainText(BRIEF_B);

  return {
    assistantMessage,
    approval,
    items,
    originChatId: originChatIdOf(page),
  };
};

test("parks a planned batch before any child chat exists, and dispatches both tasks once the plan is allowed", async ({
  page,
}) => {
  // The planning turn, the park, the decision, two children and the origin's
  // closing answer are one test; the default budget covers none of it.
  test.setTimeout(240000);

  const { assistantMessage, approval, originChatId } =
    await parkOnPlannedBatch(page);

  // The claim of the whole gate, and the one thing a card cannot make true: at
  // the moment the question is asked nothing has been created. A gate inside the
  // dispatch loop would already have launched the first task and would be asking
  // about the second, and this listing would name it.
  expect(
    await childRunCount(page, originChatId),
    "a parked plan must have created no child chat at all",
  ).toBe(0);
  // Not even a placeholder: nothing was validated, reserved or announced, so the
  // turn has no task slots yet either.
  await expect(assistantMessage.locator(TASK_STEP)).toHaveCount(0);

  // A plan has no standing answer in v1: what may be dispatched unasked is the
  // deployment's `[delegation.tasks.approval]` to say, not a per-user setting's,
  // so the card must not offer one.
  await expect(
    approval.getByRole("button", { name: "Always allow" }),
  ).toHaveCount(0);

  await approval.getByTestId("tool-approval-allow-all").click();

  // Answered, so gone: the card renders only while the stop is open.
  await expect(approval).toHaveCount(0, { timeout: RESUME_TIMEOUT_MS });

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });

  // Both tasks were dispatched in the order the model asked for them, and each
  // slot settled with its own child's answer.
  const steps = assistantMessage.locator(TASK_STEP);
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(0)).toContainText(CHILD_ANSWER_A, {
    timeout: RESUME_TIMEOUT_MS,
  });
  await expect(steps.nth(1)).toContainText(CHILD_ANSWER_B, {
    timeout: RESUME_TIMEOUT_MS,
  });

  // And the children the approval bought really exist now, which is what makes
  // the zero above a gate rather than a listing that never reports anything.
  expect(
    await childRunCount(page, originChatId),
    "an allowed plan dispatches one child per approved task",
  ).toBe(2);

  await expect(assistantMessage).toContainText(PARENT_TRACE, {
    timeout: RESUME_TIMEOUT_MS,
  });
});

test("dispatches only the approved task of a plan and hands the model a refusal for the declined one", async ({
  page,
}) => {
  test.setTimeout(300000);

  const { assistantMessage, approval, items, originChatId } =
    await parkOnPlannedBatch(page);

  const rowFor = (brief: string) => items.filter({ hasText: brief });

  // Declined first, so the held-answer path is the one under test: the server
  // refuses a body that does not cover the open set, so a row's answer is kept
  // until the last row has one.
  await rowFor(BRIEF_B)
    .getByRole("button", { name: "Deny once", exact: true })
    .click();
  await expect(rowFor(BRIEF_B)).toContainText(
    "Denied — sent once every item is decided",
  );
  await expect(approval).toBeVisible();
  expect(
    await childRunCount(page, originChatId),
    "a held answer dispatches nothing; the request has not gone yet",
  ).toBe(0);

  await rowFor(BRIEF_A)
    .getByRole("button", { name: "Allow once", exact: true })
    .click();
  await expect(approval).toHaveCount(0, { timeout: RESUME_TIMEOUT_MS });

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });

  // Exactly one child, for exactly the task that was allowed. The declined task
  // is where the plan gate pays for itself: no chat, no run, nothing to clean up.
  expect(
    await childRunCount(page, originChatId),
    "only the approved task may be dispatched",
  ).toBe(1);
  await expect(assistantMessage).toContainText(CHILD_ANSWER_A, {
    timeout: RESUME_TIMEOUT_MS,
  });
  await expect(assistantMessage).not.toContainText(CHILD_ANSWER_B);

  // Both slots settled: the approved one with its child's answer, the declined
  // one with a refusal in its place.
  await expect(assistantMessage.locator(TASK_STEP)).toHaveCount(2);

  // And the refusal is something the MODEL read, not just something the
  // transcript shows: the origin's answer is the request's own tool trace, so a
  // refusal quoted after the trace's prefix was in the context it answered from.
  await expect(assistantMessage).toContainText(
    inParentAnswer(PLAN_DENIAL_TEXT),
    { timeout: RESUME_TIMEOUT_MS },
  );
});

test("withdrawing a plan declines every task in it and the turn still finishes in prose", async ({
  page,
}) => {
  test.setTimeout(240000);

  const { assistantMessage, approval, originChatId } =
    await parkOnPlannedBatch(page);

  // Withdraw is a decision, not a cancellation, and the card has to say so — it
  // denies everything still open and the turn then answers around the denials.
  const bulk = approval.getByTestId("task-plan-approval-bulk");
  await expect(bulk).toContainText(
    "Withdrawing denies everything still open; the assistant answers with what it has.",
  );
  await bulk.getByTestId("tool-approval-withdraw").click();

  await expect(approval).toHaveCount(0, { timeout: RESUME_TIMEOUT_MS });

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });

  // Every item was denied, which for a plan means nothing ran: a withdrawal on
  // this card cannot leave a half-dispatched batch behind.
  expect(
    await childRunCount(page, originChatId),
    "a withdrawn plan dispatches nothing",
  ).toBe(0);
  await expect(assistantMessage).not.toContainText(CHILD_ANSWER_A);
  await expect(assistantMessage).not.toContainText(CHILD_ANSWER_B);

  // Both slots are settled rather than abandoned, and BOTH refusals reached the
  // model: the origin's answer quotes the trace of a request carrying two of
  // them, which is what "denies every open item" means from the model's side.
  await expect(assistantMessage.locator(TASK_STEP)).toHaveCount(2);
  await expect(assistantMessage).toContainText(
    inParentAnswer(PLAN_DENIAL_TEXT, PLAN_DENIAL_TEXT),
    { timeout: RESUME_TIMEOUT_MS },
  );

  // And the turn finished: withdrawing denies the calls, not the run.
  await expect(page.getByTestId("chat-message-error")).toHaveCount(0);
});

test("dispatches the same planned batch unasked under the shipped async_only default", async ({
  page,
}) => {
  test.setTimeout(240000);

  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);
  await selectPlanningFacet(
    page,
    DEFAULT_PLANNING_FACET,
    DEFAULT_PLANNING_FACET_ID,
  );
  await sendMessage(page, PLANNED_TASKS_PROMPT);

  const assistantMessage = page.getByTestId("message-assistant").last();
  const originChatId = originChatIdOf(page);

  // The same two calls the `plan` policy stops on, under a facet that overrides
  // nothing: both tasks are awaited, `async_only` has nothing detached to ask
  // about, and the turn runs to its answer without a decision being available at
  // any point. Waiting for the answer IS the assertion — a gated turn would park
  // here and never produce one.
  await expect(assistantMessage).toContainText(PARENT_TRACE, {
    timeout: RESUME_TIMEOUT_MS,
  });
  await expect(assistantMessage.getByTestId("task-plan-approval")).toHaveCount(
    0,
  );

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RESUME_TIMEOUT_MS,
  });

  const steps = assistantMessage.locator(TASK_STEP);
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(0)).toContainText(CHILD_ANSWER_A);
  await expect(steps.nth(1)).toContainText(CHILD_ANSWER_B);
  expect(
    await childRunCount(page, originChatId),
    "the default policy dispatches both planned tasks",
  ).toBe(2);
  await expect(assistantMessage).not.toContainText(PLAN_DENIAL_TEXT);
});
