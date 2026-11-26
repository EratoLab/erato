import { t, msg } from "@lingui/core/macro";
import clsx from "clsx";
import { useContext } from "react";

import { useBudgetStatus } from "@/hooks/budget/useBudgetStatus";
import { useBudgetWarning } from "@/hooks/budget/useBudgetWarning";
import { useBudgetWarningAcknowledgement } from "@/hooks/budget/useBudgetWarningAcknowledgement";
import { ProfileContext } from "@/providers/ProfileProvider";

import { Alert } from "../Alert";

import type { BudgetWarningSeverity } from "@/hooks/budget/useBudgetWarningAcknowledgement";
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
  const userId = useContext(ProfileContext)?.profile?.id;
  const {
    data: budgetStatus,
    fetchStatus,
    isSuccess,
    isPlaceholderData,
  } = useBudgetStatus();
  const warning = useBudgetWarning(budgetStatus);

  let severity: BudgetWarningSeverity | null | undefined;
  if (warning.hasData) {
    severity = warning.isError ? "error" : warning.isWarning ? "warning" : null;
  } else if (budgetStatus?.enabled === false) {
    severity = null;
  }

  const confirmedSeverity =
    isSuccess && fetchStatus === "idle" && !isPlaceholderData
      ? severity
      : undefined;
  const [acknowledgement, acknowledge] = useBudgetWarningAcknowledgement(
    userId,
    confirmedSeverity,
  );

  if (!severity || acknowledgement === severity) {
    return null;
  }

  const title = warning.isError
    ? t(
        msg({
          id: "chat.warning.budget.limit_reached.header",
          message: "Budget Limit Reached",
        }),
      )
    : t`Approaching Budget Limit`;

  // Format percentage for display
  const percentUsed = Math.round(warning.percentUsed);

  // Create the warning message
  // Extract formatted values to variables for lingui compliance
  const formattedLimit = warning.formattedLimit;
  const formattedSpending = warning.formattedSpending;

  let message = "";

  if (warning.isError) {
    message = t(
      msg({
        id: "chat.warning.budget.limit_reached.message",
        message: `You have reached or exceeded your personal budget limit of ${formattedLimit}. Current spending: ${formattedSpending}.`,
      }),
    );
  } else if (warning.isWarning) {
    message = t`You are using ${percentUsed}% of your budget (${formattedSpending} of ${formattedLimit}).`;
  }

  // Show budget period if available
  if (budgetStatus?.budget_period_days) {
    const days = budgetStatus.budget_period_days;
    message += t(
      msg({
        id: "chat.warning.budget.period_suffix",
        message: ` This is for your ${days}-day budget period.`,
      }),
    );
  }

  return (
    <Alert
      type={severity}
      title={title}
      geometryVariant="message"
      dismissible
      onDismiss={() => {
        acknowledge(severity);
        onDismiss?.();
      }}
      className={clsx("mb-2", className)}
    >
      {message}
    </Alert>
  );
};
