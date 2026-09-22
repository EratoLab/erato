import { expect, test, type Page } from "@playwright/test";

import { chatIsReadyToChat, gotoAppPage } from "./shared";

/**
 * A batch wider than `max_parallel`: what happens to the calls that cannot start
 * yet.
 *
 * The contract is that they QUEUE rather than being refused — a slot is reserved
 * in call order, it is already visible in the conversation as waiting, and it
 * launches once a slot frees. None of that is visible to an integration test
 * through a client: the queued slot is a tool part whose `output` is
 * `{"status":"queued"}`, and what the reader gets from it is a step that says
 * "Task queued" with no run to open.
 *
 * Whether the cap refuses or defers is also the one thing the DOM alone cannot
 * settle — a refused call and a queued one both leave a slot on the turn — so
 * the number of child chats the origin has actually spawned is read from the
 * server on both sides of the wait. That count is the assertion the file turns
 * on: 1 while two calls are queued, 3 once the queue has drained.
 *
 * The cap comes from a facet of its own (`plan_serial`, `max_parallel = 1`)
 * rather than from the scenario, because `max_parallel` is per-deployment config
 * and every other approvals spec depends on the shipped value. A facet may only
 * NARROW it, which is exactly the shape this needs: nothing else about the turn
 * changes, so a queued slot can only be explained by the cap.
 *
 * What holds the one slot open is a child that is simply still working, not one
 * parked on an approval: parking FREES the run's slot, so a gated first task
 * would let the queue drain while its card was still on screen. The slow child's
 * answer is held back for long enough that the queued state is a state the test
 * can stand in rather than a moment it has to catch.
 */

/**
 * Keyed by the mock LLM's QueuedTasksToolCalls rule: three awaited tasks, the
 * slow one first.
 */
const QUEUED_TASKS_PROMPT = "plan a slow probe and two quick ones";

/** The facet narrowing `max_parallel` to 1, and its configured id. */
const SERIAL_FACET = "Plan & queue";
const SERIAL_FACET_ID = "plan_serial";

/** The three briefs, which is what says which slot is which. */
const SLOW_BRIEF = "Queued batch slow brief";
const QUICK_BRIEF_A = "Queued batch quick brief A";
const QUICK_BRIEF_B = "Queued batch quick brief B";

/** Each child's answer, so a settled slot is known by whose answer it holds. */
const SLOW_ANSWER = "QUEUED-SLOW-CHILD-ANSWER";
const QUICK_ANSWER_A = "QUEUED-QUICK-CHILD-A-ANSWER";
const QUICK_ANSWER_B = "QUEUED-QUICK-CHILD-B-ANSWER";

/** What the origin says once every slot of the batch is settled. */
const PARENT_ANSWER = "QUEUED-TASKS-PARENT-ANSWER";

/**
 * How a refused task call reads, which is what a queued one must NOT read as.
 * The total budget (`max_tasks_per_turn`) is the key that DOES refuse, and this
 * is the sentence it refuses with.
 */
const TASK_BUDGET_REFUSAL = "the most allowed";

/** Turns the origin turn and the first dispatch take. */
const DISPATCH_TIMEOUT_MS = 60000;

/**
 * Turns the queue take to drain. Generous on purpose: the slow child holds its
 * slot for a fixed 15s by design, and the two queued runs only start after it.
 */
const DRAIN_TIMEOUT_MS = 120000;

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
  await page.getByRole("menuitem", { name: SERIAL_FACET, exact: true }).click();
  await expect(
    page.getByTestId(`selected-facet-${SERIAL_FACET_ID}`),
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

/**
 * The child chats this origin has spawned, read from the server rather than from
 * the transcript.
 *
 * A delegated run is hidden from the listing unless asked for, so both flags are
 * needed. This is what tells a queued call from a refused one and from a
 * launched one: all three leave a slot on the turn, and only the absence of a
 * child chat says the call has not run.
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

test("queues the tasks beyond max_parallel as visibly waiting slots with no runs behind them, and starts each one as a slot frees", async ({
  page,
}) => {
  // One origin turn, three children run strictly one at a time behind a 15s
  // first run, and the origin's closing answer comes after all of them.
  test.setTimeout(300000);

  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);
  await selectPlanningFacet(page);
  await sendMessage(page, QUEUED_TASKS_PROMPT);

  const assistantMessage = page.getByTestId("message-assistant").last();
  const originChatId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(originChatId, "the origin chat is the one we just sent in").toMatch(
    /^[0-9a-fA-F-]{36}$/,
  );

  const steps = assistantMessage.locator(TASK_STEP);
  // Every call of the batch got a slot, reserved whether or not it could start:
  // the cap defers a call, it does not drop it. A batch that had refused the
  // excess would still show three steps, which is why the count is the start of
  // the claim rather than the whole of it.
  await expect(steps).toHaveCount(3, { timeout: DISPATCH_TIMEOUT_MS });

  // Read as ONE snapshot: "one running, two waiting" is a claim about a single
  // moment, and asserted as three separate waits it could be satisfied by a
  // queue that had simply not got there yet. Which slot is which comes off the
  // briefs rather than off the order, or the claim about the order would be
  // circular.
  const queuedSnapshot = await steps.evaluateAll((nodes) =>
    nodes.map((node) => node.textContent ?? ""),
  );
  expect(queuedSnapshot).toHaveLength(3);
  // Slot 0 is the slow child, dispatched first and holding the only slot the cap
  // allows. It is running, not waiting.
  expect(queuedSnapshot[0]).toContain(SLOW_BRIEF);
  expect(queuedSnapshot[0]).toContain("Running a task");
  expect(queuedSnapshot[0]).not.toContain("Task queued");
  // Slots 1 and 2 are waiting, in as many words and in both places the reader
  // looks: the step says what it is instead of running, and the pill says why.
  for (const [index, brief] of [
    [1, QUICK_BRIEF_A],
    [2, QUICK_BRIEF_B],
  ] as const) {
    expect(queuedSnapshot[index]).toContain(brief);
    expect(queuedSnapshot[index]).toContain("Task queued");
    expect(queuedSnapshot[index]).toContain("Queued");
    // Neither has run: these children answer the instant they are asked, so an
    // answer here would mean the cap let them start.
    expect(queuedSnapshot[index]).not.toContain(QUICK_ANSWER_A);
    expect(queuedSnapshot[index]).not.toContain(QUICK_ANSWER_B);
    // And neither is a refusal wearing a waiting label. A batch that had turned
    // the excess away would have put the budget refusal in these slots.
    expect(queuedSnapshot[index]).not.toContain(TASK_BUDGET_REFUSAL);
  }

  // Nothing to open on a queued slot, because nothing was started: the envelope
  // of a queued slot carries no child id at all, so the link cannot be drawn.
  // This is the same claim the listing below makes, made from the slot itself.
  await expect(steps.nth(1).getByTestId("delegation-open-run")).toHaveCount(0);
  await expect(steps.nth(2).getByTestId("delegation-open-run")).toHaveCount(0);
  // The slot that IS running has one, which is what says the two counts above
  // are about the queue and not about the link never being rendered.
  await expect(steps.nth(0).getByTestId("delegation-open-run")).toHaveCount(1);
  // Waiting for a slot is not a failure, and nothing must say it is.
  await expect(page.getByTestId("chat-message-error")).toHaveCount(0);

  // The claim in full, and the half no DOM can make: one child chat exists, for
  // the one task the cap let start. Without the cap this reads 3.
  expect(
    await childRunCount(page, originChatId),
    "a queued task has no run behind it",
  ).toBe(1);

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: DRAIN_TIMEOUT_MS,
  });

  // The queue drained, which is the other half of "queued rather than refused":
  // a refusal would have been final. Each answer landed in the slot that was
  // reserved for it — found by its own brief, so the pairing is asserted rather
  // than assumed from the order the runs happened to finish in.
  await expect(steps).toHaveCount(3);
  for (const [brief, answer] of [
    [SLOW_BRIEF, SLOW_ANSWER],
    [QUICK_BRIEF_A, QUICK_ANSWER_A],
    [QUICK_BRIEF_B, QUICK_ANSWER_B],
  ] as const) {
    const step = steps.filter({ hasText: brief });
    await expect(step).toHaveCount(1);
    await expect(step).toContainText(answer, { timeout: DRAIN_TIMEOUT_MS });
    // No waiting label survives a run that has answered, and every slot has a
    // run to open now.
    await expect(step).not.toContainText("Task queued");
    await expect(step.getByTestId("delegation-open-run")).toHaveCount(1);
  }

  // Three children from a batch of three: the cap bounded WHEN they ran, not how
  // many of them did.
  expect(
    await childRunCount(page, originChatId),
    "every queued task runs once a slot frees",
  ).toBe(3);

  await expect(assistantMessage).toContainText(PARENT_ANSWER, {
    timeout: DRAIN_TIMEOUT_MS,
  });
});
