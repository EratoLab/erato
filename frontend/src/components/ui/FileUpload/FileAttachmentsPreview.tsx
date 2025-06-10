import { t } from "@lingui/core/macro";
import clsx from "clsx";
import React from "react";

import { FilePreviewButton } from "./FilePreviewButton";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";
import { Tooltip } from "../Controls/Tooltip";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface FileAttachmentsPreviewProps {
  /** Array of file attachments to preview */
  attachedFiles: FileUploadItem[];
  /** Max number of files allowed for display in header */
  maxFiles: number;
  /** Handler to remove a specific file */
  onRemoveFile: (fileId: string) => void;
  /** Handler to remove all files */
  onRemoveAllFiles: () => void;
  /** Optional handler for file preview interaction */
  onFilePreview?: (file: FileUploadItem) => void;
  /** Whether the component is in a disabled state */
  disabled?: boolean;
  /** Whether to show file type info */
  showFileTypes?: boolean;
  /** Whether to display file size */
  showFileSizes?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Length to truncate filenames */
  filenameTruncateLength?: number;
}

/**
 * Component for displaying file attachments with header and preview grid
 */
export const FileAttachmentsPreview: React.FC<FileAttachmentsPreviewProps> = ({
  attachedFiles,
  maxFiles,
  onRemoveFile,
  onRemoveAllFiles,
  onFilePreview,
  disabled = false,
  showFileTypes = false,
  showFileSizes = true,
  className = "",
  filenameTruncateLength = 25,
}) => {
  // Don't render anything if no files
  if (attachedFiles.length === 0) {
    return null;
  }

  return (
    <div className={clsx("mb-3", className)}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--theme-fg-secondary)]">
          {t`Attachments`} ({attachedFiles.length}/{maxFiles})
        </h3>
        {attachedFiles.length > 1 && (
          <Tooltip content={t`Remove all files`}>
            <Button
              onClick={onRemoveAllFiles}
              variant="ghost"
              size="sm"
              className="text-xs"
              aria-label={t`Remove all attachments`}
              disabled={disabled}
            >
              {t`Remove all`}
            </Button>
          </Tooltip>
        )}
      </div>

      {/* File attachment grid */}
      <div className="flex flex-wrap gap-2">
        {attachedFiles.map((file) =>
          // Wrap in InteractiveContainer if preview handler is provided
          onFilePreview ? (
            <InteractiveContainer
              key={file.id}
              onClick={() => onFilePreview(file)}
              useDiv={true}
              className="cursor-pointer"
              aria-label={`${t`Preview attachment`} ${file.filename}`}
            >
              <FilePreviewButton
                file={file}
                onRemove={() => onRemoveFile(file.id)}
                disabled={disabled}
                showFileType={showFileTypes}
                showSize={showFileSizes}
                filenameTruncateLength={filenameTruncateLength}
              />
            </InteractiveContainer>
          ) : (
            // Regular preview button without interactive container
            <FilePreviewButton
              key={file.id}
              file={file}
              onRemove={() => onRemoveFile(file.id)}
              disabled={disabled}
              showFileType={showFileTypes}
              showSize={showFileSizes}
              filenameTruncateLength={filenameTruncateLength}
            />
          ),
        )}
      </div>
    </div>
  );
};
