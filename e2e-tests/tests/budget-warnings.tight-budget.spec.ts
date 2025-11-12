import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, createAuthenticatedContext } from "./shared";

/**
 * Budget Warning Tests - Tight Budget Scenario
 *
 * These tests verify that budget warnings are displayed correctly when users
 * approach or exceed their configured budget limits using real backend responses.
 *
 * These tests require the "tight-budget" k3d test scenario which configures
 * a very low budget limit ($0.01) and extremely high token costs ($1,000,000 per 1M tokens)
 * to trigger budget errors with minimal real usage.
 */

test.describe("Budget Warnings (Real Budget Enforcement)", () => {
  test(
    "Shows budget error after sending a message that exceeds the tight budget",
    { tag: TAG_CI },
    async ({ page, browser }) => {
      // Note: The tight-budget scenario is ensured by the setup-tight-budget project
      // which runs before these tests

      // Create a fresh authenticated context with a dedicated user account
      // This ensures a clean budget state for testing
      const { context: userContext, page: userPage } =
        await createAuthenticatedContext(
          browser,
          "user01@example.com",
          "admin",
        );

      try {
        await userPage.goto("/");
        await chatIsReadyToChat(userPage);

        const textbox = userPage.getByRole("textbox", {
          name: "Type a message...",
        });
        await expect(textbox).toBeVisible();

        // Send a simple message
        // Due to the tight-budget scenario's extremely high token costs ($1M per 1M tokens),
        // even this small message will exceed the $0.01 budget
        await textbox.fill("Hello, please respond with a brief greeting.");
        await textbox.press("Enter");

        // Wait for the assistant response to complete
        await chatIsReadyToChat(userPage, { expectAssistantResponse: true });

        // The budget warning/error should appear shortly after the message finishes streaming
        // The backend calculates costs and the frontend polls the budget status
        // Give it a reasonable timeout to account for:
        // - Message streaming completion
        // - Backend budget calculation
        // - Frontend budget status polling (typically every few seconds)
        const alert = userPage.getByRole("alert");
        await expect(alert).toBeVisible({ timeout: 15000 });

        // Verify that either a warning or error is shown
        // (depending on exact token usage, we might hit warning threshold or error threshold)
        const hasWarning = await userPage
          .getByText("Approaching Budget Limit")
          .isVisible()
          .catch(() => false);
        const hasError = await userPage
          .getByText("Budget Limit Reached")
          .isVisible()
          .catch(() => false);

        expect(hasWarning || hasError).toBe(true);

        // Log which type of alert was shown for debugging
        if (hasWarning) {
          console.log("[BUDGET_TEST] Budget warning threshold reached");
        } else if (hasError) {
          console.log("[BUDGET_TEST] Budget error threshold reached");
        }
      } finally {
        // Clean up the user context
        await userContext.close();
      }
    },
  );
});
