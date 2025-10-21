/**
 * Hook to integrate token usage estimation with file uploads
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useDebouncedCallback } from "use-debounce";

import {
  useTokenUsageEstimation,
  getTokenEstimationQueryKey,
} from "./useTokenUsageEstimation";

import type { TokenUsageEstimationResult } from "./useTokenUsageEstimation";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface UseTokenUsageWithFilesOptions {
  /** Current message text */
  message: string;
  /** Attached files */
  attachedFiles: FileUploadItem[];
  /** Current chat ID */
  chatId?: string | null;
  /** Previous message ID */
  previousMessageId?: string | null;
  /** Is the input disabled (stops estimation) */
  disabled?: boolean;
  /** Character threshold before triggering token estimation (default: 150) */
  estimateThreshold?: number;
  /** Debounce delay in ms (default: 500) */
  debounceDelay?: number;
}

interface UseTokenUsageWithFilesResult {
  /** Whether a token estimation is in progress */
  isEstimating: boolean;
  /** Token usage estimation result */
  tokenUsageEstimation: TokenUsageEstimationResult | null;
  /** Manually trigger a token estimation */
  checkTokenUsage: () => Promise<TokenUsageEstimationResult | null>;
  /** Clear the current estimation result */
  clearEstimation: () => void;
  /** Does the usage exceed the limit? */
  exceedsLimit: boolean;
}

/**
 * Hook to handle token usage estimation with file uploads
 */
export function useTokenUsageWithFiles({
  message,
  attachedFiles,
  chatId,
  previousMessageId,
  disabled = false,
  estimateThreshold = 150,
  debounceDelay = 500,
}: UseTokenUsageWithFilesOptions): UseTokenUsageWithFilesResult {
  // Get token usage estimation utilities
  const {
    estimateTokenUsage,
    lastEstimation,
    clearLastEstimation,
    isLoading: estimationLoading,
  } = useTokenUsageEstimation();

  // Extract file IDs for query
  const fileIds = attachedFiles.map((file) => file.id);
  const shouldEstimate =
    !disabled && (message.length >= estimateThreshold || fileIds.length > 0);

  // Use React Query to handle estimation with proper caching
  const {
    data: queryEstimation,
    isLoading: queryLoading,
    refetch,
  } = useQuery({
    queryKey: getTokenEstimationQueryKey(
      message,
      fileIds.length > 0 ? fileIds : undefined,
      chatId,
      previousMessageId,
    ),
    queryFn: async () => {
      if (!shouldEstimate) {
        return null;
      }

      return estimateTokenUsage(
        message,
        chatId,
        previousMessageId,
        fileIds.length > 0 ? fileIds : undefined,
      );
    },
    enabled: shouldEstimate,
    staleTime: 2000, // Match the settings from useTokenUsageEstimation
    gcTime: 30000,
  });

  // Combined loading state
  const isEstimating = estimationLoading || queryLoading;

  // Debounced function to trigger refetch (rather than direct API call)
  const debouncedCheckTokens = useDebouncedCallback(() => {
    if (shouldEstimate) {
      void refetch();
    }
  }, debounceDelay);

  // Function to manually trigger a token usage check
  const checkTokenUsage = useCallback(async () => {
    if (disabled) {
      return null;
    }

    return estimateTokenUsage(
      message,
      chatId,
      previousMessageId,
      fileIds.length > 0 ? fileIds : undefined,
    );
  }, [
    disabled,
    fileIds,
    estimateTokenUsage,
    message,
    chatId,
    previousMessageId,
  ]);

  // Function to clear the current estimation
  const clearEstimation = useCallback(() => {
    clearLastEstimation();
  }, [clearLastEstimation]);

  // Effect to trigger estimation when message or files change
  useEffect(() => {
    if (!shouldEstimate) {
      return;
    }
    debouncedCheckTokens();

    // Cancel debounced function on cleanup
    return () => {
      debouncedCheckTokens.cancel();
    };
  }, [
    message,
    fileIds.length, // Only depend on length, not the full array
    shouldEstimate,
    debouncedCheckTokens,
  ]);

  return {
    isEstimating,
    // Only use lastEstimation as fallback if we should be estimating
    // Otherwise, return null to clear any previous warnings
    tokenUsageEstimation: shouldEstimate
      ? (queryEstimation ?? lastEstimation)
      : null,
    checkTokenUsage,
    clearEstimation,
    exceedsLimit: shouldEstimate
      ? ((queryEstimation ?? lastEstimation)?.exceedsLimit ?? false)
      : false,
  };
}
