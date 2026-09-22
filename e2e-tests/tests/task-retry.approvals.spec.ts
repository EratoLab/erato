import { expect, test, type Page } from "@playwright/test";

import { chatIsReadyToChat, gotoAppPage } from "./shared";

/**
 * Retrying a failed detached task from the chat that dispatched it.
 *
 * The contract has two halves, and only one of them is about the new run. A
 * retry dispatches a FRESH child carrying the same brief; the failed run's own
 * record is never rewritten, because it is the only account of what went wrong
 * and the retry is a second attempt, not an edit of the first. The link between
 * them lives on the replacement (`retry_of`), which is also what stops the offer
 * coming back on a reload and turning one failure into a retry storm.
 *
 * Every bit of that needs a browser. The affordance is rendered from the
 * delivered result's status — only `failed` offers it, and a completed run
 * deliberately does not, however unwelcome its answer — and the "never twice"
 * guarantee is a property of what the client reads back off the listing, not of
 * the endpoint, which says so itself by refusing a second attempt rather than
 * trusting the client not to make one. The refusal is asserted too, from the
 * page's own session: it is the server's half of the same invariant.
 *
 * The failure is an infrastructure failure, which is the only kind that reports
 * `failed`: the mock refuses the child's provider call outright. A refusal the
 * child could speak on top of would finish the run `completed`, and a timeout
 * would finish it `cancelled` — neither offers a retry, by design.
 */

/**
 * Keyed by the mock LLM's FailingTaskParentToolCall rule: one detached task
 * whose child's provider call is refused, so the run reports `failed`.
 */
const FAILING_PROMPT = "detach the doomed probe as a background task";

/**
 * Keyed by AsyncPlainParentToolCall: one detached task that answers cleanly.
 * Its delivered result is the control — a `completed` run must offer nothing.
 */
const PLAIN_PROMPT = "detach the plain probe as a background task";

/** The facet whose allowlist selects `erato/delegate_task`. */
const PLANNING_FACET = "Plan & delegate";

/** Its configured id, which is what the selected-facet chip is keyed by. */
const PLANNING_FACET_ID = "plan";

/** The brief the doomed task carries, and so the brief its retry must carry. */
const FAILING_BRIEF =
  "Doomed child brief: the provider breaks on every turn of this run.";

/** What the origin says on the turn that launched a detached task. */
const DISPATCH_ANSWER = "ASYNC-DISPATCH-PARENT-ANSWER";

/** What the origin says when a delivery tells it the run broke. */
const FAILED_REACTION = "ASYNC-DELIVERY-FAILED";

/** Turns the origin's dispatch turn and its approval take. */
const DISPATCH_TIMEOUT_MS = 60000;

/** Turns the detached child, its delivery and the origin's reaction take. */
const DELIVERY_TIMEOUT_MS = 90000;

/** One row of the origin's delegated-runs listing, as this file reads it. */
interface ListedRun {
  id: string;
  retry_of?: string;
  delegated_run_outcome?: string;
  provenance_run_mode?: string;
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
  return new URL(page.url()).pathname.split("/").pop() ?? "";
};

/**
 * The delegated runs this origin has spawned, read from the server.
 *
 * A delegated run is hidden from the listing unless asked for, so both flags are
 * needed. `retry_of` is on the wire for exactly the reason this file reads it: a
 * client has to be able to tell a run that has already been replaced from one
 * that has not, durably, across a reload.
 */
const listedRuns = async (
  page: Page,
  originChatId: string,
): Promise<ListedRun[]> => {
  const response = await page.request.get(
    `/api/v1beta/me/recent_chats?include_delegated=true&origin_chat_id=${originChatId}`,
  );
  expect(
    response.ok(),
    `listing the origin's delegated runs should succeed, got ${response.status()}`,
  ).toBe(true);
  const listing = (await response.json()) as { chats: ListedRun[] };
  return listing.chats;
};

/**
 * Dispatch one detached task and wait for its result to be delivered into the
 * origin chat.
 *
 * The dispatch approval is `async_only` asking about the one thing it asks
 * about, and it is answered rather than asserted: `async-park.approvals.spec.ts`
 * is where that card is the subject.
 */
const dispatchDetachedTask = async (
  page: Page,
  prompt: string,
): Promise<string> => {
  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);
  await selectPlanningFacet(page);
  const originChatId = await sendMessage(page, prompt);
  expect(originChatId, "the origin chat is the one we just sent in").toMatch(
    /^[0-9a-fA-F-]{36}$/,
  );

  const approval = page.getByTestId("task-plan-approval");
  await expect(approval).toBeVisible({ timeout: DISPATCH_TIMEOUT_MS });
  await approval
    .getByTestId("task-plan-approval-item")
    .getByRole("button", { name: "Allow once", exact: true })
    .click();
  await expect(approval).toHaveCount(0, { timeout: DISPATCH_TIMEOUT_MS });

  await expect(page.getByTestId("message-assistant").first()).toContainText(
    DISPATCH_ANSWER,
    { timeout: DELIVERY_TIMEOUT_MS },
  );
  return originChatId;
};

test("retries a failed detached task as a new run carrying the same brief, leaves the failure on the record, and refuses a second retry while the first is live", async ({
  page,
}) => {
  // A dispatch, a child that breaks, its delivery, the retry, the replacement's
  // own delivery and a refused second attempt are one test.
  test.setTimeout(300000);

  const originChatId = await dispatchDetachedTask(page, FAILING_PROMPT);

  // The run broke and the origin was told so. Asserted from the card's own
  // status, because that status is what decides whether a retry is offered at
  // all: a `cancelled` timeout or a `completed` run with a bad answer offers
  // nothing here.
  await gotoAppPage(page, `/chat/${originChatId}`);
  const card = page.getByTestId("task-result-card");
  await expect(card).toHaveCount(1, { timeout: DELIVERY_TIMEOUT_MS });
  await expect(card).toHaveAttribute("data-task-result-status", "failed");
  await expect(card.getByTestId("task-result-status")).toContainText("Failed");
  // And the model read the failure rather than being handed something it could
  // report as done.
  await expect(page.getByTestId("message-assistant").last()).toContainText(
    FAILED_REACTION,
    { timeout: DELIVERY_TIMEOUT_MS },
  );
  // Idle before the retry: the route reads the origin's generation lease and
  // answers a held one with `generation_running`, which would take the place of
  // the refusal this test is about. No `expectAssistantResponse` — this chat
  // already holds two assistant rows, and that option asserts a single one.
  await chatIsReadyToChat(page, { loadingTimeoutMs: DELIVERY_TIMEOUT_MS });

  // One run, failed, with nothing standing in for it yet. This is the "before"
  // half of every claim below.
  const before = await listedRuns(page, originChatId);
  expect(before).toHaveLength(1);
  const failedRun = before[0];
  expect(failedRun.delegated_run_outcome).toBe("failed");
  expect(failedRun.provenance_run_mode).toBe("async");
  expect(
    failedRun.retry_of,
    "the run that failed is nobody's replacement",
  ).toBeUndefined();

  const retry = card.getByTestId("task-result-retry");
  await expect(retry).toBeVisible();
  // The copy has to state the retry's shape and not just offer it: this slot was
  // frozen at dispatch, so the answer arrives as a result of its own.
  await expect(retry).toContainText(
    "The retry runs as a background task; its answer arrives as its own result, not in this card.",
  );
  await expect(card.getByTestId("task-result-retry-refused")).toHaveCount(0);

  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/delegated_runs/${failedRun.id}/retry`),
    { timeout: DELIVERY_TIMEOUT_MS },
  );
  await card.getByTestId("task-result-retry-action").click();
  const accepted = await retryResponse;
  expect(
    accepted.status(),
    "a retry is accepted for later, not answered inline",
  ).toBe(202);

  // One live retry per failure, asserted from this page's own session while the
  // replacement is certainly still working — the doomed brief takes several
  // seconds to break, and the retry carries that same brief, so this window is a
  // window rather than a race. This is the server's half of the invariant the
  // client's `retry_of` reading serves: a client that offered the button twice
  // still cannot turn one failure into a storm.
  const refused = await page.request.post(
    `/api/v1beta/me/chats/${originChatId}/delegated_runs/${failedRun.id}/retry`,
    { data: { kind: "task" } },
  );
  expect(
    refused.status(),
    "a second retry is refused while the first is in flight",
  ).toBe(409);
  const refusal = (await refused.json()) as { code?: string; state?: string };
  // `not_retryable`, not the generic lease conflict: the route answers 409 in
  // three different shapes and the client discriminates on `code`, so a refusal
  // that said `generation_running` would be about the origin chat rather than
  // about this run.
  expect(refusal.code).toBe("not_retryable");
  expect(refusal.state).toBe("retry_in_flight");

  // The offer is gone and a statement of fact has taken its place. Read off the
  // listing's `retry_of` once it catches up, which is the whole reason the field
  // is on the wire: remembering the dispatch in component state instead would
  // put the button back on the next reload.
  await expect(card.getByTestId("task-result-retried")).toContainText(
    "Retried as a background task.",
    { timeout: DELIVERY_TIMEOUT_MS },
  );
  await expect(card.getByTestId("task-result-retry-action")).toHaveCount(0);

  // The replacement exists, it is a run of its own, and it names the run it
  // replaces. Polled because the retry is accepted for later: the 202 says the
  // dispatch was started, not that the child has rows yet.
  let after: ListedRun[] = [];
  await expect
    .poll(
      async () => {
        after = await listedRuns(page, originChatId);
        return after.length;
      },
      {
        message: "the retry should dispatch a second delegated run",
        timeout: DELIVERY_TIMEOUT_MS,
        intervals: [1000, 1000, 2000, 2000, 3000],
      },
    )
    .toBe(2);

  const replacement = after.find((run) => run.id !== failedRun.id);
  expect(replacement, "the second run is not the first one again").toBeTruthy();
  expect(
    replacement?.retry_of,
    "the replacement names the failed run it stands in for",
  ).toBe(failedRun.id);
  // Always detached, whatever the original was: the retry's answer comes home as
  // a delivered result, because the turn that would have awaited it is over.
  expect(replacement?.provenance_run_mode).toBe("async");

  // The half that is about the OLD run: its record is not rewritten. Same id,
  // still reading `failed`, still nobody's replacement. A retry implemented as a
  // re-run of the same chat would have moved this row's outcome and destroyed the
  // only account of the failure.
  const stillFailed = after.find((run) => run.id === failedRun.id);
  expect(stillFailed?.delegated_run_outcome).toBe("failed");
  expect(
    stillFailed?.retry_of,
    "the failed run is not made a replacement of itself",
  ).toBeUndefined();

  // And the brief came with it. The retry recovers it from the tool call the
  // origin recorded, so the replacement's own conversation opens with it — which
  // is also what makes the replacement fail the same way, since the mock refuses
  // that brief.
  await gotoAppPage(page, `/chat/${replacement?.id}`);
  await expect(page.getByTestId("message-user").first()).toContainText(
    FAILING_BRIEF,
    { timeout: DELIVERY_TIMEOUT_MS },
  );

  // Back in the origin, the replacement's own failure is delivered as a second
  // row. The first row is untouched: a retry does not rewrite the result it was
  // started from, and the reader keeps both attempts.
  await gotoAppPage(page, `/chat/${originChatId}`);
  const cards = page.getByTestId("task-result-card");
  await expect(cards).toHaveCount(2, { timeout: DELIVERY_TIMEOUT_MS });
  await expect(cards.nth(0)).toHaveAttribute(
    "data-task-result-status",
    "failed",
  );
  await expect(cards.nth(0).getByTestId("task-result-retried")).toContainText(
    "Retried as a background task.",
  );
  await expect(cards.nth(1)).toHaveAttribute(
    "data-task-result-status",
    "failed",
  );
});

test("offers no retry on a detached run that completed", async ({ page }) => {
  // The control, and the reason the test above is about `failed` rather than
  // about "a delivered row": the affordance is keyed on the outcome, and a run
  // that answered must not be re-run behind the user's back.
  test.setTimeout(240000);

  const originChatId = await dispatchDetachedTask(page, PLAIN_PROMPT);

  await gotoAppPage(page, `/chat/${originChatId}`);
  const card = page.getByTestId("task-result-card");
  await expect(card).toHaveCount(1, { timeout: DELIVERY_TIMEOUT_MS });
  await expect(card).toHaveAttribute("data-task-result-status", "completed");
  await expect(card.getByTestId("task-result-retry")).toHaveCount(0);
  await expect(card.getByTestId("task-result-retry-action")).toHaveCount(0);

  // And the endpoint agrees, so the missing button is a policy and not just a
  // rendering gap: asked directly, it names the outcome as the reason.
  const runs = await listedRuns(page, originChatId);
  expect(runs).toHaveLength(1);
  const refused = await page.request.post(
    `/api/v1beta/me/chats/${originChatId}/delegated_runs/${runs[0].id}/retry`,
    { data: { kind: "task" } },
  );
  expect(refused.status(), "a completed run cannot be retried").toBe(409);
  const refusal = (await refused.json()) as { code?: string; state?: string };
  expect(refusal.code).toBe("not_retryable");
  expect(refusal.state).toBe("completed");
});
