import { expect, test, type Locator, type Page } from "@playwright/test";

import { chatIsReadyToChat, gotoAppPage } from "./shared";

/**
 * Keyed by the mock LLM server's DelegationParentToolCall rule, which answers
 * it with a `delegate_to_assistant` call aimed at the assistant the request
 * offers as a mention target.
 */
const DELEGATION_PROMPT = "delegate to the probe assistant";

/** The tool the mock server has the delegate call, so the run has a sub-step. */
const DELEGATE_TOOL_NAME = "list_files";

/** Turns the whole delegated run — child tool call plus answer — take. */
const RUN_TIMEOUT_MS = 60000;

const DELEGATION_STEP =
  '[data-testid="tool-call-item"][data-tool-name="delegate_to_assistant"]';

/**
 * A single-token name: the composer's mention trigger ends at whitespace, so a
 * two-word assistant cannot be typed as a query.
 */
const buildDelegateName = () => {
  const randomSuffix = Math.floor(Math.random() * 16777215)
    .toString(16)
    .padStart(6, "0");
  return `DelegationProbe-${randomSuffix}`;
};

const createDelegateAssistant = async (page: Page, name: string) => {
  await page.goto("/assistants/new");

  await expect(
    page.getByRole("heading", { name: /create assistant/i }),
  ).toBeVisible();

  await page.getByLabel(/name/i).fill(name);
  await page
    .getByLabel(/description/i)
    .fill("Delegation target for the in-chat delegation e2e");
  await page
    .getByLabel(/system prompt/i)
    .fill("Answer the delegated probe task.");
  await page.getByRole("button", { name: /create assistant/i }).click();

  await expect(page.getByText(/assistant created successfully/i)).toBeVisible({
    timeout: 5000,
  });
  await page.waitForURL("/assistants/created", { timeout: 5000 });

  const response = await page.request.get(
    "/api/v1beta/assistants?sharing_relation=owned_by_user",
  );
  expect(response.ok()).toBeTruthy();
  const assistants = (await response.json()) as Array<{
    id: string;
    name: string;
  }>;
  const created = assistants.find((assistant) => assistant.name === name);
  expect(
    created,
    `assistant ${name} should exist after creation`,
  ).toBeDefined();
  return created!.id;
};

/** Types the `@` query, picks the delegate from the picker, and sends. */
const sendDelegatingMessage = async (
  page: Page,
  delegateId: string,
  delegateName: string,
) => {
  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await textbox.click();
  await textbox.pressSequentially(`@${delegateName}`);

  const mentionOption = page.getByTestId(
    `chat-input-mention-option-${delegateId}`,
  );
  await expect(mentionOption).toBeVisible({ timeout: 10000 });
  await mentionOption.click();
  await expect(textbox).toHaveValue(`@${delegateName} `);

  await textbox.pressSequentially(DELEGATION_PROMPT);
  await expect(textbox).toHaveValue(`@${delegateName} ${DELEGATION_PROMPT}`);

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

const nestedTraceOf = (delegationStep: Locator) =>
  delegationStep.getByTestId("delegation-trace");

test("delegates to an @-mentioned assistant and renders the delegated run", async ({
  page,
}) => {
  // Creating the delegate, the origin turn, the whole delegated run and the
  // origin's closing answer are one test; the default budget covers none of it.
  test.setTimeout(180000);

  const delegateName = buildDelegateName();
  const delegateId = await createDelegateAssistant(page, delegateName);

  await gotoAppPage(page, "/");
  await chatIsReadyToChat(page);

  await sendDelegatingMessage(page, delegateId, delegateName);

  const assistantMessage = page.getByTestId("message-assistant").last();

  // While the delegate runs, the origin chat's tool step is in flight. The
  // first frame of the run has no envelope yet, so the delegation title only
  // arrives with the first progress frame — both are inside the same card.
  const runningStep = assistantMessage.locator(
    `${DELEGATION_STEP}[data-tool-status="in_progress"]`,
  );
  await expect(runningStep).toHaveCount(1, { timeout: RUN_TIMEOUT_MS });
  await expect(runningStep).toContainText(`Delegating to ${delegateName}`, {
    timeout: RUN_TIMEOUT_MS,
  });

  // The delegate's own steps stream into the origin chat as they happen; the
  // step is expanded while it is the live one, so these are really on screen.
  const runningTrace = nestedTraceOf(runningStep);
  await expect(runningTrace).toBeVisible({ timeout: RUN_TIMEOUT_MS });
  await expect(runningTrace).toContainText(DELEGATE_TOOL_NAME, {
    timeout: RUN_TIMEOUT_MS,
  });
  await expect(runningStep.getByTestId("delegation-open-run")).toBeVisible();

  await chatIsReadyToChat(page, {
    expectAssistantResponse: true,
    loadingTimeoutMs: RUN_TIMEOUT_MS,
  });

  // The finished turn folds the timeline behind the "Thought for X" pill and
  // folds the delegation step behind the answer that followed it. Both stay
  // mounted, so presence-based matchers still see them; toBeVisible would not.
  const delegationStep = assistantMessage.locator(DELEGATION_STEP);
  await expect(delegationStep).toHaveCount(1);
  await expect(delegationStep).toHaveAttribute("data-tool-status", "success");
  await expect(delegationStep).toContainText(`Delegated to ${delegateName}`);

  const settledTrace = nestedTraceOf(delegationStep);
  await expect(settledTrace).toContainText(DELEGATE_TOOL_NAME);
  await expect(settledTrace).toContainText("Final answer");
  await expect(delegationStep.getByTestId("delegation-result")).toContainText(
    "CHILD-ANSWER",
  );

  // The origin model answered from the delegate's result, so the turn really
  // continued past the tool call.
  await expect(assistantMessage).toContainText(
    "The delegate finished the probe task.",
  );

  const openRunLink = delegationStep.getByTestId("delegation-open-run");
  await expect(openRunLink).toHaveAttribute("target", "_blank");
  await expect(openRunLink).toHaveAttribute("rel", "noopener noreferrer");
  const href = await openRunLink.getAttribute("href");
  expect(href).toMatch(new RegExp(`^/a/${delegateId}/[0-9a-fA-F-]{36}$`));

  // The link resolves to the delegate's own run, with the answer the origin
  // chat quoted.
  await page.goto(href!);
  await expect(page.getByTestId("message-assistant").last()).toContainText(
    "CHILD-ANSWER",
    { timeout: RUN_TIMEOUT_MS },
  );
});
