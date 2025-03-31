import { ArrowUpIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import React, { useState, useRef, useEffect } from "react";

import {
  FileUploadButton,
  FilePreviewButton,
} from "@/components/ui/FileUpload";

import { Button } from "../Controls/Button";
import { Tooltip } from "../Controls/Tooltip";
import { Alert } from "../Feedback/Alert";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

import { useChat } from "@/components/containers/ChatProvider";
import { useChatInputHandlers } from "@/hooks/useChatInputHandlers";

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [uploadInProgress, setUploadInProgress] = useState(false);

  // Get file upload functionality from ChatProvider
  const {
    performFileUpload: chatProviderPerformFileUpload,
    isUploadingFiles,
    uploadError: chatProviderUploadError,
  } = useChat();

  // Use the custom hook for file handling
  const {
    attachedFiles,
    fileError,
    setFileError,
    handleFilesUploaded,
    handleRemoveFile,
    handleRemoveAllFiles,
    createSubmitHandler,
  } = useChatInputHandlers(maxFiles, handleFileAttachments, initialFiles);

  // Create the submit handler
  const handleSubmit = createSubmitHandler(
    message,
    onSendMessage,
    isLoading,
    disabled,
    () => setMessage(""),
  );

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
  }, [chatProviderUploadError, setFileError]);

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
