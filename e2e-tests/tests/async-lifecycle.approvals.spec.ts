import { expect, test, type Page } from "@playwright/test";

import { chatIsReadyToChat, gotoAppPage } from "./shared";

/**
 * A detached run's result reaching an OPEN conversation, with no reload.
 *
 * `async-park.approvals.spec.ts` covers what the server delivers, and every
 * assertion in it is taken after a fresh navigation — which is exactly what this
 * mechanic is not about. Reload the page and a client that polls is
 * indistinguishable from one that does nothing: the rows are on disk either way.
 * So the origin chat is loaded once, a sentinel is planted on the window, and
 * every later assertion is made on that same document.
 *
 * Both transitions are asserted, not just the end state. The conversation is
 * shown to hold no delivered result before the run reports anything, and the
 * decision that finishes the run is taken in a SECOND page — so what arrives here
 * afterwards was fetched by this document on its own initiative, with nothing
 * navigating and nothing being typed.
 *
 * The test runs under the shipped `async_only` dispatch policy on the existing
 * `plan` facet, so the dispatch is preceded by the approval card
 * `async-park.approvals.spec.ts` covers. The card is answered rather than
 * configured away: a facet's approval override may only ever make a turn ask
 * MORE, so no per-facet override can remove it, and turning it off for the
 * scenario would change what every other approvals spec runs under.
 */

/** Keyed by the mock LLM's AsyncParkParentToolCall rule: one detached task. */
const PARK_PROMPT = "detach the gated probe as a background task";

/** The facet whose allowlist selects `erato/delegate_task`. */
const PLANNING_FACET = "Plan & delegate";

/** Its configured id, which is what the selected-facet chip is keyed by. */
const PLANNING_FACET_ID = "plan";

/** The child's gated tool. */
const GATED_TOOL = "publish_approval_probe";

/** What the origin says on the turn that launched a detached task. */
const DISPATCH_ANSWER = "ASYNC-DISPATCH-PARENT-ANSWER";

/** What the origin says to each of the two deliveries a parked run makes. */
const NOTIFIED_REACTION = "ASYNC-DELIVERY-NOTIFIED";
const ANSWERED_REACTION = "ASYNC-DELIVERY-ANSWERED";

/** What the gated call returns once it is allowed. */
const PROBE_RESULT = "approval probe published";

/** Turns the origin's dispatch turn takes. */
const DISPATCH_TIMEOUT_MS = 60000;

/**
 * Turns a delivery and its reaction take to reach a page that is NOT reloading.
 *
 * Generous on purpose, and the reason is the mechanic itself: the delivery-driven
 * poll runs at a 10s cadence when nothing is generating, so a budget tight enough
 * to be "fast" would be measuring the cadence rather than the behaviour.
 */
const POLL_TIMEOUT_MS = 120000;

const TASK_STEP =
  '[data-testid="tool-call-item"][data-tool-name="delegate_task"]';

/** A property of THIS document, which a reload would take with it. */
const SENTINEL = "__eratoAsyncLifecycleSentinel";

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
 * Dispatch one detached task, returning the origin chat and leaving the page on
 * it with the dispatch just approved.
 *
 * The approval is `async_only` asking about the one thing it asks about, and it
 * is answered here rather than asserted: what it shows is
 * `async-park.approvals.spec.ts`'s subject, and what these tests need from it is
 * only that the run starts. Returning as soon as the card is gone rather than
 * when the turn has answered is deliberate — the second test has to leave this
 * chat before the run's result comes home, and every DOM wait taken first is
 * time the result has to arrive in.
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

  return originChatId;
};

test("brings a detached run's result and the turn reacting to it into an open conversation without a reload", async ({
  page,
}) => {
  // Two deliveries, two reactions and a decision taken in another tab, all of it
  // landing in one never-reloaded document.
  test.setTimeout(300000);

  const originChatId = await dispatchDetachedTask(page, PARK_PROMPT);

  // Planted on THIS document. Every assertion below is made after it, so a page
  // that had navigated or reloaded to get its answer would fail the final check
  // even if all the content checks passed.
  await page.evaluate(
    (key) => ((window as unknown as Record<string, boolean>)[key] = true),
    SENTINEL,
  );

  const dispatchMessage = page.getByTestId("message-assistant").first();
  await expect(dispatchMessage).toContainText(DISPATCH_ANSWER, {
    timeout: DISPATCH_TIMEOUT_MS,
  });
  const step = dispatchMessage.locator(TASK_STEP);
  await expect(step).toHaveCount(1);
  // Settled at the hand-off: an `async` call's result is the launch, and this
  // step will never carry the run's outcome however the run ends. That is what
  // makes the delivered rows below the only way the outcome can arrive.
  await expect(step).toHaveAttribute("data-tool-status", "success");

  // The starting state of the transition this test is about, asserted before
  // anything can have arrived: nothing has been delivered into this
  // conversation, and the origin has said nothing but its dispatch line.
  await expect(page.getByTestId("task-result-card")).toHaveCount(0);
  await expect(page.getByText(NOTIFIED_REACTION)).toHaveCount(0);

  // TRANSITION 1 — the child parked, the origin was told, and the row plus the
  // turn reacting to it appeared here with nothing navigating. A client that
  // stopped polling would leave this conversation showing the dispatch step and
  // nothing else, for as long as it was looked at.
  const notification = page.getByTestId("task-result-card");
  await expect(notification).toHaveCount(1, { timeout: POLL_TIMEOUT_MS });
  await expect(notification).toHaveAttribute(
    "data-task-result-status",
    "input_required",
  );
  await expect(page.getByTestId("message-assistant").last()).toContainText(
    NOTIFIED_REACTION,
    { timeout: POLL_TIMEOUT_MS },
  );

  // The child's own chat, decided in a SECOND page so this one is never
  // navigated. The run therefore finishes somewhere this document has no part
  // in, which is the sharpest form of the claim: whatever appears here next was
  // fetched by this page on its own initiative.
  const childHref = await notification
    .getByTestId("task-result-input-required-open")
    .getAttribute("href");
  expect(
    childHref,
    "the notification links to the run's own chat",
  ).toBeTruthy();

  const childPage = await page.context().newPage();
  try {
    await gotoAppPage(childPage, String(childHref));
    const childCard = childPage.getByTestId("mcp-tool-approval");
    await expect(childCard).toBeVisible({ timeout: POLL_TIMEOUT_MS });
    await expect(childCard).toHaveAttribute("data-tool-name", GATED_TOOL);
    await childCard
      .getByRole("button", { name: "Allow once", exact: true })
      .click();
    await expect(childCard).toHaveCount(0, { timeout: POLL_TIMEOUT_MS });
    await chatIsReadyToChat(childPage, {
      expectAssistantResponse: true,
      loadingTimeoutMs: POLL_TIMEOUT_MS,
    });
  } finally {
    await childPage.close();
  }

  // Back on the original document, which has not been touched since the
  // sentinel. `bringToFront` is a focus change, not a navigation, and the poll
  // deliberately does not refetch on focus — so this only rules out the browser
  // throttling a hidden tab, it cannot stand in for the poll.
  await page.bringToFront();

  // TRANSITION 2 — the run finished elsewhere, and its answer reached this page.
  // The second card is the assertion: the first one was already here, so a count
  // of two is a change this document observed rather than a state it loaded.
  const cards = page.getByTestId("task-result-card");
  await expect(cards).toHaveCount(2, { timeout: POLL_TIMEOUT_MS });
  await expect(cards.nth(1)).toHaveAttribute(
    "data-task-result-status",
    "completed",
  );
  await expect(cards.nth(1).getByTestId("task-result-summary")).toContainText(
    PROBE_RESULT,
  );
  await expect(page.getByTestId("message-assistant").last()).toContainText(
    ANSWERED_REACTION,
    { timeout: POLL_TIMEOUT_MS },
  );

  // And the whole of it happened in the document the sentinel was planted on.
  // Without this the test would be satisfied by a client that reloaded for any
  // reason, which is the one thing it is trying to rule out.
  expect(
    await page.evaluate(
      (key) => (window as unknown as Record<string, boolean>)[key] === true,
      SENTINEL,
    ),
    "the conversation updated in place; this document was never reloaded",
  ).toBe(true);
  // Still the chat it started on, for the same reason.
  expect(new URL(page.url()).pathname).toBe(`/chat/${originChatId}`);
});
