import { useState, useCallback } from "react";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Hook for managing file attachments in the chat input
 */
export function useChatInputHandlers(
  maxFiles: number,
  onFileAttachmentsChange?: (files: FileUploadItem[]) => void,
  initialFiles: FileUploadItem[] = [],
) {
  const [attachedFiles, setAttachedFiles] =
    useState<FileUploadItem[]>(initialFiles);
  const [fileError, setFileError] = useState<string | null>(null);

  // Handle files uploaded via the enhanced FileUpload component
  const handleFilesUploaded = useCallback(
    (files: FileUploadItem[]) => {
      setFileError(null);

      // Limit to max files
      const trimmedFiles = files.slice(0, maxFiles);

      // Update state
      setAttachedFiles(trimmedFiles);

      // Notify parent component
      if (onFileAttachmentsChange) {
        onFileAttachmentsChange(trimmedFiles);
      }
    },
    [maxFiles, onFileAttachmentsChange],
  );

  // Remove a single file
  const handleRemoveFile = useCallback(
    (fileIdOrFile: string | File) => {
      // We expect a string fileId in this context
      if (typeof fileIdOrFile === "string") {
        const fileId = fileIdOrFile;

        setAttachedFiles((prev) => {
          const updated = prev.filter((file) => file.id !== fileId);

          // Notify parent component
          if (onFileAttachmentsChange) {
            onFileAttachmentsChange(updated);
          }

          return updated;
        });

        setFileError(null);
      }
    },
    [onFileAttachmentsChange],
  );

  // Remove all files
  const handleRemoveAllFiles = useCallback(() => {
    setAttachedFiles([]);

    // Notify parent component
    if (onFileAttachmentsChange) {
      onFileAttachmentsChange([]);
    }

    setFileError(null);
  }, [onFileAttachmentsChange]);

  // Submit handler for chat messages
  const createSubmitHandler = useCallback(
    (
      message: string,
      onSendMessage: (message: string) => void,
      isLoading: boolean,
      disabled: boolean,
      clearMessage: () => void,
    ) =>
      (e: React.FormEvent) => {
        e.preventDefault();
        if (
          (message.trim() || attachedFiles.length > 0) &&
          !isLoading &&
          !disabled
        ) {
          onSendMessage(message.trim());
          clearMessage();
          // Clear attachments after sending message - files are now part of the message
          setAttachedFiles([]);
          // Notify parent component that files have been cleared
          if (onFileAttachmentsChange) {
            onFileAttachmentsChange([]);
          }
        }
      },
    [attachedFiles.length, onFileAttachmentsChange],
  );

  return {
    attachedFiles,
    setAttachedFiles,
    fileError,
    setFileError,
    handleFilesUploaded,
    handleRemoveFile,
    handleRemoveAllFiles,
    createSubmitHandler,
  };
}
