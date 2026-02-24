import { useEffect } from "react";

import { useTokenUsageWithFiles } from "@/hooks/chat/useTokenUsageWithFiles";

import { TokenUsageWarning } from "../Feedback/ChatWarnings/TokenUsageWarning";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

interface ChatInputTokenUsageProps {
  /** Current message text */
  message: string;
  /** Attached files */
  attachedFiles: FileUploadItem[];
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
  /** CSS class name for the container */
  className?: string;
}

/**
 * Component to handle token usage estimation and warnings for the chat input
 */
export const ChatInputTokenUsage: React.FC<ChatInputTokenUsageProps> = ({
  message,
  attachedFiles,
  chatId,
  assistantId,
  previousMessageId,
  chatProviderId,
  disabled = false,
  onLimitExceeded,
  estimateThreshold = 150,
  className,
}) => {
  // Use the token usage hook
  const { tokenUsageEstimation, clearEstimation, exceedsLimit } =
    useTokenUsageWithFiles({
      message,
      attachedFiles,
      chatId,
      assistantId,
      previousMessageId,
      chatProviderId,
      disabled,
      estimateThreshold,
    });

  // Notify parent when limit is exceeded
  useEffect(() => {
    if (onLimitExceeded) {
      onLimitExceeded(exceedsLimit);
    }
  }, [exceedsLimit, onLimitExceeded]);

  // Don't show anything if there's no estimation yet or if it's below threshold
  if (
    !tokenUsageEstimation ||
    (!tokenUsageEstimation.isApproachingLimit &&
      !tokenUsageEstimation.isCriticallyClose &&
      !tokenUsageEstimation.exceedsLimit)
  ) {
    return null;
  }

  return (
    <TokenUsageWarning
      estimation={tokenUsageEstimation}
      onDismiss={clearEstimation}
      className={className}
    />
  );
};
