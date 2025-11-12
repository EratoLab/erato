import { test, expect } from "@playwright/test";
import { TAG_CI, TAG_NO_CI } from "./tags";
import { chatIsReadyToChat } from "./shared";

/**
 * Budget Warning Tests - Basic Scenario (Mocked)
 *
 * These tests verify that budget warnings are displayed correctly using
 * mocked API responses. This allows testing various budget scenarios
 * without requiring actual budget configurations.
 */

test.describe("Budget Warnings (Mocked)", () => {
  test(
    "Shows warning when approaching budget limit (70% threshold)",
    { tag: TAG_NO_CI },
    async ({ page }) => {
      // Mock budget API to return 70% usage (at warning threshold)
      await page.route("**/api/v1beta/me/budget", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enabled: true,
            budget_period_days: 30,
            current_spending: 70.0,
            warn_threshold: 0.7,
            budget_limit: 100.0,
            budget_currency: "USD",
          }),
        });
      });

      await page.goto("/");
      await chatIsReadyToChat(page);

      // Verify warning alert is visible
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();

      // Verify warning title
      await expect(page.getByText("Approaching Budget Limit")).toBeVisible();

      // Verify percentage and amounts are shown
      await expect(page.getByText(/70%.*budget/i)).toBeVisible();
      await expect(page.getByText(/\$70/)).toBeVisible();
      await expect(page.getByText(/\$100/)).toBeVisible();

      // Verify budget period information is shown
      await expect(page.getByText(/30-day budget period/i)).toBeVisible();
    },
  );

  test(
    "Shows error when budget limit is reached (100%)",
    { tag: TAG_NO_CI },
    async ({ page }) => {
      // Mock budget API to return 100% usage (at error threshold)
      await page.route("**/api/v1beta/me/budget", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enabled: true,
            budget_period_days: 30,
            current_spending: 100.0,
            warn_threshold: 0.7,
            budget_limit: 100.0,
            budget_currency: "USD",
          }),
        });
      });

      await page.goto("/");
      await chatIsReadyToChat(page);

      // Verify error alert is visible
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();

      // Verify error title
      await expect(page.getByText("Budget Limit Reached")).toBeVisible();

      // Verify error message mentions exceeding the limit
      await expect(
        page.getByText(/reached or exceeded.*budget limit/i),
      ).toBeVisible();
      await expect(page.getByText(/\$100/)).toBeVisible();
    },
  );

  test(
    "Shows error when budget limit is exceeded (>100%)",
    { tag: TAG_NO_CI },
    async ({ page }) => {
      // Mock budget API to return 120% usage (exceeded limit)
      await page.route("**/api/v1beta/me/budget", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enabled: true,
            budget_period_days: 30,
            current_spending: 120.0,
            warn_threshold: 0.7,
            budget_limit: 100.0,
            budget_currency: "USD",
          }),
        });
      });

      await page.goto("/");
      await chatIsReadyToChat(page);

      // Verify error alert is visible
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();

      // Verify error title and message
      await expect(page.getByText("Budget Limit Reached")).toBeVisible();
      await expect(page.getByText(/\$120/)).toBeVisible();
    },
  );

  test(
    "Shows no warning when below threshold (50%)",
    { tag: TAG_CI },
    async ({ page }) => {
      // Mock budget API to return 50% usage (below warning threshold)
      await page.route("**/api/v1beta/me/budget", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enabled: true,
            budget_period_days: 30,
            current_spending: 50.0,
            warn_threshold: 0.7,
            budget_limit: 100.0,
            budget_currency: "USD",
          }),
        });
      });

      await page.goto("/");
      await chatIsReadyToChat(page);

      // Verify NO budget warning is shown
      await expect(
        page.getByText("Approaching Budget Limit"),
      ).not.toBeVisible();
      await expect(page.getByText("Budget Limit Reached")).not.toBeVisible();
    },
  );

  test(
    "Shows no warning when budget tracking is disabled",
    { tag: TAG_CI },
    async ({ page }) => {
      // Mock budget API to return disabled state
      await page.route("**/api/v1beta/me/budget", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enabled: false,
            budget_period_days: null,
            current_spending: null,
            warn_threshold: null,
            budget_limit: null,
            budget_currency: null,
          }),
        });
      });

      await page.goto("/");
      await chatIsReadyToChat(page);

      // Verify NO budget warning is shown
      await expect(
        page.getByText("Approaching Budget Limit"),
      ).not.toBeVisible();
      await expect(page.getByText("Budget Limit Reached")).not.toBeVisible();
    },
  );

  test(
    "Shows warning with EUR currency formatting",
    { tag: TAG_NO_CI },
    async ({ page }) => {
      // Mock budget API with EUR currency
      await page.route("**/api/v1beta/me/budget", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enabled: true,
            budget_period_days: 30,
            current_spending: 85.0,
            warn_threshold: 0.7,
            budget_limit: 100.0,
            budget_currency: "EUR",
          }),
        });
      });

      await page.goto("/");
      await chatIsReadyToChat(page);

      // Verify warning is visible
      await expect(page.getByText("Approaching Budget Limit")).toBeVisible();

      // Verify EUR currency symbol is shown (€ or EUR depending on locale)
      // Note: Different locales may format EUR differently
      const alertText = await page.getByRole("alert").textContent();
      expect(alertText).toMatch(/€|EUR/);
    },
  );

  test(
    "Shows warning with custom threshold (80%)",
    { tag: TAG_NO_CI },
    async ({ page }) => {
      // Mock budget API with custom 80% threshold
      await page.route("**/api/v1beta/me/budget", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enabled: true,
            budget_period_days: 30,
            current_spending: 80.0,
            warn_threshold: 0.8, // Custom threshold
            budget_limit: 100.0,
            budget_currency: "USD",
          }),
        });
      });

      await page.goto("/");
      await chatIsReadyToChat(page);

      // Verify warning appears at custom threshold
      await expect(page.getByText("Approaching Budget Limit")).toBeVisible();
      await expect(page.getByText(/80%/)).toBeVisible();
    },
  );
});
