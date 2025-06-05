/**
 * Hook for estimating token usage for messages and files
 *
 * This hook provides methods to check if files or messages would exceed
 * token limits before sending them to the API.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useTokenUsageEstimate } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  TokenUsageResponse,
  TokenUsageStats,
  FileUploadItem,
  TokenUsageRequest,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

// Token thresholds for warnings
const WARNING_THRESHOLD = 0.85; // 85% of max tokens used
const CRITICAL_THRESHOLD = 0.95; // 95% of max tokens used

// Query stale/cache times for token estimations
const TOKEN_ESTIMATE_STALE_TIME = 2000; // Consider results valid for 2 seconds
const TOKEN_ESTIMATE_CACHE_TIME = 30000; // Cache for 30 seconds

export interface TokenUsageEstimationResult {
  /** Full token usage response from the API */
  tokenUsage: TokenUsageResponse | null;
  /** Is the estimation currently loading */
  isLoading: boolean;
  /** Error occurred during estimation */
  error: Error | null;
  /** Is the token usage approaching the limit (85% or more) */
  isApproachingLimit: boolean;
  /** Is the token usage critically close to the limit (95% or more) */
  isCriticallyClose: boolean;
  /** Percentage of max tokens used (0-1) */
  usagePercentage: number;
  /** Exceeds the maximum token limit */
  exceedsLimit: boolean;
}

export interface UseTokenUsageEstimationReturn {
  /** Estimate token usage for a message with optional files */
  estimateTokenUsage: (
    message: string,
    chatId?: string | null,
    previousMessageId?: string | null,
    inputFileIds?: string[],
  ) => Promise<TokenUsageEstimationResult>;

  /** Estimate token usage for when a file is uploaded (with prior message context) */
  estimateTokenUsageForFiles: (
    files: FileUploadItem[],
    message: string,
    chatId?: string | null,
    previousMessageId?: string | null,
  ) => Promise<TokenUsageEstimationResult>;

  /** Most recent estimation result */
  lastEstimation: TokenUsageEstimationResult | null;

  /** Clear the last estimation result */
  clearLastEstimation: () => void;

  /** Is an estimation currently loading */
  isLoading: boolean;
}

/**
 * Default empty estimation result
 */
const emptyEstimationResult: Omit<TokenUsageEstimationResult, "isLoading"> = {
  tokenUsage: null,
  error: null,
  isApproachingLimit: false,
  isCriticallyClose: false,
  usagePercentage: 0,
  exceedsLimit: false,
};

/**
 * Generate a query key for token estimation
 */
export const getTokenEstimationQueryKey = (
  message: string,
  inputFileIds?: string[],
  chatId?: string | null,
  previousMessageId?: string | null,
): string[] => {
  // Normalize inputs for consistent key generation
  const normalizedMessage = message.trim();
  const sortedFileIds = inputFileIds ? [...inputFileIds].sort().join(",") : "";

  return [
    "tokenEstimation",
    normalizedMessage,
    sortedFileIds,
    chatId ?? "",
    previousMessageId ?? "",
  ];
};

/**
 * Hook for estimating token usage for messages and files
 */
export function useTokenUsageEstimation(): UseTokenUsageEstimationReturn {
  const [lastEstimation, setLastEstimation] =
    useState<TokenUsageEstimationResult | null>(null);

  // Access the query client for manual operations
  const queryClient = useQueryClient();

  // Use the generated mutation hook for lower-level access
  const tokenUsageMutation = useTokenUsageEstimate();

  /**
   * Process the token usage response and calculate warning flags
   */
  const processTokenUsageResponse = useCallback(
    (response: TokenUsageResponse): TokenUsageEstimationResult => {
      const stats: TokenUsageStats = response.stats;
      const totalTokens = stats.total_tokens;
      const maxTokens = stats.max_tokens;
      const remainingTokens = stats.remaining_tokens;

      // Calculate percentage of max tokens used
      const usagePercentage = totalTokens / maxTokens;

      // Determine warning flags
      const isApproachingLimit = usagePercentage >= WARNING_THRESHOLD;
      const isCriticallyClose = usagePercentage >= CRITICAL_THRESHOLD;
      const exceedsLimit = remainingTokens <= 0;

      const result = {
        tokenUsage: response,
        isLoading: false,
        error: null,
        isApproachingLimit,
        isCriticallyClose,
        usagePercentage,
        exceedsLimit,
      };

      // Update the last estimation state
      setLastEstimation(result);

      return result;
    },
    [],
  );

  /**
   * Estimate token usage for a message with optional files.
   * This function now prefetchs or leverages React Query caching.
   */
  const estimateTokenUsage = useCallback(
    async (
      message: string,
      chatId?: string | null,
      previousMessageId?: string | null,
      inputFileIds?: string[],
    ): Promise<TokenUsageEstimationResult> => {
      try {
        // Generate a proper query key
        const queryKey = getTokenEstimationQueryKey(
          message,
          inputFileIds,
          chatId,
          previousMessageId,
        );

        // Log the estimation request for debugging
        console.log(
          "[TOKEN_ESTIMATION] Requesting estimation for:",
          message.substring(0, 20) + (message.length > 20 ? "..." : ""),
          "with files:",
          inputFileIds?.length ?? 0,
        );

        // Check if we already have cached data
        const cachedData =
          queryClient.getQueryData<TokenUsageResponse>(queryKey);

        if (cachedData) {
          console.log("[TOKEN_ESTIMATION] Using cached estimation");
          return processTokenUsageResponse(cachedData);
        }

        // Prepare request body
        const requestBody: TokenUsageRequest = {
          user_message: message,
        };

        // Add optional properties if they have values
        if (inputFileIds && inputFileIds.length > 0) {
          requestBody.input_files_ids = inputFileIds;
        }

        if (chatId) {
          (requestBody as Record<string, unknown>).existing_chat_id = chatId;
        }

        if (previousMessageId) {
          (requestBody as Record<string, unknown>).previous_message_id =
            previousMessageId;
        }

        // Fetch using React Query's prefetchQuery to leverage caching
        const result = await queryClient.fetchQuery({
          queryKey,
          queryFn: async () => {
            console.log("[TOKEN_ESTIMATION] Fetching estimation from API");
            return tokenUsageMutation.mutateAsync({
              body: requestBody,
            });
          },
          staleTime: TOKEN_ESTIMATE_STALE_TIME,
          gcTime: TOKEN_ESTIMATE_CACHE_TIME,
        });

        // Process and return the result
        return processTokenUsageResponse(result);
      } catch (error) {
        // Handle errors
        console.error(
          "[TOKEN_ESTIMATION] Error estimating token usage:",
          error,
        );
        const errorResult: TokenUsageEstimationResult = {
          ...emptyEstimationResult,
          error: error instanceof Error ? error : new Error(String(error)),
          isLoading: false,
        };
        setLastEstimation(errorResult);
        return errorResult;
      }
    },
    [queryClient, tokenUsageMutation, processTokenUsageResponse],
  );

  /**
   * Estimate token usage for when a file is uploaded (with prior message context)
   */
  const estimateTokenUsageForFiles = useCallback(
    async (
      files: FileUploadItem[],
      message: string,
      chatId?: string | null,
      previousMessageId?: string | null,
    ): Promise<TokenUsageEstimationResult> => {
      // Extract file IDs from the FileUploadItem objects
      const fileIds = files.map((file) => file.id);

      // Use the standard estimateTokenUsage function with the file IDs
      return estimateTokenUsage(message, chatId, previousMessageId, fileIds);
    },
    [estimateTokenUsage],
  );

  /**
   * Clear the last estimation result and invalidate relevant queries
   */
  const clearLastEstimation = useCallback(() => {
    // Clear the state
    setLastEstimation(null);

    // Invalidate all token estimation queries to force refetching
    void queryClient.invalidateQueries({
      queryKey: ["tokenEstimation"],
    });
  }, [queryClient]);

  return {
    estimateTokenUsage,
    estimateTokenUsageForFiles,
    lastEstimation,
    clearLastEstimation,
    isLoading: lastEstimation?.isLoading ?? tokenUsageMutation.isPending,
  };
}
