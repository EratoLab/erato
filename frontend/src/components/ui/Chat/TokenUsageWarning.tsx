import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { Alert } from "../Feedback/Alert";

import type { TokenUsageEstimationResult } from "@/hooks/chat/useTokenUsageEstimation";
import type { TokenUsageStats } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

interface TokenUsageWarningProps {
  /** Token usage estimation result */
  estimation: TokenUsageEstimationResult;
  /** Show the component (defaults to true if approaching limit) */
  show?: boolean;
  /** Optional CSS className */
  className?: string;
  /** Callback when dismissed */
  onDismiss?: () => void;
}

/**
 * Component to display warnings about token usage limits
 */
export const TokenUsageWarning: React.FC<TokenUsageWarningProps> = ({
  estimation,
  show,
  className,
  onDismiss,
}) => {
  const { isApproachingLimit, isCriticallyClose, exceedsLimit, tokenUsage } =
    estimation;

  // Only show if explicitly set or if approaching limit
  const shouldShow =
    show ?? (isApproachingLimit || isCriticallyClose || exceedsLimit);

  if (!shouldShow || !tokenUsage) {
    return null;
  }

  const stats: TokenUsageStats = tokenUsage.stats;

  // Determine alert type based on token usage level
  let alertType: "info" | "warning" | "error" = "info";
  let title = t`Token Usage`;

  if (exceedsLimit) {
    alertType = "error";
    title = t`Token Limit Exceeded`;
  } else if (isCriticallyClose) {
    alertType = "error";
    title = t`Approaching Token Limit`;
  } else if (isApproachingLimit) {
    alertType = "warning";
    title = t`Approaching Token Limit`;
  }

  // Format percentage for display
  const percentUsed = Math.round((stats.total_tokens / stats.max_tokens) * 100);

  // Create the warning message
  let message = "";

  if (exceedsLimit) {
    const maxTokensFormatted = stats.max_tokens.toLocaleString();
    message = t`This message exceeds the token limit of ${maxTokensFormatted}. Please reduce the message length or remove attached files.`;
  } else if (isCriticallyClose || isApproachingLimit) {
    const totalTokensFormatted = stats.total_tokens.toLocaleString();
    const maxTokensFormatted = stats.max_tokens.toLocaleString();
    message = t`This message is using ${percentUsed}% of the available token limit (${totalTokensFormatted} of ${maxTokensFormatted}).`;

    if (stats.file_tokens > 0) {
      const fileTokensFormatted = stats.file_tokens.toLocaleString();
      message += t` File attachments account for ${fileTokensFormatted} tokens.`;
    }
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
