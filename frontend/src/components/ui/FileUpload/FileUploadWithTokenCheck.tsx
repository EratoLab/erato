/**
 * FileUploadWithTokenCheck Component
 *
 * Extends the standard FileUpload component with token usage checking
 */
import { t } from "@lingui/core/macro";
import { useEffect } from "react";

import { useFileUploadWithTokenCheck } from "@/hooks/files/useFileUploadWithTokenCheck";

import { FileUploadButton } from "./FileUploadButton";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type React from "react";

interface FileUploadWithTokenCheckProps {
  /** Current message text to use for token estimation */
  message: string;
  /** Current chat ID */
  chatId?: string | null;
  /** Previous message ID */
  previousMessageId?: string | null;
  /** Callback when files are successfully uploaded */
  onFilesUploaded?: (files: FileUploadItem[]) => void;
  /** Callback when token limit is exceeded */
  onTokenLimitExceeded?: (isExceeded: boolean) => void;
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
  previousMessageId,
  onFilesUploaded,
  onTokenLimitExceeded,
  acceptedFileTypes = [],
  multiple = false,
  label = t`Upload Files`,
  iconOnly = false,
  maxFiles = 5,
  className = "",
  disabled = false,
  onProcessingChange,
}) => {
  // Use the combined hook
  const {
    uploadFiles,
    isUploading,
    isEstimating,
    uploadError,
    tokenUsageEstimation,
    exceedsTokenLimit,
  } = useFileUploadWithTokenCheck({
    message,
    chatId,
    previousMessageId,
    onFilesUploaded,
    acceptedFileTypes,
    multiple,
    maxFiles,
    disabled,
  });

  // Calculate combined processing state
  const isProcessing = isUploading || isEstimating;

  // Effect to notify parent about processing state changes
  useEffect(() => {
    if (onProcessingChange) {
      onProcessingChange(isProcessing);
    }
  }, [isProcessing, onProcessingChange]);

  // Effect to notify parent about token limit changes
  // Now we only notify the parent and don't show warnings directly
  useEffect(() => {
    // Notify parent if there's a token estimation and limits are exceeded
    if (tokenUsageEstimation && onTokenLimitExceeded) {
      onTokenLimitExceeded(exceedsTokenLimit);
    }
  }, [tokenUsageEstimation, exceedsTokenLimit, onTokenLimitExceeded]);

  return (
    <div>
      {/* File upload button */}
      <FileUploadButton
        acceptedFileTypes={acceptedFileTypes}
        multiple={multiple}
        label={label}
        iconOnly={iconOnly}
        className={className}
        disabled={disabled || isProcessing}
        performFileUpload={uploadFiles}
        isUploading={isProcessing}
        uploadError={uploadError instanceof Error ? uploadError : null}
      />
    </div>
  );
};
