/**
 * Hook for handling file uploads with token usage checking
 */
import { useCallback, useEffect, useRef } from "react";

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

  // Stable identity for `uploadFiles`. `baseUploadFiles` and `isUploading`
  // both flip on every upload, so a naive `useCallback` would hand consumers
  // a fresh function reference after every upload — which silently breaks
  // any consumer that lists `uploadFiles` in a `useEffect` / `useCallback`
  // dep array (it re-fires their effect, which can re-trigger the upload,
  // which flips the state again — an unbounded loop). Reading the latest
  // values via a ref keeps the public-API identity stable across renders
  // while still using up-to-date state when called.
  const latestRef = useRef({ disabled, isUploading, baseUploadFiles });
  useEffect(() => {
    latestRef.current = { disabled, isUploading, baseUploadFiles };
  });

  const uploadFiles = useCallback(async (files: File[]) => {
    const {
      disabled: latestDisabled,
      isUploading: latestIsUploading,
      baseUploadFiles: latestBaseUploadFiles,
    } = latestRef.current;
    if (latestDisabled || latestIsUploading) {
      return;
    }

    try {
      const uploadedItems = await latestBaseUploadFiles(files);
      return uploadedItems;
    } catch (error) {
      logger.error("Error in file upload with token check:", error);
      return undefined;
    }
  }, []);

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
