/**
 * Hook for calculating budget warning states
 *
 * Determines if the user should see a warning or error based on their
 * current spending compared to their budget limit and warning threshold.
 */

import { useMemo } from "react";

import type { BudgetStatusResponse } from "./useBudgetStatus";

export interface BudgetWarningResult {
  /** Whether to show a warning (above warn_threshold but below limit) */
  isWarning: boolean;
  /** Whether to show an error (at or above limit) */
  isError: boolean;
  /** Percentage of budget used (0-100+) */
  percentUsed: number;
  /** Whether the budget feature is enabled and has data */
  hasData: boolean;
  /** Formatted spending with currency symbol */
  formattedSpending: string;
  /** Formatted limit with currency symbol */
  formattedLimit: string;
}

/**
 * Calculate budget warning states from budget status data
 *
 * @example
 * ```tsx
 * const { data: budgetStatus } = useBudgetStatus();
 * const warning = useBudgetWarning(budgetStatus);
 *
 * if (warning.isError) {
 *   // Show error alert
 * } else if (warning.isWarning) {
 *   // Show warning alert
 * }
 * ```
 */
export function useBudgetWarning(
  budgetStatus: BudgetStatusResponse | undefined,
): BudgetWarningResult {
  return useMemo(() => {
    // Default state when no data
    const defaultResult: BudgetWarningResult = {
      isWarning: false,
      isError: false,
      percentUsed: 0,
      hasData: false,
      formattedSpending: "$0.00",
      formattedLimit: "$0.00",
    };

    // Return default if budget not enabled or no data
    if (
      !budgetStatus ||
      !budgetStatus.enabled ||
      budgetStatus.current_spending === null ||
      budgetStatus.budget_limit === null
    ) {
      return defaultResult;
    }

    const spending = budgetStatus.current_spending;
    const limit = budgetStatus.budget_limit;
    const warnThreshold = budgetStatus.warn_threshold ?? 0.7; // Default to 70%
    const currency = budgetStatus.budget_currency ?? "USD";

    // Calculate percentage used
    const percentUsed = limit > 0 ? (spending / limit) * 100 : 0;

    // Determine warning/error states
    const isError = spending >= limit; // At or over limit
    const isWarning = !isError && spending >= limit * warnThreshold; // Above threshold but below limit

    // Format currency values
    const currencySymbol = currency === "EUR" ? "€" : "$";
    const formattedSpending = `${currencySymbol}${spending.toFixed(2)}`;
    const formattedLimit = `${currencySymbol}${limit.toFixed(2)}`;

    return {
      isWarning,
      isError,
      percentUsed,
      hasData: true,
      formattedSpending,
      formattedLimit,
    };
  }, [budgetStatus]);
}
