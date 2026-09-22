import { expect, test, type Page } from "@playwright/test";

import { chatIsReadyToChat, gotoAppPage } from "./shared";

/**
 * The `async` round trip: a task whose answer is not the result of the call
 * that started it, and — when the child stops to ask — a second delivery
 * carrying the answer the user unblocked.
 *
 * Every other approvals spec drives an awaited child, whose question lands in a
 * slot on the origin turn and whose answer comes back as that call's result. An
 * `async` child has no such slot. Its question is raised on its OWN card, in a
 * chat nobody is watching, and the origin learns about it only from a delivered
 * `task_result` row. The user then decides in the child chat, which runs a
 * generation that knows nothing about the origin — a different code path from
 * the one that delivered the notification. Nothing carries the real answer back
 * across that gap except the re-arm hook on the child's tail, so a spec that
 * checked only "a result arrived" would pass with the hook deleted: the
 * notification is a result, and it arrives either way. What the hook is worth is
 * the SECOND row, and that is the assertion this file is built around.
 *
 * The two rows are asserted through the API as well as the DOM, because the one
 * field the contract uses to tell them apart is `sequence` and the card does not
 * render it. The card deliberately does not: `sequence` rising means "a second,
 * different result", while the badge it draws means "you have seen this before",
 * which is `redeliveries`. Asserting both of those on the same pair of rows is
 * what says the answer is not mis-announced as a repeat of the question.
 */

/** Keyed by the mock LLM's AsyncPlainParentToolCall rule: one detached task. */
const PLAIN_PROMPT = "detach the plain probe as a background task";

/** Keyed by AsyncParkParentToolCall: one detached task that stops to ask. */
const PARK_PROMPT = "detach the gated probe as a background task";

/** The briefs the two probes carry, which is what the plan card names them by. */
const PLAIN_BRIEF =
  "Async plain child brief: report the probe status without using any tool.";
const PARK_BRIEF =
  "Async gated child brief: publish the approval probe and report what came back.";

/** The facet whose allowlist selects `erato/delegate_task`. */
const PLANNING_FACET = "Plan & delegate";

/** Its configured id, which is what the selected-facet chip is keyed by. */
const PLANNING_FACET_ID = "plan";

/** The child's gated tool, and the server it lives on. */
const GATED_TOOL = "publish_approval_probe";
const GATED_SERVER = "mock_mcp_approval";

/** What the origin says on the turn that launched a detached task. */
const DISPATCH_ANSWER = "ASYNC-DISPATCH-PARENT-ANSWER";

/** What the plain child answers, and so the result it is delivered as. */
const PLAIN_CHILD_ANSWER = "ASYNC-PLAIN-CHILD-ANSWER";

/**
 * What the parked child's answer opens with: its own turn's tool trace, so the
 * decision its call was settled with is readable from the delivered row rather
 * than only from the child's chat. Scripted prose would have claimed the probe
 * was published whatever the user pressed.
 */
const PARK_CHILD_TRACE = "ASYNC-PARK-CHILD-CONTEXT";

/** What the gated call returns when it is allowed, and when it is denied. */
const PROBE_RESULT = "approval probe published";
const DENIAL_TEXT = "The user denied this tool call.";

/** What the origin says to each of the two deliveries it can receive. */
const NOTIFIED_REACTION = "ASYNC-DELIVERY-NOTIFIED";
const ANSWERED_REACTION = "ASYNC-DELIVERY-ANSWERED";

/** Turns the planning turn and the dispatch approval take. */
const PLAN_TIMEOUT_MS = 60000;

/** Turns the detached child, its delivery and the origin's reaction take. */
const DELIVERY_TIMEOUT_MS = 90000;

const TASK_STEP =
  '[data-testid="tool-call-item"][data-tool-name="delegate_task"]';

/**
 * One delivered `task_result` content part, read off the wire.
 *
 * `sequence` and `redeliveries` are the two fields this file turns on and
 * neither is rendered, so the DOM cannot answer the question the re-arm rule is
 * about. `parent_tool_call_id` is here to say the two rows belong to the same
 * dispatch: two rows from two runs would satisfy a count.
 */
interface DeliveredResult {
  status: string;
  sequence: number;
  redeliveries?: number;
  summary: string;
  child_chat_id: string;
  parent_tool_call_id: string;
  reason?: string;
}

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

const originChatIdOf = (page: Page): string => {
  const chatId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(chatId, "the origin chat is the one we just sent in").toMatch(
    /^[0-9a-fA-F-]{36}$/,
  );
  return chatId;
};

/**
 * The `task_result` parts this chat has been delivered, oldest first — the order
 * the transcript reads in, which the endpoint does NOT answer in: it pages from
 * the newest row backwards, so the rows are re-sorted here rather than assumed.
 */
const deliveredResults = async (
  page: Page,
  chatId: string,
): Promise<DeliveredResult[]> => {
  const response = await page.request.get(
    `/api/v1beta/chats/${chatId}/messages`,
  );
  expect(
    response.ok(),
    `reading the origin chat's messages should succeed, got ${response.status()}`,
  ).toBe(true);
  const body = (await response.json()) as {
    messages: { created_at: string; content: { content_type?: string }[] }[];
  };
  return [...body.messages]
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .flatMap(
      (message) =>
        message.content.filter(
          (part) => part.content_type === "task_result",
        ) as unknown as DeliveredResult[],
    );
};

/**
 * Wait until the origin has been delivered exactly `count` results.
 *
 * Polled rather than awaited on the DOM: a delivery is written by whichever
 * request happens to be the next tail on either chat, and the origin page was
 * loaded before any of it happened.
 */
const waitForDeliveries = async (
  page: Page,
  chatId: string,
  count: number,
): Promise<DeliveredResult[]> => {
  await expect
    .poll(async () => (await deliveredResults(page, chatId)).length, {
      message: `the origin chat should hold ${count} delivered task result(s)`,
      timeout: DELIVERY_TIMEOUT_MS,
      intervals: [1000, 1000, 2000, 2000, 3000],
    })
    .toBe(count);
  return deliveredResults(page, chatId);
};

/**
 * Dispatch one detached task and return the origin chat it was started from.
 *
 * The dispatch approval is not incidental: the shipped
 * `[delegation.tasks.approval] mode = "async_only"` asks before every `async`
 * dispatch, so this card is what a deployment offering detached tasks really
 * shows. It is also the only mode that CAN be asking here — this batch holds one
 * task, and `plan` needs `plan_min_tasks` of them — which is the positive half
 * of the A/B `plan-gate.approvals.spec.ts` covers negatively for awaited tasks.
 */
const dispatchDetachedTask = async (
  page: Page,
  prompt: string,
  brief: string,
): Promise<string> => {
  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);
  await selectPlanningFacet(page);
  await sendMessage(page, prompt);
  const originChatId = originChatIdOf(page);

  const approval = page.getByTestId("task-plan-approval");
  await expect(approval).toBeVisible({ timeout: PLAN_TIMEOUT_MS });
  await expect(approval).toHaveAttribute("data-item-count", "1");
  const item = approval.getByTestId("task-plan-approval-item");
  await expect(item).toContainText(brief);
  // What the row says about the run it would start, and the reason this card is
  // here at all: `async_only` asks about a detached dispatch and nothing else.
  await expect(item).toContainText("Answers separately, after this reply");
  // A single row has no bulk allow — a plan of one is decided on the row — so
  // this is the same button the awaited cards are answered with.
  await item.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(approval).toHaveCount(0, { timeout: PLAN_TIMEOUT_MS });

  // The turn that dispatched it, pinned as the FIRST assistant message: every
  // delivery adds a reaction turn behind it, so `.last()` would walk away.
  const dispatchMessage = page.getByTestId("message-assistant").first();
  await expect(dispatchMessage).toContainText(DISPATCH_ANSWER, {
    timeout: DELIVERY_TIMEOUT_MS,
  });

  // The whole of what `async` means, and the one thing that cannot race: the
  // call is finished and its result is the launch, not the answer. An awaited
  // task would have the child's answer inside this very step.
  const step = dispatchMessage.locator(TASK_STEP);
  await expect(step).toHaveCount(1);
  await expect(step).toHaveAttribute("data-tool-status", "success");
  await expect(step).toContainText("Ran a task");
  await expect(step.getByTestId("delegation-brief")).toContainText(brief);

  return originChatId;
};

test("delivers a detached task's answer into the origin chat as one result row", async ({
  page,
}) => {
  // The planning turn, the dispatch approval, the detached child, its delivery
  // and the origin's reaction to it are one test.
  test.setTimeout(240000);

  const originChatId = await dispatchDetachedTask(
    page,
    PLAIN_PROMPT,
    PLAIN_BRIEF,
  );
  const dispatchMessage = page.getByTestId("message-assistant").first();
  // Nothing the child says can ever be inside the dispatching turn, whenever it
  // finishes: that is what the delivered row exists to carry.
  await expect(dispatchMessage).not.toContainText(PLAIN_CHILD_ANSWER);

  // Exactly one row, which is what makes the second row of the parked run below
  // mean something: two deliveries are a property of parking, not of `async`.
  const [delivered] = await waitForDeliveries(page, originChatId, 1);
  expect(delivered.status, "an unhindered detached run completes").toBe(
    "completed",
  );
  expect(delivered.sequence, "its answer is the run's first result").toBe(0);
  expect(
    delivered.redeliveries ?? 0,
    "and it has not been delivered before",
  ).toBe(0);
  expect(delivered.summary).toContain(PLAIN_CHILD_ANSWER);
  expect(delivered.child_chat_id).toMatch(/^[0-9a-fA-F-]{36}$/);
  expect(
    delivered.reason,
    "a run that answered has nothing to explain",
  ).toBeUndefined();

  // The row was loaded into a page that had already rendered, so the transcript
  // is re-read rather than watched.
  await gotoAppPage(page, `/chat/${originChatId}`);
  const card = page.getByTestId("task-result-card");
  await expect(card).toHaveCount(1, { timeout: DELIVERY_TIMEOUT_MS });
  await expect(card).toHaveAttribute("data-task-result-status", "completed");
  await expect(card.getByTestId("task-result-summary")).toContainText(
    PLAIN_CHILD_ANSWER,
  );
  // Nothing is owed and nothing is repeated: no question to answer elsewhere,
  // and no "delivered again" badge on a result nobody has seen yet.
  await expect(card.getByTestId("task-result-input-required")).toHaveCount(0);
  await expect(card.getByTestId("task-result-sequence")).toHaveCount(0);
  // The link to the run it came from, which is how a reader gets at the work.
  await expect(card.getByTestId("task-result-open-run")).toHaveAttribute(
    "href",
    new RegExp(`${delivered.child_chat_id}$`),
  );

  // And the model read it: the origin answered the delivery, in the reaction
  // turn the delivery itself runs, rather than leaving the row unanswered.
  await expect(page.getByTestId("message-assistant").last()).toContainText(
    ANSWERED_REACTION,
    { timeout: DELIVERY_TIMEOUT_MS },
  );
  await expect(page.getByText(NOTIFIED_REACTION)).toHaveCount(0);
});

/**
 * A detached child parked on its gated call, with the origin's notification
 * already delivered. Returns both chats.
 */
const parkDetachedChild = async (
  page: Page,
): Promise<{ originChatId: string; childChatId: string }> => {
  const originChatId = await dispatchDetachedTask(
    page,
    PARK_PROMPT,
    PARK_BRIEF,
  );

  const [notification] = await waitForDeliveries(page, originChatId, 1);
  expect(
    notification.status,
    "a parked detached run reports that it needs a decision",
  ).toBe("input_required");
  expect(
    notification.sequence,
    "the notification is the run's first result",
  ).toBe(0);
  expect(notification.reason).toBe("approval_pending");
  // The notification is a notification: it carries nothing the child has not
  // reported, and the child has reported nothing.
  expect(notification.summary).not.toContain(PARK_CHILD_TRACE);

  await gotoAppPage(page, `/chat/${originChatId}`);
  const card = page.getByTestId("task-result-card");
  await expect(card).toHaveCount(1, { timeout: DELIVERY_TIMEOUT_MS });
  await expect(card).toHaveAttribute(
    "data-task-result-status",
    "input_required",
  );
  await expect(card.getByTestId("task-result-status")).toContainText(
    "Needs your decision",
  );
  await expect(card.getByTestId("task-result-reason")).toContainText(
    "Waiting for your decision on a tool it wants to use",
  );

  // Where to decide, which is the whole content of this delivery. The decision
  // is NOT taken here: a detached run holds no slot on any turn of this chat, so
  // an approval card in the origin would be a second surface for a question
  // only one of them could settle.
  const openRun = card.getByTestId("task-result-input-required-open");
  await expect(card.getByTestId("task-result-input-required")).toContainText(
    "Answer it in the task's own chat:",
  );
  await expect(page.getByTestId("delegated-task-approval")).toHaveCount(0);
  await expect(page.getByTestId("mcp-tool-approval")).toHaveCount(0);
  await expect(openRun).toHaveAttribute(
    "href",
    new RegExp(`${notification.child_chat_id}$`),
  );

  // And the model was told the run has NOT finished, rather than being handed a
  // result it could report as done: the reaction the `input_required` delivery
  // draws is its own, keyed on the status the row carries.
  await expect(page.getByTestId("message-assistant").last()).toContainText(
    NOTIFIED_REACTION,
    { timeout: DELIVERY_TIMEOUT_MS },
  );

  return { originChatId, childChatId: notification.child_chat_id };
};

/**
 * Answer the parked child's own card and let it finish in its own chat.
 *
 * Deciding here is what makes this position's mechanism load-bearing: the
 * generation this click starts runs on the CHILD chat and has no idea an origin
 * is waiting, so unless its tail re-arms the delivery the answer never leaves
 * this conversation.
 */
const decideOnChildCard = async (
  page: Page,
  childChatId: string,
  button: "Allow once" | "Deny once",
) => {
  await gotoAppPage(page, `/chat/${childChatId}`);
  const childCard = page.getByTestId("mcp-tool-approval");
  await expect(childCard).toBeVisible({ timeout: DELIVERY_TIMEOUT_MS });
  await expect(childCard).toHaveAttribute("data-tool-name", GATED_TOOL);
  await expect(childCard).toContainText(GATED_SERVER);

  await childCard.getByRole("button", { name: button, exact: true }).click();

  // Answerable here, unlike an awaited child's card: there is no origin turn
  // holding the slot this run's result is owed to, so nothing defers the
  // decision to another chat.
  await expect(childCard).toHaveCount(0, { timeout: DELIVERY_TIMEOUT_MS });
  await expect(page.getByTestId("tool-approval-origin-link")).toHaveCount(0);

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: DELIVERY_TIMEOUT_MS,
  });
  return page.getByTestId("message-assistant").last();
};

test("delivers a second result carrying the answer once a parked detached child's own card is allowed", async ({
  page,
}) => {
  // Two chats, two deliveries, two reactions and a decision in between.
  test.setTimeout(300000);

  const { originChatId, childChatId } = await parkDetachedChild(page);

  const childAnswer = await decideOnChildCard(page, childChatId, "Allow once");
  // The allowed call ran and the child spoke on top of its result, in its own
  // chat: its answer is its own turn's tool trace, so the probe's own output is
  // in it.
  await expect(childAnswer).toContainText(
    `${PARK_CHILD_TRACE}: ${GATED_TOOL}[`,
  );
  await expect(childAnswer).toContainText(PROBE_RESULT);

  // The assertion the whole file exists for. Two rows, and they are two
  // different results of ONE run rather than one result arriving twice: same
  // child, same dispatching call, `sequence` apart.
  const delivered = await waitForDeliveries(page, originChatId, 2);
  expect(delivered.map((result) => result.sequence)).toEqual([0, 1]);
  expect(delivered.map((result) => result.status)).toEqual([
    "input_required",
    "completed",
  ]);
  expect(new Set(delivered.map((result) => result.child_chat_id))).toEqual(
    new Set([childChatId]),
  );
  expect(
    new Set(delivered.map((result) => result.parent_tool_call_id)).size,
    "both rows settle the same `delegate_task` call",
  ).toBe(1);

  // The answer the user unblocked, in the origin chat, quoting the call it was
  // blocked on. Without the re-arm this row is what would be missing — the
  // notification above would have been the run's last word.
  const answer = delivered[1];
  expect(answer.summary).toContain(`${PARK_CHILD_TRACE}: ${GATED_TOOL}[`);
  expect(answer.summary).toContain(PROBE_RESULT);
  expect(
    answer.reason,
    "a run that was allowed and answered has nothing to explain",
  ).toBeUndefined();
  // A second result, not the first one again. `sequence` says "this is the next
  // one"; `redeliveries` says "you have seen this". Badging the answer as a
  // repeat would tell the reader they had already read what they were waiting
  // for.
  expect(answer.redeliveries ?? 0).toBe(0);

  await gotoAppPage(page, `/chat/${originChatId}`);
  const cards = page.getByTestId("task-result-card");
  await expect(cards).toHaveCount(2, { timeout: DELIVERY_TIMEOUT_MS });
  await expect(cards.nth(0)).toHaveAttribute(
    "data-task-result-status",
    "input_required",
  );
  await expect(cards.nth(1)).toHaveAttribute(
    "data-task-result-status",
    "completed",
  );
  await expect(cards.nth(1).getByTestId("task-result-summary")).toContainText(
    PROBE_RESULT,
  );
  // The question the first row asked is not asked twice, and the answer is not
  // announced as something already seen.
  await expect(
    cards.nth(1).getByTestId("task-result-input-required"),
  ).toHaveCount(0);
  await expect(cards.nth(1).getByTestId("task-result-sequence")).toHaveCount(0);

  // Both deliveries were answered by the model, in the order they arrived: the
  // reaction to the notification is still in the transcript, and the reaction to
  // the answer is the chat's last word.
  await expect(page.getByText(NOTIFIED_REACTION)).toHaveCount(1);
  await expect(page.getByTestId("message-assistant").last()).toContainText(
    ANSWERED_REACTION,
    { timeout: DELIVERY_TIMEOUT_MS },
  );
});

test("delivers a denied detached child's second result, reporting the refusal it finished on", async ({
  page,
}) => {
  test.setTimeout(300000);

  const { originChatId, childChatId } = await parkDetachedChild(page);

  const childAnswer = await decideOnChildCard(page, childChatId, "Deny once");
  // Deny is not kill, here as on the awaited path: the child was told about the
  // refusal and answered on top of it. Its answer is its own tool trace, so a
  // child that had been killed would have nothing here and one that was never
  // told would report the call as having run.
  await expect(childAnswer).toContainText(
    `${PARK_CHILD_TRACE}: ${GATED_TOOL}[`,
  );
  await expect(childAnswer).toContainText(DENIAL_TEXT);
  await expect(childAnswer).not.toContainText(PROBE_RESULT);

  // A denial is an answer, so the re-arm fires on it too — the hook keys on the
  // run reaching a terminal outcome, not on the user having said yes. A run
  // stranded here would leave the origin holding the question for good.
  const delivered = await waitForDeliveries(page, originChatId, 2);
  expect(delivered.map((result) => result.sequence)).toEqual([0, 1]);
  const answer = delivered[1];
  // `completed`, not `failed`: the refusal ended the CALL, and the run went on
  // to finish around it. Reporting it as a failure would invite the origin model
  // to retry work the user has just declined.
  expect(answer.status).toBe("completed");
  expect(
    answer.reason,
    "a denied call is not a reason the run has to explain",
  ).toBeUndefined();
  // And the prose this test is named for: the refusal is what the origin chat
  // was told, quoted from the call it happened to.
  expect(answer.summary).toContain(`${PARK_CHILD_TRACE}: ${GATED_TOOL}[`);
  expect(answer.summary).toContain(DENIAL_TEXT);
  expect(answer.summary).not.toContain(PROBE_RESULT);

  await gotoAppPage(page, `/chat/${originChatId}`);
  const cards = page.getByTestId("task-result-card");
  await expect(cards).toHaveCount(2, { timeout: DELIVERY_TIMEOUT_MS });
  await expect(cards.nth(1)).toHaveAttribute(
    "data-task-result-status",
    "completed",
  );
  await expect(cards.nth(1).getByTestId("task-result-summary")).toContainText(
    DENIAL_TEXT,
  );
  // A completed run is not offered a retry, however unwelcome its answer: only
  // a failure is, and a denial is not one.
  await expect(cards.nth(1).getByTestId("task-result-retry")).toHaveCount(0);
  await expect(page.getByTestId("chat-message-error")).toHaveCount(0);
});
