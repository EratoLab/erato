import { useEffect } from "react";

import { env } from "@/app/env";
import { useTokenUsageWithFiles } from "@/hooks/chat/useTokenUsageWithFiles";

import { CompactionSuggestion } from "./CompactionSuggestion";
import { TokenUsageWarning } from "../Feedback/ChatWarnings/TokenUsageWarning";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

interface ChatInputTokenUsageProps {
  /** Current message text */
  message: string;
  /** Attached files */
  attachedFiles: FileUploadItem[];
  /**
   * Inline `File`s that should count toward the estimate without being
   * persisted to the upload pipeline. Used by the Outlook add-in to feed
   * the previewed email body into the token check.
   */
  virtualFiles?: File[];
  /** Current chat ID */
  chatId?: string | null;
  /** Assistant ID to include for new-chat estimation context */
  assistantId?: string;
  /** Previous message ID */
  previousMessageId?: string | null;
  /** Selected chat provider ID for new chats */
  chatProviderId?: string;
  /** Is the input disabled */
  disabled?: boolean;
  /** Called when the token limit is exceeded */
  onLimitExceeded?: (isExceeded: boolean) => void;
  /** Character threshold before triggering token estimation (default: 150) */
  estimateThreshold?: number;
  onCompact?: () => void;
  compactionPending?: boolean;
  /** CSS class name for the container */
  className?: string;
}

/**
 * Component to handle token usage estimation and warnings for the chat input
 */
export const ChatInputTokenUsage: React.FC<ChatInputTokenUsageProps> = ({
  message,
  attachedFiles,
  virtualFiles,
  chatId,
  assistantId,
  previousMessageId,
  chatProviderId,
  disabled = false,
  onLimitExceeded,
  estimateThreshold = 150,
  className,
  onCompact,
  compactionPending,
}) => {
  // Use the token usage hook
  const { tokenUsageEstimation, clearEstimation, exceedsLimit } =
    useTokenUsageWithFiles({
      message,
      attachedFiles,
      virtualFiles,
      chatId,
      assistantId,
      previousMessageId,
      chatProviderId,
      disabled,
      estimateThreshold: onCompact && previousMessageId ? 0 : estimateThreshold,
    });

  // Notify parent when limit is exceeded
  useEffect(() => {
    if (onLimitExceeded) {
      onLimitExceeded(exceedsLimit);
    }
  }, [exceedsLimit, onLimitExceeded]);

  if (!tokenUsageEstimation) return null;

  return (
    <div className={className}>
      {onCompact && (
        <CompactionSuggestion
          estimation={tokenUsageEstimation}
          onCompact={onCompact}
          pending={compactionPending}
        />
      )}
      {!(
        onCompact &&
        tokenUsageEstimation.tokenUsage &&
        tokenUsageEstimation.usagePercentage * 100 >=
          (env().chatHistoryCompactionThresholdPercentage ?? 80)
      ) && (
        <TokenUsageWarning
          estimation={tokenUsageEstimation}
          onDismiss={clearEstimation}
        />
      )}
    </div>
  );
};
