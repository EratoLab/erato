import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState, useRef, useEffect, useCallback } from "react";

import { FileAttachmentsPreview } from "@/components/ui/FileUpload";
import { FileUploadWithTokenCheck } from "@/components/ui/FileUpload/FileUploadWithTokenCheck";
import { useTokenManagement, useActiveModelSelection } from "@/hooks/chat";
import { useFileDropzone } from "@/hooks/files";
import { useChatInputHandlers } from "@/hooks/ui";
import { useChatContext } from "@/providers/ChatProvider";

import { ArrowUpIcon } from "../icons";
import { ChatInputTokenUsage } from "./ChatInputTokenUsage";
import { ModelSelector } from "./ModelSelector";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { BudgetWarning } from "../Feedback/ChatWarnings/BudgetWarning";

import type {
  FileUploadItem,
  ChatModel,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

interface ChatInputProps {
  onSendMessage: (
    message: string,
    inputFileIds?: string[],
    modelId?: string,
  ) => void;
  onRegenerate?: () => void;
  // Optional edit mode submit handler. When provided with mode="edit", submit will call this instead of onSendMessage
  onEditMessage?: (
    messageId: string,
    newContent: string,
    replaceInputFileIds?: string[],
  ) => void;
  // Optional cancel callback for edit mode
  onCancelEdit?: () => void;
  handleFileAttachments?: (files: FileUploadItem[]) => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
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
  // Control whether the input is editing an existing message or composing a new one
  mode?: "compose" | "edit";
  // Target message id to edit when in edit mode
  editMessageId?: string;
  // Initial content when entering edit mode (used to prefill the textarea)
  editInitialContent?: string;
  // Initial model to use for selection (typically from chat history)
  initialModel?: ChatModel | null;
}

/**
 * ChatInput component with file attachment capabilities
 */
export const ChatInput = ({
  onSendMessage,
  onRegenerate: _onRegenerate,
  onEditMessage,
  onCancelEdit,
  handleFileAttachments,
  isLoading: propIsLoading,
  disabled = false,
  className = "",
  placeholder = t`Type a message...`,
  showControls = true,
  maxFiles = 5,
  acceptedFileTypes = [],
  initialFiles = [],
  showFileTypes = false,
  // Destructure the new props
  onFilePreview,
  chatId,
  previousMessageId,
  mode = "compose",
  editMessageId,
  editInitialContent,
  initialModel,
}: ChatInputProps) => {
  const [message, setMessage] = useState(" ");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Add state for file button processing
  const [isFileButtonProcessing, setIsFileButtonProcessing] = useState(false);

  // Get necessary state from context instead of useChat()
  const { isStreaming, isMessagingLoading, isUploading } = useChatContext();

  // Combine loading states
  const isLoading = propIsLoading ?? isMessagingLoading;

  // Use local model selection hook
  const {
    availableModels: _availableModels,
    selectedModel,
    setSelectedModel: _setSelectedModel,
    isSelectionReady: _isSelectionReady,
  } = useActiveModelSelection({
    initialModel,
  });

  // Use our token management hook
  const {
    // Individual token limit states are not used directly but through isAnyTokenLimitExceeded
    isAnyTokenLimitExceeded,
    handleMessageTokenLimitExceeded,
    handleFileTokenLimitExceeded,
    resetTokenLimits,
    resetTokenLimitsOnFileRemoval,
  } = useTokenManagement();

  // Use our modernized file upload hook
  const {
    uploadedFiles: _uploadedFiles,
    // Not using the error directly
    error: _uploadError,
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

  // Prefill message when entering edit mode
  useEffect(() => {
    if (mode === "edit" && editInitialContent !== undefined) {
      setMessage(editInitialContent);
    }
    if (mode === "compose") {
      setMessage("");
    }
  }, [mode, editInitialContent]);

  // Create the submit handler
  const handleSubmit = createSubmitHandler(
    message,
    attachedFiles,
    (messageContent, inputFileIds) => {
      // Don't allow sending if token limit is exceeded
      if (isAnyTokenLimitExceeded) {
        return;
      }

      console.log(
        "[CHAT_FLOW] ChatInput - Submit:",
        { mode, editMessageId },
        messageContent.substring(0, 20) +
          (messageContent.length > 20 ? "..." : ""),
        "files:",
        inputFileIds,
        "model:",
        selectedModel?.chat_provider_id,
      );
      if (mode === "edit" && onEditMessage && editMessageId) {
        onEditMessage(editMessageId, messageContent, inputFileIds);
      } else {
        onSendMessage(
          messageContent,
          inputFileIds,
          selectedModel?.chat_provider_id,
        );
      }
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
  const isSendDisabled = isDisabled || isAnyTokenLimitExceeded;

  // Enhanced file removal handler using token management hook
  const handleRemoveFileById = useCallback(
    (fileId: string) => {
      handleRemoveFile(fileId);

      // Reset token limits if this was the last file
      resetTokenLimitsOnFileRemoval(
        attachedFiles.length - 1,
        message.trim().length,
      );
    },
    [
      handleRemoveFile,
      attachedFiles.length,
      message,
      resetTokenLimitsOnFileRemoval,
    ],
  );

  // Enhanced version of handleRemoveAllFiles that also resets token limits
  const handleRemoveAllFilesWithTokenReset = useCallback(() => {
    handleRemoveAllFiles();

    // Reset token limits when all files are removed
    resetTokenLimits(message.trim().length);
  }, [handleRemoveAllFiles, resetTokenLimits, message]);

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
    !isAnyTokenLimitExceeded;

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
        onLimitExceeded={handleMessageTokenLimitExceeded}
      />

      {/* Budget warning - shows when user approaches spending limit */}
      <BudgetWarning />

      {/* File previews using our new component */}
      <FileAttachmentsPreview
        attachedFiles={attachedFiles}
        maxFiles={maxFiles}
        onRemoveFile={handleRemoveFileById}
        onRemoveAllFiles={handleRemoveAllFilesWithTokenReset}
        onFilePreview={onFilePreview}
        disabled={isDisabled}
        showFileTypes={showFileTypes}
      />

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
            isAnyTokenLimitExceeded
              ? t`Message exceeds token limit. Please reduce length or remove files.`
              : mode === "edit"
                ? t`Edit your message...`
                : placeholder
          }
          rows={1}
          disabled={isLoading || isStreaming || disabled || isUploading}
          tabIndex={0}
          autoFocus={true} // eslint-disable-line jsx-a11y/no-autofocus -- The chat input is the main interactive element on the page.
          className={clsx(
            "w-full resize-none overflow-y-auto",
            "p-2 sm:px-3",
            "bg-transparent",
            "text-[var(--theme-fg-primary)] placeholder:text-[var(--theme-fg-muted)]",
            "focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "max-h-[200px] min-h-[32px]",
            "text-base",
            "scrollbar-auto-hide",
            isAnyTokenLimitExceeded &&
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
                    onTokenLimitExceeded={handleFileTokenLimitExceeded}
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
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {mode === "edit" && onCancelEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancelEdit}
                data-testid="chat-input-cancel-edit"
              >
                {t`Cancel`}
              </Button>
            )}
            <ModelSelector
              availableModels={_availableModels}
              selectedModel={selectedModel}
              onModelChange={_setSelectedModel}
              disabled={!_isSelectionReady}
            />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              icon={<ArrowUpIcon className="size-5" />}
              disabled={!canSendMessage || isSendDisabled}
              data-testid={
                mode === "edit"
                  ? "chat-input-save-edit"
                  : "chat-input-send-message"
              }
              aria-label={
                isAnyTokenLimitExceeded
                  ? t`Cannot send: Token limit exceeded`
                  : mode === "edit"
                    ? t`Save edit`
                    : t`Send message`
              }
            />
          </div>
        </div>
      </div>
    </form>
  );
};
