import { expect, test, type Page } from "@playwright/test";

import { chatIsReadyToChat, selectModel } from "./shared";

/**
 * Typed-text token-warning behaviors against Mock-LLM 1k (context 1000
 * tokens). Thresholds from useTokenUsageEstimation: warning at 85% usage,
 * exceeded at remaining_tokens <= 0; the composer requests an estimate only
 * from 150 characters (ChatInputTokenUsage estimateThreshold).
 *
 * Repeat counts are calibrated from a first estimate response instead of an
 * assumed characters-per-token ratio, and each test asserts its intended
 * usage band from the response so a tokenizer change cannot silently turn a
 * warning case into an exceeded case (or vice versa).
 */

const ESTIMATE_URL = "/api/v1beta/token_usage/estimate";
const SENTENCE = "This is a test message used to calibrate token estimates. ";

type Estimate = {
  max_tokens: number;
  total_tokens: number;
  remaining_tokens: number;
};

const fillAndReadEstimate = async (
  page: Page,
  text: string,
): Promise<Estimate> => {
  // Pin the wait to the estimate for the selected mock model: estimates for
  // other providers (e.g. one fired before the selection settled) may lack a
  // configured context size and must not be read as calibration data.
  const estimateResponse = page.waitForResponse(
    (response) =>
      response.url().includes(ESTIMATE_URL) &&
      (response.request().postDataJSON() as { chat_provider_id?: string })
        ?.chat_provider_id === "mock-llm-1k",
    { timeout: 15000 },
  );
  await page.getByRole("textbox", { name: "Type a message..." }).fill(text);
  return (await (await estimateResponse).json()) as Estimate;
};

/** Repeats of SENTENCE that land total_tokens at ~targetRatio of the limit. */
const calibrateRepeats = async (page: Page, targetRatio: number) => {
  const probeRepeats = 20;
  const probe = await fillAndReadEstimate(page, SENTENCE.repeat(probeRepeats));
  expect(
    probe.max_tokens,
    "Mock-LLM 1k must be configured with context_size_tokens = 1000",
  ).toBe(1000);
  const tokensPerRepeat = probe.total_tokens / probeRepeats;
  return Math.round((targetRatio * probe.max_tokens) / tokensPerRepeat);
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await chatIsReadyToChat(page);
  await selectModel(page, "Mock-LLM 1k");
});

test("shows a warning when typed text approaches the token limit", async ({
  page,
}) => {
  const repeats = await calibrateRepeats(page, 0.9);
  const estimate = await fillAndReadEstimate(page, SENTENCE.repeat(repeats));
  expect(estimate.total_tokens / estimate.max_tokens).toBeGreaterThan(0.85);
  expect(estimate.remaining_tokens).toBeGreaterThan(0);

  await expect(page.getByText("Approaching Token Limit")).toBeVisible();
  await expect(page.getByText(/using \d+% of.*token limit/i)).toBeVisible();
});

test("shows an error when typed text exceeds the token limit", async ({
  page,
}) => {
  const repeats = await calibrateRepeats(page, 1.3);
  const estimate = await fillAndReadEstimate(page, SENTENCE.repeat(repeats));
  expect(estimate.remaining_tokens).toBeLessThanOrEqual(0);

  await expect(page.getByText("Token Limit Exceeded")).toBeVisible();
  await expect(
    page.getByText(/exceeds.*token limit.*reduce.*message/i),
  ).toBeVisible();
});

test("clears the warning when the message is shortened", async ({ page }) => {
  const repeats = await calibrateRepeats(page, 0.9);
  await fillAndReadEstimate(page, SENTENCE.repeat(repeats));
  await expect(page.getByText("Approaching Token Limit")).toBeVisible();

  // Still above the 150-char estimate threshold, far below the warning band.
  await fillAndReadEstimate(page, SENTENCE.repeat(3));
  await expect(page.getByText("Approaching Token Limit")).toHaveCount(0);
});

test("requests no estimate below the character threshold", async ({ page }) => {
  let estimateRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes(ESTIMATE_URL)) {
      estimateRequests += 1;
    }
  });

  await page.getByRole("textbox", { name: "Type a message..." }).fill("Hi");
  // eslint-disable-next-line playwright/no-wait-for-timeout -- bounded absence window: outlasts the 500ms estimate debounce to prove no request fires below the threshold
  await page.waitForTimeout(1500);

  expect(estimateRequests).toBe(0);
  await expect(page.getByText("Approaching Token Limit")).toHaveCount(0);
  await expect(page.getByText("Token Limit Exceeded")).toHaveCount(0);
});
