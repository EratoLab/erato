import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { useBudgetStatus } from "@/hooks/budget/useBudgetStatus";
import { useBudgetWarning } from "@/hooks/budget/useBudgetWarning";

import { Alert } from "../Alert";

import type React from "react";

interface BudgetWarningProps {
  /** Optional CSS className */
  className?: string;
  /** Callback when dismissed */
  onDismiss?: () => void;
}

/**
 * Component to display warnings about budget/spending limits
 *
 * Shows warnings when user approaches their configured budget limit.
 * Uses the same Alert component as TokenUsageWarning for consistency.
 *
 * @example
 * ```tsx
 * <BudgetWarning />
 * ```
 */
export const BudgetWarning: React.FC<BudgetWarningProps> = ({
  className,
  onDismiss,
}) => {
  // Fetch budget status (will use cached data if available)
  const { data: budgetStatus } = useBudgetStatus();

  // Calculate warning states
  const warning = useBudgetWarning(budgetStatus);

  // Only show if we have data and are in warning or error state
  const shouldShow = warning.hasData && (warning.isWarning || warning.isError);

  if (!shouldShow) {
    return null;
  }

  // Determine alert type and title
  const alertType = warning.isError ? "error" : "warning";
  const title = warning.isError
    ? t`Budget Limit Reached`
    : t`Approaching Budget Limit`;

  // Format percentage for display
  const percentUsed = Math.round(warning.percentUsed);

  // Create the warning message
  // Extract formatted values to variables for lingui compliance
  const formattedLimit = warning.formattedLimit;
  const formattedSpending = warning.formattedSpending;

  let message = "";

  if (warning.isError) {
    message = t`You have reached or exceeded your budget limit of ${formattedLimit}. Current spending: ${formattedSpending}.`;
  } else if (warning.isWarning) {
    message = t`You are using ${percentUsed}% of your budget (${formattedSpending} of ${formattedLimit}).`;
  }

  // Show budget period if available
  if (budgetStatus?.budget_period_days) {
    const days = budgetStatus.budget_period_days;
    message += t` This is for your ${days}-day budget period.`;
  }

  return (
    <Alert
      type={alertType}
      title={title}
      dismissible={!!onDismiss}
      onDismiss={onDismiss}
      className={clsx("mb-2", className)}
    >
      {message}
    </Alert>
  );
};
