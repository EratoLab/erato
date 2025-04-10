import { ArrowUpIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import React, { useState, useRef, useEffect } from "react";

import {
  FileUploadButton,
  FilePreviewButton,
} from "@/components/ui/FileUpload";
import { useFileDropzone } from "@/hooks/files";
import { useChatInputHandlers } from "@/hooks/ui";
import { useChatContext } from "@/providers/ChatProvider";

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
}

/**
 * ChatInput component with file attachment capabilities
 */
export const ChatInput = ({
  onSendMessage,
  onRegenerate,
  handleFileAttachments,
  isLoading: propIsLoading,
  disabled = false,
  className = "",
  placeholder = "Type a message...",
  maxLength = 2000,
  showControls = true,
  maxFiles = 5,
  acceptedFileTypes = [],
  initialFiles = [],
  showFileTypes = false,
}: ChatInputProps) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Get necessary state from context instead of useChat()
  const { isStreaming, isMessagingLoading, isUploading } = useChatContext();

  // Combine loading states
  const isLoading = propIsLoading ?? isMessagingLoading;

  // Use our modernized file upload hook
  const {
    uploadFiles,
    uploadedFiles,
    error: uploadError,
  } = useFileDropzone({
    acceptedFileTypes,
    multiple: maxFiles > 1,
    maxFiles,
    disabled,
    onFilesUploaded: handleFileAttachments,
  });

  // Use the custom hook for chat input handling
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
    (messageContent) => {
      console.log(
        "[CHAT_FLOW] ChatInput - Message submitted:",
        messageContent.substring(0, 20) +
          (messageContent.length > 20 ? "..." : ""),
      );
      onSendMessage(messageContent);
    },
    isLoading || isStreaming,
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
    if (uploadError && uploadError instanceof Error) {
      setFileError(`File upload error: ${uploadError.message}`);
    } else if (uploadError && typeof uploadError === "string") {
      setFileError(`File upload error: ${uploadError}`);
    }
  }, [uploadError, setFileError]);

  // Determine if send button should be enabled
  const canSendMessage =
    (message.trim() || attachedFiles.length > 0) &&
    !isLoading &&
    !isStreaming &&
    !disabled &&
    !isUploading;

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
                onRemove={(fileIdOrFile) => {
                  if (typeof fileIdOrFile === "string") {
                    handleRemoveFile(fileIdOrFile);
                  } else if (
                    fileIdOrFile &&
                    typeof fileIdOrFile === "object" &&
                    "id" in fileIdOrFile &&
                    typeof fileIdOrFile.id === "string"
                  ) {
                    handleRemoveFile(fileIdOrFile.id);
                  }
                }}
                disabled={isUploading || isLoading || isStreaming || disabled}
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
          disabled={isLoading || isStreaming || disabled || isUploading}
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
                      handleFilesUploaded(files);
                    }}
                    acceptedFileTypes={acceptedFileTypes}
                    multiple={maxFiles > 1}
                    iconOnly
                    className="p-1"
                    disabled={
                      attachedFiles.length >= maxFiles ||
                      isLoading ||
                      isStreaming ||
                      disabled ||
                      isUploading
                    }
                    // Use our modern file upload hook with proper typing
                    performFileUpload={async (files) => {
                      await uploadFiles(files);
                      // Return the currently uploaded files directly
                      return uploadedFiles;
                    }}
                    isUploading={isUploading}
                    uploadError={
                      uploadError instanceof Error ? uploadError : null
                    }
                  />
                )}

                <Tooltip content="Regenerate response">
                  <Button
                    onClick={onRegenerate}
                    variant="icon-only"
                    size="sm"
                    icon={<ArrowPathIcon className="size-5" />}
                    aria-label="Regenerate response"
                    disabled={
                      isLoading || isStreaming || disabled || isUploading
                    }
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
