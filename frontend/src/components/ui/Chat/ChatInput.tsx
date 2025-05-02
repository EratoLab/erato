import { ArrowUpIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import React, { useState, useRef, useEffect, useCallback } from "react";

import { FilePreviewButton } from "@/components/ui/FileUpload";
import { FileUploadWithTokenCheck } from "@/components/ui/FileUpload/FileUploadWithTokenCheck";
import { useFileDropzone } from "@/hooks/files";
import { useChatInputHandlers } from "@/hooks/ui";
import { useChatContext } from "@/providers/ChatProvider";

import { ChatInputTokenUsage } from "./ChatInputTokenUsage";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";
import { Tooltip } from "../Controls/Tooltip";
import { Alert } from "../Feedback/Alert";

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
  // Add prop for previous message ID
  previousMessageId?: string | null;
}

/**
 * ChatInput component with file attachment capabilities
 */
export const ChatInput = ({
  onSendMessage,
  onRegenerate: _onRegenerate,
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
  // Destructure the new props
  onFilePreview,
  chatId,
  previousMessageId,
}: ChatInputProps) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isTokenLimitExceeded, setIsTokenLimitExceeded] = useState(false);
  const [fileUploadTokenLimitExceeded, setFileUploadTokenLimitExceeded] =
    useState(false);
  // Add state for file button processing
  const [isFileButtonProcessing, setIsFileButtonProcessing] = useState(false);

  // Get necessary state from context instead of useChat()
  const { isStreaming, isMessagingLoading, isUploading } = useChatContext();

  // Combine loading states
  const isLoading = propIsLoading ?? isMessagingLoading;

  // Use our modernized file upload hook
  const {
    // We're now using FileUploadWithTokenCheck, so we don't need uploadFiles anymore
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
      // Don't allow sending if token limit is exceeded
      if (isTokenLimitExceeded || fileUploadTokenLimitExceeded) {
        return;
      }

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

  // Combine disabled states
  const isDisabled =
    disabled ||
    isUploading || // From context (drag & drop)
    isLoading ||
    isStreaming ||
    isFileButtonProcessing; // From button callback

  // Add token limit exceeded to disabled state for the send button
  const isSendDisabled =
    isDisabled || isTokenLimitExceeded || fileUploadTokenLimitExceeded;

  // Replace the useEffect with enhanced file removal handlers
  // Helper to handle removing file by ID regardless of source type with token limit reset
  const handleRemoveFileById = useCallback(
    (fileIdOrFile: string | FileUploadItem | File) => {
      let fileId: string | null = null;
      if (typeof fileIdOrFile === "string") {
        fileId = fileIdOrFile;
      } else if (
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        fileIdOrFile &&
        typeof fileIdOrFile === "object" &&
        "id" in fileIdOrFile &&
        typeof fileIdOrFile.id === "string"
      ) {
        fileId = fileIdOrFile.id; // Handle FileUploadItem
      } // Browser File objects don't have IDs here, handleRemoveFile handles them

      if (fileId) {
        handleRemoveFile(fileId);

        // Check if this would be the last file to reset token limit states
        if (attachedFiles.length === 1) {
          // Reset file upload token limit exceeded
          if (fileUploadTokenLimitExceeded) {
            setFileUploadTokenLimitExceeded(false);
          }

          // Only reset token limit exceeded if it's likely related to files
          // and not a very long message
          if (isTokenLimitExceeded && message.trim().length < 1000) {
            setIsTokenLimitExceeded(false);
          }
        }
      } else if (fileIdOrFile instanceof File) {
        console.warn(
          "[ChatInput] Attempted to remove non-uploaded file, not fully handled.",
        );
      }
    },
    [
      handleRemoveFile,
      attachedFiles.length,
      fileUploadTokenLimitExceeded,
      isTokenLimitExceeded,
      message,
    ],
  );

  // Enhanced version of handleRemoveAllFiles that also resets token limits
  const handleRemoveAllFilesWithTokenReset = useCallback(() => {
    handleRemoveAllFiles();

    // Reset both token limit states when all files are removed
    if (fileUploadTokenLimitExceeded) {
      setFileUploadTokenLimitExceeded(false);
    }

    // Only reset token limit exceeded if it's likely related to files
    // and not a very long message
    if (isTokenLimitExceeded && message.trim().length < 1000) {
      setIsTokenLimitExceeded(false);
    }
  }, [
    handleRemoveAllFiles,
    fileUploadTokenLimitExceeded,
    isTokenLimitExceeded,
    message,
  ]);

  // Handle token limit exceeded callback
  const handleTokenLimitExceeded = useCallback((isExceeded: boolean) => {
    setIsTokenLimitExceeded(isExceeded);
  }, []);

  // Handle file upload token limit exceeded
  const handleFileUploadTokenLimitExceeded = useCallback(
    (isExceeded: boolean) => {
      setFileUploadTokenLimitExceeded(isExceeded);
    },
    [],
  );

  // Callback for file button processing state change
  const handleFileButtonProcessingChange = useCallback(
    (isProcessing: boolean) => {
      setIsFileButtonProcessing(isProcessing);
    },
    [],
  );

  // Determine if send button should be enabled
  const canSendMessage =
    (message.trim() || attachedFiles.length > 0) &&
    !isLoading &&
    !isStreaming &&
    !disabled &&
    !isUploading &&
    !isTokenLimitExceeded &&
    !fileUploadTokenLimitExceeded;

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
      {/* Token usage warnings */}
      <ChatInputTokenUsage
        message={message}
        attachedFiles={attachedFiles}
        chatId={chatId}
        previousMessageId={previousMessageId}
        disabled={isDisabled}
        onLimitExceeded={handleTokenLimitExceeded}
      />

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
                  onClick={handleRemoveAllFilesWithTokenReset}
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
          placeholder={
            isTokenLimitExceeded || fileUploadTokenLimitExceeded
              ? "Message exceeds token limit. Please reduce length or remove files."
              : placeholder
          }
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
            (isTokenLimitExceeded || fileUploadTokenLimitExceeded) &&
              "border-[var(--theme-error)] placeholder:text-[var(--theme-error-fg)]",
          )}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 sm:gap-2">
            {showControls && (
              <>
                {/* File Upload Button with Token Check */}
                {handleFileAttachments && (
                  <FileUploadWithTokenCheck
                    message={message}
                    chatId={chatId}
                    previousMessageId={previousMessageId}
                    onFilesUploaded={handleFilesUploaded}
                    onTokenLimitExceeded={handleFileUploadTokenLimitExceeded}
                    // Pass the callback for processing state
                    onProcessingChange={handleFileButtonProcessingChange}
                    acceptedFileTypes={acceptedFileTypes}
                    multiple={maxFiles > 1}
                    iconOnly
                    className="p-1"
                    disabled={
                      attachedFiles.length >= maxFiles ||
                      isLoading ||
                      isStreaming ||
                      disabled ||
                      isUploading || // isUploading from context (drag & drop)
                      isFileButtonProcessing // Add button processing state
                    }
                  />
                )}

                {/* Regenerate button removed */}
                {/* <Tooltip content="Regenerate response">
                  <Button
                    onClick={_onRegenerate}
                    variant="icon-only"
                    size="sm"
                    icon={<ArrowPathIcon className="size-5" />}
                    aria-label="Regenerate response"
                    disabled={
                      isLoading || isStreaming || disabled || isUploading
                    }
                  />
                </Tooltip> */}
              </>
            )}
          </div>

          <Button
            type="submit"
            variant="secondary"
            size="sm"
            icon={<ArrowUpIcon className="size-5" />}
            disabled={!canSendMessage || isSendDisabled}
            aria-label={
              isTokenLimitExceeded || fileUploadTokenLimitExceeded
                ? "Cannot send: Token limit exceeded"
                : "Send message"
            }
          />
        </div>
      </div>
    </form>
  );
};
