import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { FilePreviewButton } from "./FilePreviewButton";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";
import { Tooltip } from "../Controls/Tooltip";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

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
  /** Optional surface variant for chat message geometry */
  surfaceVariant?: "default" | "message";
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
  surfaceVariant = "default",
}) => {
  const attachmentsFrameStyle =
    surfaceVariant === "message"
      ? ({
          borderRadius: "var(--theme-radius-message)",
          padding:
            "var(--theme-spacing-message-padding-y) var(--theme-spacing-message-padding-x)",
        } as const)
      : undefined;
  const attachmentsHeaderStyle =
    surfaceVariant === "message"
      ? ({
          gap: "var(--theme-spacing-control-gap)",
          marginBottom: "var(--theme-spacing-control-gap)",
        } as const)
      : undefined;
  const attachmentsListStyle =
    surfaceVariant === "message"
      ? ({
          gap: "var(--theme-spacing-control-gap)",
        } as const)
      : undefined;

  // Don't render anything if no files
  if (attachedFiles.length === 0) {
    return null;
  }

  return (
    <div
      className={clsx(
        "mb-3",
        surfaceVariant === "message" &&
          "border bg-theme-bg-primary [border-color:var(--theme-border-attachment)]",
        className,
      )}
      style={attachmentsFrameStyle}
    >
      <div
        className={clsx(
          "flex items-center justify-between",
          surfaceVariant === "message" ? "" : "mb-2",
        )}
        style={attachmentsHeaderStyle}
      >
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

      <div
        className={clsx(
          "flex flex-col",
          surfaceVariant === "message" ? "" : "gap-2",
        )}
        style={attachmentsListStyle}
      >
        {attachedFiles.map((file) =>
          // Wrap in InteractiveContainer if preview handler is provided
          onFilePreview ? (
            <InteractiveContainer
              key={file.id}
              onClick={() => onFilePreview(file)}
              useDiv={true}
              className="w-full cursor-pointer hover:bg-theme-bg-accent"
              aria-label={`${t`Preview attachment`} ${file.filename}`}
            >
              <FilePreviewButton
                file={file}
                onRemove={() => onRemoveFile(file.id)}
                disabled={disabled}
                className="w-full"
                showFileType={showFileTypes}
                showSize={showFileSizes}
                filenameTruncateLength={filenameTruncateLength}
                filenameClassName="max-w-full"
              />
            </InteractiveContainer>
          ) : (
            // Regular preview button without interactive container
            <FilePreviewButton
              key={file.id}
              file={file}
              onRemove={() => onRemoveFile(file.id)}
              disabled={disabled}
              className="w-full"
              showFileType={showFileTypes}
              showSize={showFileSizes}
              filenameTruncateLength={filenameTruncateLength}
              filenameClassName="max-w-full"
            />
          ),
        )}
      </div>
    </div>
  );
};
