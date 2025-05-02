/**
 * Hook for handling file uploads with token usage checking
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  useTokenUsageEstimation,
  getTokenEstimationQueryKey,
} from "@/hooks/chat/useTokenUsageEstimation";

import { useFileDropzone } from "./useFileDropzone";

import type { TokenUsageEstimationResult } from "@/hooks/chat/useTokenUsageEstimation";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

interface UseFileUploadWithTokenCheckOptions {
  /** Current message text to use for token estimation */
  message: string;
  /** Current chat ID */
  chatId?: string | null;
  /** Previous message ID */
  previousMessageId?: string | null;
  /** Callback when files are successfully uploaded */
  onFilesUploaded?: (files: FileUploadItem[]) => void;
  /** Array of accepted file types */
  acceptedFileTypes?: FileType[];
  /** Whether multiple files can be selected */
  multiple?: boolean;
  /** Maximum number of files allowed */
  maxFiles?: number;
  /** Whether the upload is disabled */
  disabled?: boolean;
}

interface UseFileUploadWithTokenCheckResult {
  /** Upload files with token usage checking */
  uploadFiles: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Files that have been uploaded */
  uploadedFiles: FileUploadItem[];
  /** Whether files are currently being uploaded */
  isUploading: boolean;
  /** Error from file upload */
  uploadError: Error | string | null;
  /** Clear uploaded files */
  clearFiles: () => void;
  /** Token usage estimation result after upload */
  tokenUsageEstimation: TokenUsageEstimationResult | null;
  /** Whether a token estimation is in progress */
  isEstimating: boolean;
  /** Does the usage exceed the token limit */
  exceedsTokenLimit: boolean;
}

/**
 * Hook that combines file upload with token usage checking
 */
export function useFileUploadWithTokenCheck({
  message,
  chatId,
  previousMessageId,
  onFilesUploaded,
  acceptedFileTypes = [],
  multiple = false,
  maxFiles = 5,
  disabled = false,
}: UseFileUploadWithTokenCheckOptions): UseFileUploadWithTokenCheckResult {
  // Use the query client for cache operations
  const queryClient = useQueryClient();

  // Use the file upload hook
  const {
    uploadFiles: baseUploadFiles,
    uploadedFiles,
    isUploading,
    error: uploadError,
    clearFiles,
  } = useFileDropzone({
    acceptedFileTypes,
    multiple,
    maxFiles,
    disabled,
    onFilesUploaded,
    chatId,
  });

  // Use the token usage estimation hook
  const {
    estimateTokenUsageForFiles,
    clearLastEstimation,
    lastEstimation,
    isLoading: isEstimating,
  } = useTokenUsageEstimation();

  // Combine upload with token checking using React Query
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (disabled || isUploading) {
        return;
      }

      try {
        // First, upload the files
        const uploadedItems = await baseUploadFiles(files);

        if (uploadedItems && uploadedItems.length > 0) {
          // Get the file IDs for the query key
          const uploadedFileIds = uploadedItems.map((file) => file.id);

          // Generate the query key for this estimation
          const queryKey = getTokenEstimationQueryKey(
            message,
            uploadedFileIds,
            chatId,
            previousMessageId,
          );

          // Check if we already have a recent estimation in the cache
          const cachedEstimation = queryClient.getQueryData(queryKey);

          if (!cachedEstimation) {
            console.log(
              "[FILE_UPLOAD_TOKEN_CHECK] No cached estimation, requesting new one",
            );

            // Perform estimation and update the cache
            const messageForEstimation = message || " ";
            await estimateTokenUsageForFiles(
              uploadedItems,
              messageForEstimation,
              chatId,
              previousMessageId,
            );
          } else {
            console.log(
              "[FILE_UPLOAD_TOKEN_CHECK] Using cached token estimation",
            );
          }
        }

        return uploadedItems;
      } catch (error) {
        console.error("Error in file upload with token check:", error);
        if (!(error instanceof Error && error.message.includes("token"))) {
          clearLastEstimation();
        }
        return undefined;
      }
    },
    [
      disabled,
      isUploading,
      baseUploadFiles,
      message,
      estimateTokenUsageForFiles,
      chatId,
      previousMessageId,
      clearLastEstimation,
      queryClient,
    ],
  );

  return {
    uploadFiles,
    uploadedFiles,
    isUploading,
    uploadError,
    clearFiles,
    tokenUsageEstimation: lastEstimation,
    isEstimating,
    exceedsTokenLimit: lastEstimation?.exceedsLimit ?? false,
  };
}
