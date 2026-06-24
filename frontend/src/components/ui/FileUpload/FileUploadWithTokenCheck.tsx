/**
 * FileUploadWithTokenCheck Component
 *
 * Extends the standard FileUpload component with token usage checking
 * Supports both local disk uploads and cloud file linking (OneDrive/Sharepoint)
 */
import { t } from "@lingui/core/macro";

import { componentRegistry } from "@/config/componentRegistry";
import { useChatFileSources } from "@/hooks/files/useChatFileSources";

import { CloudFilePickerModal } from "./CloudFilePickerModal";
import { FileSourceSelector } from "./FileSourceSelector";
import { FileUploadButton } from "./FileUploadButton";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type React from "react";

interface FileUploadWithTokenCheckProps {
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
  /** Callback when token limit is exceeded */
  onTokenLimitExceeded?: (isExceeded: boolean) => void;
  /** Optional upload function supplied by a parent so drag/drop and buttons share one path */
  performFileUpload?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Optional upload error supplied by a parent */
  uploadError?: Error | null;
  /** Array of accepted file types */
  acceptedFileTypes?: FileType[];
  /** Whether multiple files can be selected */
  multiple?: boolean;
  /** Custom button label */
  label?: string;
  /** Whether to show only the icon in the button */
  iconOnly?: boolean;
  /** Maximum number of files allowed */
  maxFiles?: number;
  /** CSS class name for the button */
  className?: string;
  /** Whether the upload is disabled */
  disabled?: boolean;
  /** Callback when the combined processing (upload + estimation) state changes */
  onProcessingChange?: (isProcessing: boolean) => void;
}

/**
 * File upload button with integrated token usage checking
 * Note: Does not display its own warnings, defers to ChatInputTokenUsage
 */
export const FileUploadWithTokenCheck: React.FC<
  FileUploadWithTokenCheckProps
> = ({
  message,
  chatId,
  assistantId,
  previousMessageId,
  chatProviderId,
  onFilesUploaded,
  onTokenLimitExceeded,
  performFileUpload: externalPerformFileUpload,
  uploadError: externalUploadError = null,
  acceptedFileTypes = [],
  multiple = false,
  label = t({ id: "fileUpload.uploadFiles", message: "Upload Files" }),
  iconOnly = false,
  maxFiles = 5,
  className = "",
  disabled = false,
  onProcessingChange,
}) => {
  const hasCustomSelector = componentRegistry.ChatFileSourceSelector != null;

  const {
    availableProviders,
    hasCloudProviders,
    isProcessing,
    performDiskUpload,
    resolvedUploadError,
    onSelectDisk,
    onSelectCloud,
    onSelectFiles,
    dropzoneRootProps,
    dropzoneInputProps,
    cloudPickerProps,
  } = useChatFileSources({
    message,
    chatId,
    assistantId,
    previousMessageId,
    chatProviderId,
    onFilesUploaded,
    onTokenLimitExceeded,
    performFileUpload: externalPerformFileUpload,
    uploadError: externalUploadError,
    acceptedFileTypes,
    multiple,
    maxFiles,
    disabled,
    onProcessingChange,
  });

  // Show a source picker when cloud providers exist or a host has registered a
  // custom selector (e.g. the Outlook add-in); otherwise a plain upload button.
  const shouldUseSourceSelector = hasCloudProviders || hasCustomSelector;

  return (
    <div className="relative">
      {/* File upload button - show selector if cloud providers available */}
      {shouldUseSourceSelector ? (
        <>
          {/* Hidden dropzone input for disk uploads */}
          <div {...dropzoneRootProps({ className: "contents" })}>
            <input
              {...dropzoneInputProps()}
              aria-label={t({
                id: "fileUpload.disk.ariaLabel",
                message: "Upload files from disk",
              })}
            />
          </div>

          {/* Use custom component from registry if available, otherwise default */}
          {componentRegistry.ChatFileSourceSelector ? (
            <componentRegistry.ChatFileSourceSelector
              availableProviders={availableProviders}
              onSelectDisk={onSelectDisk}
              onSelectCloud={onSelectCloud}
              onSelectFiles={onSelectFiles}
              disabled={disabled || isProcessing}
              isProcessing={isProcessing}
              className={className}
            />
          ) : (
            <FileSourceSelector
              availableProviders={availableProviders}
              onSelectDisk={onSelectDisk}
              onSelectCloud={onSelectCloud}
              onSelectFiles={onSelectFiles}
              disabled={disabled || isProcessing}
              isProcessing={isProcessing}
              className={className}
            />
          )}
        </>
      ) : (
        <FileUploadButton
          acceptedFileTypes={acceptedFileTypes}
          multiple={multiple}
          label={label}
          iconOnly={iconOnly}
          className={className}
          disabled={disabled || isProcessing}
          performFileUpload={performDiskUpload}
          isUploading={isProcessing}
          uploadError={resolvedUploadError}
        />
      )}

      {/* Cloud file picker modal */}
      {cloudPickerProps && <CloudFilePickerModal {...cloudPickerProps} />}
    </div>
  );
};
