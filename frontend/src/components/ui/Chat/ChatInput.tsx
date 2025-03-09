import { ArrowUpIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import React, { useState, useRef, useEffect, useCallback } from "react";

import { useChat } from "@/components/containers/ChatProvider";
import {
  FileUploadButton,
  FilePreviewButton,
} from "@/components/ui/FileUpload";

import { Button } from "../Controls/Button";
import { Tooltip } from "../Controls/Tooltip";
import { Alert } from "../Feedback/Alert";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onRegenerate?: () => void;
  handleFileAttachments?: (files: FileUploadItem[]) => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  showControls?: boolean;
  /** Limit the total number of files that can be attached */
  maxFiles?: number;
  /** Array of accepted file types, or empty for all enabled types */
  acceptedFileTypes?: FileType[];
  /** Initial files to display (optional) */
  initialFiles?: FileUploadItem[];
  /** Show file type in previews */
  showFileTypes?: boolean;
  /** File upload function provided by the ChatProvider */
  performFileUpload?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Whether files are currently being uploaded */
  isUploading?: boolean;
  /** Any error that occurred during upload */
  uploadError?: Error | null;
}

/**
 * ChatInput component with file attachment capabilities
 */
export const ChatInput = ({
  onSendMessage,
  onRegenerate,
  handleFileAttachments,
  isLoading = false,
  disabled = false,
  className = "",
  placeholder = "Type a message...",
  maxLength = 2000,
  showControls = true,
  maxFiles = 5,
  acceptedFileTypes = [],
  initialFiles = [],
  showFileTypes = false,
  performFileUpload,
  isUploading,
  uploadError,
}: ChatInputProps) => {
  const [message, setMessage] = useState("");
  const [attachedFiles, setAttachedFiles] =
    useState<FileUploadItem[]>(initialFiles);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Get file upload functionality from ChatProvider
  const {
    performFileUpload: chatProviderPerformFileUpload,
    isUploadingFiles,
    uploadError: chatProviderUploadError,
  } = useChat();

  // Handle form submission for sending a message
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (
        (message.trim() || attachedFiles.length > 0) &&
        !isLoading &&
        !disabled
      ) {
        onSendMessage(message.trim());
        setMessage("");
        // Keep attachments after sending message to allow for additional messages with the same files
        // Files will be cleared when a new chat is started or reset function is called
      }
    },
    [message, attachedFiles.length, isLoading, disabled, onSendMessage],
  );

  // Handle files uploaded via the enhanced FileUpload component
  const handleFilesUploaded = useCallback(
    (files: FileUploadItem[]) => {
      console.log("handleFilesUploaded");
      setFileError(null);
      setUploadInProgress(false);

      // Limit to max files
      const trimmedFiles = files.slice(0, maxFiles);

      // Update state
      setAttachedFiles(trimmedFiles);

      // Notify parent component
      if (handleFileAttachments) {
        handleFileAttachments(trimmedFiles);
      }
    },
    [maxFiles, handleFileAttachments],
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
          if (handleFileAttachments) {
            handleFileAttachments(updated);
          }

          return updated;
        });

        setFileError(null);
      }
    },
    [handleFileAttachments],
  );

  // Remove all files
  const handleRemoveAllFiles = useCallback(() => {
    setAttachedFiles([]);

    // Notify parent component
    if (handleFileAttachments) {
      handleFileAttachments([]);
    }

    setFileError(null);
  }, [handleFileAttachments]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  // Handle file upload error if any
  useEffect(() => {
    if (chatProviderUploadError) {
      setFileError(`File upload error: ${chatProviderUploadError.message}`);
      setUploadInProgress(false);
    }
  }, [chatProviderUploadError]);

  // Update upload progress tracking from provider's state
  useEffect(() => {
    setUploadInProgress(isUploadingFiles);
  }, [isUploadingFiles]);

  // Determine if send button should be enabled
  const canSendMessage =
    (message.trim() || attachedFiles.length > 0) &&
    !isLoading &&
    !disabled &&
    !uploadInProgress;

  return (
    <form
      className={clsx("mx-auto mb-4 w-full sm:w-5/6 md:w-4/5", className)}
      onSubmit={handleSubmit}
    >
      {/* File previews */}
      {attachedFiles.length > 0 && (
        <div className="mb-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-[var(--theme-fg-secondary)]">
              Attachments ({attachedFiles.length}/{maxFiles})
            </h3>
            {attachedFiles.length > 1 && (
              <Tooltip content="Remove all files">
                <Button
                  onClick={handleRemoveAllFiles}
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  aria-label="Remove all attachments"
                >
                  Remove all
                </Button>
              </Tooltip>
            )}
          </div>

          {/* File attachments */}
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file) => (
              <FilePreviewButton
                key={file.id}
                file={file}
                onRemove={handleRemoveFile}
                disabled={uploadInProgress || isLoading || disabled}
                showFileType={showFileTypes}
                showSize={true}
                filenameTruncateLength={25}
              />
            ))}
          </div>
        </div>
      )}

      {/* File error message */}
      {fileError && (
        <Alert
          type="error"
          dismissible
          onDismiss={() => setFileError(null)}
          className="mb-2"
        >
          {fileError}
        </Alert>
      )}

      <div
        className={clsx(
          "w-full rounded-2xl bg-[var(--theme-bg-tertiary)]",
          "p-2 sm:p-3",
          "shadow-[0_0_15px_rgba(0,0,0,0.1)]",
          "border border-[var(--theme-border)]",
          "theme-transition focus-within:border-[var(--theme-border-focus)]",
          "flex flex-col gap-2 sm:gap-3",
        )}
      >
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={1}
          disabled={isLoading || disabled || uploadInProgress}
          className={clsx(
            "w-full resize-none overflow-hidden",
            "p-2 sm:px-3",
            "bg-transparent",
            "text-[var(--theme-fg-primary)] placeholder:text-[var(--theme-fg-muted)]",
            "focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "max-h-[200px] min-h-[32px]",
            "text-base",
          )}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 sm:gap-2">
            {showControls && (
              <>
                {/* File Upload Button */}
                {handleFileAttachments && (
                  <FileUploadButton
                    onFilesUploaded={(files) => {
                      setUploadInProgress(true);
                      handleFilesUploaded(files);
                    }}
                    acceptedFileTypes={acceptedFileTypes}
                    multiple={maxFiles > 1}
                    iconOnly
                    className="p-1"
                    disabled={
                      attachedFiles.length >= maxFiles ||
                      isLoading ||
                      disabled ||
                      uploadInProgress
                    }
                    performFileUpload={
                      performFileUpload ?? chatProviderPerformFileUpload
                    }
                    isUploading={isUploading ?? isUploadingFiles}
                    uploadError={uploadError ?? chatProviderUploadError}
                  />
                )}

                <Tooltip content="Regenerate response">
                  <Button
                    onClick={onRegenerate}
                    variant="icon-only"
                    size="sm"
                    icon={<ArrowPathIcon className="size-5" />}
                    aria-label="Regenerate response"
                    disabled={isLoading || disabled || uploadInProgress}
                  />
                </Tooltip>
              </>
            )}
          </div>

          <Button
            type="submit"
            variant="secondary"
            size="sm"
            icon={<ArrowUpIcon className="size-5" />}
            disabled={!canSendMessage}
            aria-label="Send message"
          />
        </div>
      </div>
    </form>
  );
};
