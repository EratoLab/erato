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
  TokenUsageVirtualFile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

// Token thresholds for warnings
const WARNING_THRESHOLD = 0.85; // 85% of max tokens used
const CRITICAL_THRESHOLD = 0.95; // 95% of max tokens used

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
    assistantId?: string,
    previousMessageId?: string | null,
    inputFileIds?: string[],
    chatProviderId?: string,
    virtualFiles?: File[],
  ) => Promise<TokenUsageEstimationResult>;

  /** Estimate token usage for when a file is uploaded (with prior message context) */
  estimateTokenUsageForFiles: (
    files: FileUploadItem[],
    message: string,
    chatId?: string | null,
    assistantId?: string,
    previousMessageId?: string | null,
    chatProviderId?: string,
  ) => Promise<TokenUsageEstimationResult>;

  /** Estimate token usage with an explicit request payload (for composable endpoint usage) */
  estimateTokenUsageFromParts: (
    requestBody: Record<string, unknown>,
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
 * Stable metadata digest for cheap comparisons. Use `digestVirtualFilesContent`
 * when the digest will be used as a TanStack Query cache key.
 */
export const digestVirtualFiles = (files: File[] | undefined): string => {
  if (!files || files.length === 0) {
    return "";
  }
  return [...files]
    .map(
      (file) => `${file.name}|${file.type}|${file.size}|${file.lastModified}`,
    )
    .sort()
    .join(";");
};

/**
 * Generate a query key for token estimation
 */
export const getTokenEstimationQueryKey = (
  message: string,
  inputFileIds?: string[],
  chatId?: string | null,
  assistantId?: string,
  previousMessageId?: string | null,
  chatProviderId?: string,
  virtualFilesDigest?: string,
): readonly [
  "tokenEstimation",
  {
    message: string;
    inputFileIds: string[];
    chatId: string | null;
    assistantId: string | null;
    previousMessageId: string | null;
    chatProviderId: string | null;
    virtualFilesDigest: string;
  },
] => {
  // Normalize inputs for consistent key generation
  const normalizedMessage = message.trim();
  const sortedFileIds = inputFileIds ? [...inputFileIds].sort() : [];

  return [
    "tokenEstimation",
    {
      message: normalizedMessage,
      inputFileIds: sortedFileIds,
      chatId: chatId ?? null,
      assistantId: assistantId ?? null,
      previousMessageId: previousMessageId ?? null,
      chatProviderId: chatProviderId ?? null,
      virtualFilesDigest: virtualFilesDigest ?? "",
    },
  ];
};

/**
 * Encodes `File` bytes as standard base64. Uses `FileReader.readAsDataURL`
 * so large payloads stream through the browser's native decoder instead of
 * blowing the JS call stack via `btoa(String.fromCharCode(...))`.
 */
async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
  const commaIndex = dataUrl.indexOf(",");
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : "";
}

async function buildVirtualFilesPayload(
  files: File[],
): Promise<TokenUsageVirtualFile[]> {
  return Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      content_type: file.type || undefined,
      base64: await fileToBase64(file),
    })),
  );
}

export async function digestVirtualFilesContent(
  files: File[] | undefined,
): Promise<string> {
  if (!files || files.length === 0) {
    return "";
  }

  const parts = await Promise.all(
    files.map(async (file) => {
      const base64 = await fileToBase64(file);
      return `${file.name}|${file.type}|${file.size}|${file.lastModified}|${base64}`;
    }),
  );

  return parts.sort().join(";");
}

const getTokenEstimationQueryKeyFromParts = (
  requestBody: Record<string, unknown>,
) => ["tokenEstimation", "parts", requestBody] as const;

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
      assistantId?: string,
      previousMessageId?: string | null,
      inputFileIds?: string[],
      chatProviderId?: string,
      virtualFiles?: File[],
    ): Promise<TokenUsageEstimationResult> => {
      try {
        // Prepare request body
        const requestBody: TokenUsageRequest = {
          user_message: message,
        };

        // Add optional properties if they have values
        if (inputFileIds && inputFileIds.length > 0) {
          requestBody.input_files_ids = inputFileIds;
        }

        if (virtualFiles && virtualFiles.length > 0) {
          requestBody.virtual_files =
            await buildVirtualFilesPayload(virtualFiles);
        }

        if (chatId) {
          (requestBody as Record<string, unknown>).existing_chat_id = chatId;
        } else if (assistantId) {
          (requestBody as Record<string, unknown>).new_chat = {
            assistant_id: assistantId,
          };
        }

        if (chatProviderId) {
          requestBody.chat_provider_id = chatProviderId;
        }

        if (previousMessageId) {
          (requestBody as Record<string, unknown>).previous_message_id =
            previousMessageId;
        }

        // Generate a key after building virtual file payloads so the cache
        // reflects the actual request body, not only File metadata.
        const queryKey = getTokenEstimationQueryKey(
          message,
          inputFileIds,
          chatId,
          assistantId,
          previousMessageId,
          chatProviderId,
          requestBody.virtual_files
            ? JSON.stringify(requestBody.virtual_files)
            : undefined,
        );

        const cachedData =
          queryClient.getQueryData<TokenUsageResponse>(queryKey);

        if (cachedData) {
          return processTokenUsageResponse(cachedData);
        }

        // Call the mutation directly - the outer useQuery will handle caching
        const result = await tokenUsageMutation.mutateAsync({
          body: requestBody,
        });

        // Cache the result manually for future use
        queryClient.setQueryData(queryKey, result);

        // Process and return the result
        return processTokenUsageResponse(result);
      } catch (error) {
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
      assistantId?: string,
      previousMessageId?: string | null,
      chatProviderId?: string,
    ): Promise<TokenUsageEstimationResult> => {
      // Extract file IDs from the FileUploadItem objects
      const fileIds = files.map((file) => file.id);

      // Use the standard estimateTokenUsage function with the file IDs
      return estimateTokenUsage(
        message,
        chatId,
        assistantId,
        previousMessageId,
        fileIds,
        chatProviderId,
      );
    },
    [estimateTokenUsage],
  );

  const estimateTokenUsageFromParts = useCallback(
    async (
      requestBody: Record<string, unknown>,
    ): Promise<TokenUsageEstimationResult> => {
      try {
        const queryKey = getTokenEstimationQueryKeyFromParts(requestBody);
        const cachedData =
          queryClient.getQueryData<TokenUsageResponse>(queryKey);

        if (cachedData) {
          return processTokenUsageResponse(cachedData);
        }

        const result = await tokenUsageMutation.mutateAsync({
          body: requestBody as unknown as TokenUsageRequest,
        });

        queryClient.setQueryData(queryKey, result);
        return processTokenUsageResponse(result);
      } catch (error) {
        const errorResult: TokenUsageEstimationResult = {
          ...emptyEstimationResult,
          error: error instanceof Error ? error : new Error(String(error)),
          isLoading: false,
        };
        setLastEstimation(errorResult);
        return errorResult;
      }
    },
    [queryClient, processTokenUsageResponse, tokenUsageMutation],
  );

  /**
   * Clear the last estimation result and invalidate relevant queries
   */
  const clearLastEstimation = useCallback(() => {
    // Clear the state
    setLastEstimation(null);

    // Drop manually cached estimates so a subsequent check cannot reuse them.
    queryClient.removeQueries({
      queryKey: ["tokenEstimation"],
    });
  }, [queryClient]);

  return {
    estimateTokenUsage,
    estimateTokenUsageForFiles,
    estimateTokenUsageFromParts,
    lastEstimation,
    clearLastEstimation,
    isLoading: tokenUsageMutation.isPending,
  };
}
