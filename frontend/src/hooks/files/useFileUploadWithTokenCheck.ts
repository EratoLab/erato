/**
 * Hook for handling file uploads with token usage checking
 */
import { useCallback } from "react";

import { createLogger } from "@/utils/debugLogger";

import { useFileDropzone } from "./useFileDropzone";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

const logger = createLogger("HOOK", "useFileUploadWithTokenCheck");

interface UseFileUploadWithTokenCheckOptions {
  /** Current message text to use for token estimation */
  message: string;
  /** Current chat ID */
  chatId?: string | null;
  /** Optional assistant ID to associate with a silently created chat */
  assistantId?: string;
  /** Previous message ID */
  previousMessageId?: string | null;
  /** Selected chat provider ID for new chats */
  chatProviderId?: string;
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
  tokenUsageEstimation: null;
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
  assistantId,
  previousMessageId,
  chatProviderId,
  onFilesUploaded,
  acceptedFileTypes = [],
  multiple = false,
  maxFiles = 5,
  disabled = false,
}: UseFileUploadWithTokenCheckOptions): UseFileUploadWithTokenCheckResult {
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
    assistantId,
    chatProviderId,
  });

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (disabled || isUploading) {
        return;
      }

      try {
        // First, upload the files
        const uploadedItems = await baseUploadFiles(files);

        return uploadedItems;
      } catch (error) {
        logger.error("Error in file upload with token check:", error);
        return undefined;
      }
    },
    [disabled, isUploading, baseUploadFiles],
  );

  return {
    uploadFiles,
    uploadedFiles,
    isUploading,
    uploadError,
    clearFiles,
    tokenUsageEstimation: null,
    isEstimating: false,
    exceedsTokenLimit: false,
  };
}
