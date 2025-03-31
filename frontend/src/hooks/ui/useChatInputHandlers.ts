/**
 * Hook for handling chat input functionality
 *
 * This hook encapsulates the logic for the chat input component,
 * including file attachment management and form submission.
 */
import { useState, useCallback } from "react";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FormEvent } from "react";

interface UseChatInputHandlersResult {
  /** Currently attached files */
  attachedFiles: FileUploadItem[];
  /** Any error related to file handling */
  fileError: string | null;
  /** Set file error message */
  setFileError: (error: string | null) => void;
  /** Handle files that have been uploaded */
  handleFilesUploaded: (files: FileUploadItem[]) => void;
  /** Handle removing a specific file */
  handleRemoveFile: (fileIdOrFile: string | FileUploadItem) => void;
  /** Handle removing all files */
  handleRemoveAllFiles: () => void;
  /** Factory function to create a submit handler with the current state */
  createSubmitHandler: (
    message: string,
    onSendMessage: (message: string) => void,
    isLoading: boolean,
    disabled: boolean,
    resetMessage: () => void,
  ) => (e: FormEvent) => void;
}

/**
 * Hook for managing chat input state and handlers
 */
export function useChatInputHandlers(
  maxFiles: number = 5,
  handleFileAttachments?: (files: FileUploadItem[]) => void,
  initialFiles: FileUploadItem[] = [],
): UseChatInputHandlersResult {
  const [attachedFiles, setAttachedFiles] =
    useState<FileUploadItem[]>(initialFiles);
  const [fileError, setFileError] = useState<string | null>(null);

  // Handle uploaded files
  const handleFilesUploaded = useCallback(
    (files: FileUploadItem[]) => {
      setAttachedFiles((prevFiles) => {
        // Limit to maxFiles
        const combinedFiles = [...prevFiles, ...files];
        const limitedFiles = combinedFiles.slice(0, maxFiles);

        // Notify parent component if handler provided
        if (handleFileAttachments) {
          handleFileAttachments(limitedFiles);
        }

        return limitedFiles;
      });
    },
    [maxFiles, handleFileAttachments],
  );

  // Handle removing a file
  const handleRemoveFile = useCallback(
    (fileIdOrFile: string | FileUploadItem) => {
      const fileId =
        typeof fileIdOrFile === "string" ? fileIdOrFile : fileIdOrFile.id;

      setAttachedFiles((prevFiles) => {
        const updatedFiles = prevFiles.filter((file) => file.id !== fileId);

        // Notify parent component if handler provided
        if (handleFileAttachments) {
          handleFileAttachments(updatedFiles);
        }

        return updatedFiles;
      });
    },
    [handleFileAttachments],
  );

  // Handle removing all files
  const handleRemoveAllFiles = useCallback(() => {
    setAttachedFiles([]);

    // Notify parent component if handler provided
    if (handleFileAttachments) {
      handleFileAttachments([]);
    }
  }, [handleFileAttachments]);

  // Create a submit handler with current state
  const createSubmitHandler = useCallback(
    (
      message: string,
      onSendMessage: (message: string) => void,
      isLoading: boolean,
      disabled: boolean,
      resetMessage: () => void,
    ) => {
      return (e: FormEvent) => {
        e.preventDefault();

        // Don't submit if loading or disabled
        if (isLoading || disabled) {
          return;
        }

        // Check if there's a message to send
        const trimmedMessage = message.trim();
        if (trimmedMessage) {
          onSendMessage(trimmedMessage);
          resetMessage();
        }
      };
    },
    [],
  );

  return {
    attachedFiles,
    fileError,
    setFileError,
    handleFilesUploaded,
    handleRemoveFile,
    handleRemoveAllFiles,
    createSubmitHandler,
  };
}
