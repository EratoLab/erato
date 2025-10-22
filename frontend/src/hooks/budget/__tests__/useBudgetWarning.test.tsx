import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { useBudgetWarning } from "../useBudgetWarning";

import type { BudgetStatusResponse } from "../useBudgetStatus";

describe("useBudgetWarning", () => {
  it("should return default state when budget data is undefined", () => {
    const { result } = renderHook(() => useBudgetWarning(undefined));

    expect(result.current.isWarning).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.percentUsed).toBe(0);
    expect(result.current.hasData).toBe(false);
    expect(result.current.formattedSpending).toMatch(/\$0\.00/); // USD default
    expect(result.current.formattedLimit).toMatch(/\$0\.00/);
  });

  it("should return default state when budget is disabled", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: false,
      budget_period_days: null,
      current_spending: null,
      warn_threshold: null,
      budget_limit: null,
      budget_currency: null,
    };

    const { result } = renderHook(() => useBudgetWarning(budgetStatus));

    expect(result.current.hasData).toBe(false);
    expect(result.current.isWarning).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("should calculate warning state when spending >= 70% of limit", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 750, // 75% of limit
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const { result } = renderHook(() => useBudgetWarning(budgetStatus));

    expect(result.current.hasData).toBe(true);
    expect(result.current.isWarning).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.percentUsed).toBe(75);
    expect(result.current.formattedSpending).toContain("750");
    expect(result.current.formattedLimit).toContain("1,000");
  });

  it("should calculate error state when spending >= 100% of limit", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 1050, // 105% of limit
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const { result } = renderHook(() => useBudgetWarning(budgetStatus));

    expect(result.current.hasData).toBe(true);
    expect(result.current.isWarning).toBe(false);
    expect(result.current.isError).toBe(true);
    expect(result.current.percentUsed).toBe(105);
    expect(result.current.formattedSpending).toContain("1,050");
    expect(result.current.formattedLimit).toContain("1,000");
  });

  it("should not show warning when spending < warn_threshold", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 600, // 60% of limit (below 70% threshold)
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const { result } = renderHook(() => useBudgetWarning(budgetStatus));

    expect(result.current.hasData).toBe(true);
    expect(result.current.isWarning).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.percentUsed).toBe(60);
  });

  it("should handle custom warn_threshold", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 850, // 85% of limit
      warn_threshold: 0.8, // Custom 80% threshold
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const { result } = renderHook(() => useBudgetWarning(budgetStatus));

    expect(result.current.hasData).toBe(true);
    expect(result.current.isWarning).toBe(true); // 85% >= 80% threshold
    expect(result.current.isError).toBe(false);
  });

  it("should use default 70% threshold when warn_threshold is null", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 750, // 75% of limit
      warn_threshold: null, // Should default to 0.7
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const { result } = renderHook(() => useBudgetWarning(budgetStatus));

    expect(result.current.hasData).toBe(true);
    expect(result.current.isWarning).toBe(true); // 75% >= 70% default
  });

  it("should format EUR currency correctly", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 500,
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "EUR",
    };

    const { result } = renderHook(() => useBudgetWarning(budgetStatus));

    expect(result.current.hasData).toBe(true);
    // EUR formatting varies by locale, but should contain the amount
    expect(result.current.formattedSpending).toContain("500");
    expect(result.current.formattedLimit).toContain("1,000");
  });

  it("should handle zero limit edge case", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 100,
      warn_threshold: 0.7,
      budget_limit: 0, // Edge case: zero limit
      budget_currency: "USD",
    };

    const { result } = renderHook(() => useBudgetWarning(budgetStatus));

    expect(result.current.hasData).toBe(true);
    expect(result.current.percentUsed).toBe(0); // 100 / 0 = 0 (handled)
    expect(result.current.isError).toBe(true); // spending >= limit (100 >= 0)
  });

  it("should handle exact limit boundary", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 1000, // Exactly at limit
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const { result } = renderHook(() => useBudgetWarning(budgetStatus));

    expect(result.current.hasData).toBe(true);
    expect(result.current.isError).toBe(true); // spending >= limit
    expect(result.current.isWarning).toBe(false);
    expect(result.current.percentUsed).toBe(100);
  });

  it("should handle exact threshold boundary", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 700, // Exactly at 70% threshold
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const { result } = renderHook(() => useBudgetWarning(budgetStatus));

    expect(result.current.hasData).toBe(true);
    expect(result.current.isWarning).toBe(true); // spending >= threshold
    expect(result.current.isError).toBe(false);
    expect(result.current.percentUsed).toBe(70);
  });

  it("should memoize result based on budgetStatus dependency", () => {
    const budgetStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 750,
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const { result, rerender } = renderHook(
      ({ status }) => useBudgetWarning(status),
      {
        initialProps: { status: budgetStatus },
      },
    );

    const firstResult = result.current;

    // Rerender with same data
    rerender({ status: budgetStatus });

    // Should return the same memoized object
    expect(result.current).toBe(firstResult);
  });

  it("should recalculate when budgetStatus changes", () => {
    const initialStatus: BudgetStatusResponse = {
      enabled: true,
      budget_period_days: 30,
      current_spending: 600,
      warn_threshold: 0.7,
      budget_limit: 1000,
      budget_currency: "USD",
    };

    const { result, rerender } = renderHook(
      ({ status }) => useBudgetWarning(status),
      {
        initialProps: { status: initialStatus },
      },
    );

    expect(result.current.isWarning).toBe(false);

    // Update spending to trigger warning
    const updatedStatus: BudgetStatusResponse = {
      ...initialStatus,
      current_spending: 800,
    };

    rerender({ status: updatedStatus });

    expect(result.current.isWarning).toBe(true);
    expect(result.current.percentUsed).toBe(80);
  });
});
