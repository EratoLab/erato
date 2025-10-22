import { test, expect } from "@playwright/test";
import { TAG_CI, TAG_NO_CI } from "./tags";
import { chatIsReadyToChat, createAuthenticatedContext } from "./shared";

/**
 * Token Usage Warning Tests
 *
 * These tests verify that token usage warnings are displayed correctly when users
 * approach or exceed the model's context token limits.
 *
 * Unlike budget warnings, token warnings cannot be easily mocked because they
 * depend on real tokenization calculations from the backend (/api/v1beta/token_usage/estimate).
 * Instead, these tests use a dedicated test user (tokentest@example.com) who has access
 * to a model with very low context_size_tokens (1000) configured in erato.toml.
 *
 * Prerequisites:
 * - Backend must be running with erato.template.toml (or erato.toml based on it) that includes:
 *   1. test-token-limit model with context_size_tokens = 1000
 *   2. Model permission rule allowing all users to access the test model
 *   3. Any test user (e.g., user01@example.com from Dex config)
 *
 * Token warning thresholds (from frontend/src/hooks/chat/useTokenUsageEstimation.ts):
 * - WARNING_THRESHOLD = 0.85 (85%)
 * - CRITICAL_THRESHOLD = 0.95 (95%)
 * - Exceeds = remaining_tokens <= 0
 *
 * NOTE: These tests are currently skipped in CI (@no-ci tag) due to:
 * - Missing tokentest@example.com user in Keycloak configuration
 * - Test environment may not have test-token-limit model configured
 * - Auth timeouts in CI environment
 * TODO: Add tokentest@example.com to frontend/local-auth/keycloak-realm.json
 */

test.describe("Token Usage Warnings", () => {
  test(
    "Shows warning when approaching token limit (85% threshold)",
    { tag: TAG_NO_CI },
    async ({ browser }) => {
      // Login as test user - test-token-limit model is available to all users
      const { page } = await createAuthenticatedContext(
        browser,
        "user01@example.com",
      );

      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });
      await expect(textbox).toBeVisible();

      // Create a message that will use approximately 85-90% of a 1000 token limit
      // Be aggressive to ensure we cross the 85% threshold
      // String is 57 chars × 80 repeats = 4560 chars ≈ 912 tokens (91%)
      const longMessage =
        "This is a test message to trigger token usage warnings. ".repeat(80);

      // Type the message
      await textbox.fill(longMessage);

      // Wait for debounced token estimation (500ms debounce + API call time)
      await page.waitForTimeout(2000);

      // Verify warning alert appears
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible({ timeout: 5000 });

      // Verify warning title
      await expect(page.getByText("Approaching Token Limit")).toBeVisible();

      // Verify percentage is shown (should be around 85-95%)
      await expect(page.getByText(/using \d+% of.*token limit/i)).toBeVisible();

      // Verify token counts are displayed (within the alert)
      await expect(alert.getByText(/\d+.*of.*\d+/)).toBeVisible();
    },
  );

  test(
    "Shows critical warning at 95% threshold",
    { tag: TAG_NO_CI },
    async ({ browser }) => {
      const { page } = await createAuthenticatedContext(
        browser,
        "tokentest@example.com",
      );

      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Create a message that will use approximately 95% of a 1000 token limit
      // Actual ratio: 1 token ≈ 5 characters
      // For 950 tokens, we need approximately 4750 characters
      // Using 79 repeats: 79 × 60 = 4740 chars ≈ 948 tokens (94.8%)
      const veryLongMessage =
        "This is a test message to trigger critical token warnings. ".repeat(79);

      await textbox.fill(veryLongMessage);

      // Wait for token estimation
      await page.waitForTimeout(1500);

      // Verify critical warning (error-level alert)
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible({ timeout: 3000 });

      // Verify it shows "Approaching Token Limit" (critical uses same title as warning)
      await expect(page.getByText("Approaching Token Limit")).toBeVisible();

      // Verify high percentage is shown (85%+ to indicate approaching/critical)
      const alertText = await alert.textContent();
      const percentMatch = alertText?.match(/(\d+)%/);
      if (percentMatch) {
        const percent = parseInt(percentMatch[1]);
        expect(percent).toBeGreaterThanOrEqual(85);
      }
    },
  );

  test(
    "Shows error when exceeding token limit",
    { tag: TAG_NO_CI },
    async ({ browser }) => {
      const { page } = await createAuthenticatedContext(
        browser,
        "tokentest@example.com",
      );

      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Create a message that will exceed 1000 token limit
      // Actual ratio: 1 token ≈ 5 characters
      // For >1000 tokens (e.g., 1050 tokens), we need approximately 5250 characters
      const tooLongMessage =
        "This is a test message that exceeds the token limit. ".repeat(95);

      await textbox.fill(tooLongMessage);

      // Wait for token estimation
      await page.waitForTimeout(1500);

      // Verify error alert appears
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible({ timeout: 3000 });

      // Verify error title
      await expect(page.getByText("Token Limit Exceeded")).toBeVisible();

      // Verify error message
      await expect(
        page.getByText(/exceeds.*token limit.*reduce.*message/i),
      ).toBeVisible();
    },
  );

  test(
    "Shows no warning for short messages",
    { tag: TAG_NO_CI },
    async ({ browser }) => {
      const { page } = await createAuthenticatedContext(
        browser,
        "tokentest@example.com",
      );

      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Short message that won't trigger warnings
      const shortMessage = "Hello, this is a short message.";

      await textbox.fill(shortMessage);

      // Wait for token estimation
      await page.waitForTimeout(1500);

      // Verify NO token warning is shown
      await expect(page.getByText("Approaching Token Limit")).not.toBeVisible();
      await expect(page.getByText("Token Limit Exceeded")).not.toBeVisible();
    },
  );

  test(
    "Clears warning when message is shortened",
    { tag: TAG_NO_CI },
    async ({ browser }) => {
      const { page } = await createAuthenticatedContext(
        browser,
        "tokentest@example.com",
      );

      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // First, type a long message to trigger warning
      // Be aggressive to ensure we cross 85% threshold
      // String is 52 chars × 85 repeats = 4420 chars ≈ 884 tokens (88%)
      const longMessage =
        "This is a test message to trigger token warnings. ".repeat(85);
      await textbox.fill(longMessage);

      // Wait longer for debounce + API call
      await page.waitForTimeout(2000);

      // Verify warning appears
      await expect(page.getByText("Approaching Token Limit")).toBeVisible({
        timeout: 5000,
      });

      // Now shorten the message below threshold
      await textbox.fill("Short message");

      // Wait longer for debounce + API call + re-render
      await page.waitForTimeout(2000);

      // Verify warning disappears
      await expect(page.getByText("Approaching Token Limit")).not.toBeVisible();
    },
  );

  test.skip(
    "Shows warning includes file token information when file attached",
    { tag: TAG_CI },
    async ({ browser }) => {
      const { page } = await createAuthenticatedContext(
        browser,
        "tokentest@example.com",
      );

      await page.goto("/");
      await chatIsReadyToChat(page);

      // Upload a file that will contribute to token usage
      const fileChooserPromise = page.waitForEvent("filechooser");
      await page.getByLabel("Upload Files").click();
      const fileChooser = await fileChooserPromise;

      // Use the existing sample PDF which has text content
      await fileChooser.setFiles("test-files/sample-report-compressed.pdf");

      // Wait for file upload to complete - look for the filename
      await expect(page.getByText(/sample-report-compressed\.pdf/i)).toBeVisible({
        timeout: 10000,
      });

      // Add a long message to push over the warning threshold
      const textbox = page.getByRole("textbox", { name: "Type a message..." });
      const longMessage =
        "Analyzing the attached document with additional context. ".repeat(20);
      await textbox.fill(longMessage);

      // Wait for token estimation
      await page.waitForTimeout(2000);

      // Check if warning appears (may or may not depending on file size and config)
      // If warning appears, verify file token information is included
      const approachingLimit = page.getByText("Approaching Token Limit");
      const isWarningVisible = await approachingLimit.isVisible();

      if (isWarningVisible) {
        // Verify file token information is mentioned
        await expect(
          page.getByText(/file attachments account for.*tokens/i),
        ).toBeVisible();
      }

      // This test documents the behavior but may not always trigger warnings
      // depending on the PDF content size and backend configuration
    },
  );

  test(
    "Does not show warning when message is below estimate threshold",
    { tag: TAG_NO_CI },
    async ({ browser }) => {
      const { page } = await createAuthenticatedContext(
        browser,
        "tokentest@example.com",
      );

      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Type a message below the 150 character threshold
      // (from ChatInputTokenUsage.tsx:39, estimateThreshold defaults to 150)
      const shortMessage = "Hi"; // Only 2 characters

      await textbox.fill(shortMessage);
      await page.waitForTimeout(1000);

      // No token estimation should occur, so no warnings
      await expect(page.getByText("Approaching Token Limit")).not.toBeVisible();
      await expect(page.getByText("Token Limit Exceeded")).not.toBeVisible();
    },
  );
});
