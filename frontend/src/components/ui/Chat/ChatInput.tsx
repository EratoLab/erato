import { ArrowUpIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import React, { useState, useRef, useEffect, useCallback } from "react";

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
import { InteractiveContainer } from "../Container/InteractiveContainer";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

interface ChatInputProps {
  onSendMessage: (message: string, inputFileIds?: string[]) => void;
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
  // Add prop for preview callback
  onFilePreview?: (file: FileUploadItem) => void;
  // Add prop for current chat ID
  chatId?: string | null;
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
  // Destructure the new prop
  onFilePreview,
  // Destructure chatId
  chatId,
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Part of hook return, might be used internally or later
    uploadedFiles,
    error: uploadError,
  } = useFileDropzone({
    acceptedFileTypes,
    multiple: maxFiles > 1,
    maxFiles,
    disabled,
    onFilesUploaded: handleFileAttachments,
    // Pass chatId to the hook
    chatId: chatId,
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

  // Log attachedFiles received from the hook
  console.log("[ChatInput] Received attachedFiles from hook:", attachedFiles);

  // Create the submit handler
  const handleSubmit = createSubmitHandler(
    message,
    attachedFiles,
    (messageContent, inputFileIds) => {
      console.log(
        "[CHAT_FLOW] ChatInput - Message submitted:",
        messageContent.substring(0, 20) +
          (messageContent.length > 20 ? "..." : ""),
        "with files:",
        inputFileIds,
      );
      onSendMessage(messageContent, inputFileIds);
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

  // Combine disabled states
  const isDisabled = disabled || isUploading || isLoading || isStreaming;

  // Helper to handle removing file by ID regardless of source type
  const handleRemoveFileById = useCallback(
    (fileIdOrFile: string | FileUploadItem | File) => {
      let fileId: string | null = null;
      if (typeof fileIdOrFile === "string") {
        fileId = fileIdOrFile;
      } else if (
        fileIdOrFile &&
        typeof fileIdOrFile === "object" &&
        "id" in fileIdOrFile &&
        typeof fileIdOrFile.id === "string"
      ) {
        fileId = fileIdOrFile.id; // Handle FileUploadItem
      } // Browser File objects don't have IDs here, handleRemoveFile handles them

      if (fileId) {
        handleRemoveFile(fileId);
      } else if (fileIdOrFile instanceof File) {
        // If it's a browser File (e.g., from dropzone before upload ID), handleRemoveFile might need adjustment
        // For now, assuming handleRemoveFile in the hook handles string IDs primarily
        console.warn(
          "[ChatInput] Attempted to remove non-uploaded file, not fully handled.",
        );
      }
    },
    [handleRemoveFile],
  );

  // Determine if send button should be enabled
  const canSendMessage =
    (message.trim() || attachedFiles.length > 0) &&
    !isLoading &&
    !isStreaming &&
    !disabled &&
    !isUploading;

  // Log just before rendering the component and its preview section
  console.log(
    "[ChatInput] Rendering component. Preview should render if attachedFiles > 0. attachedFiles:",
    attachedFiles,
  );

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
            {attachedFiles.map((file) =>
              // Wrap FilePreviewButton in InteractiveContainer if onFilePreview exists
              onFilePreview ? (
                <InteractiveContainer
                  key={file.id}
                  onClick={() => onFilePreview(file)}
                  useDiv={true}
                  className="cursor-pointer"
                  aria-label={`Preview attachment ${file.filename}`}
                >
                  <FilePreviewButton
                    file={file}
                    onRemove={handleRemoveFileById} // Use helper
                    disabled={isDisabled}
                    showFileType={showFileTypes}
                    showSize={true}
                    filenameTruncateLength={25}
                  />
                </InteractiveContainer>
              ) : (
                // Original rendering if no preview handler
                <FilePreviewButton
                  key={file.id}
                  file={file}
                  onRemove={handleRemoveFileById} // Use helper
                  disabled={isDisabled}
                  showFileType={showFileTypes}
                  showSize={true}
                  filenameTruncateLength={25}
                />
              ),
            )}
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
                      // Directly return the result of uploadFiles
                      return await uploadFiles(files);
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
