import { XMarkIcon } from "@heroicons/react/24/outline";
import { t } from "@lingui/core/macro";
import { memo, useCallback } from "react";

import { FilePreviewBase, type FileResource } from "./FilePreviewBase";
import { Button } from "../Controls/Button";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface FilePreviewButtonProps {
  /** The file to preview */
  file: FileResource;
  /** Callback when remove button is clicked */
  onRemove: (fileId: string | File) => void;
  /** Whether the remove button is disabled */
  disabled?: boolean;
  /** CSS class name */
  className?: string;
  /** Whether to show file size if available */
  showSize?: boolean;
  /** Whether to show file type label */
  showFileType?: boolean;
  /** Maximum length of the displayed filename before truncation */
  filenameTruncateLength?: number;
}

/**
 * File preview component with a Button component for the remove action
 *
 * This enhanced component uses the Button component for the remove action
 * and supports both browser File objects and server FileUploadItem objects.
 */
export const FilePreviewButton = memo<FilePreviewButtonProps>(
  ({
    file,
    onRemove,
    disabled = false,
    className = "",
    showSize = true,
    showFileType = false,
    filenameTruncateLength,
  }) => {
    // Handle the remove action with proper file parameter
    const handleRemove = useCallback(() => {
      // For File objects, pass the file itself
      if ("name" in file) {
        onRemove(file);
        return;
      }

      // For FileUploadItem objects, pass the ID
      const fileItem = file;
      onRemove(fileItem.id);
    }, [file, onRemove]);

    // Create a custom remove button using the Button component
    const customRemoveButton = (
      <Button
        variant="ghost"
        size="sm"
        icon={<XMarkIcon className="size-4" />}
        aria-label={`${t`Remove`} ${(file as File).name || (file as FileUploadItem).filename}`}
        onClick={(e) => {
          // Stop event propagation to prevent triggering parent container's click
          e.stopPropagation();
          handleRemove();
        }}
        disabled={disabled}
        className="rounded-full p-1"
      />
    );

    return (
      <FilePreviewBase
        file={file}
        onRemove={handleRemove}
        disabled={disabled}
        className={className}
        showSize={showSize}
        showFileType={showFileType}
        showRemoveButton={true}
        removeButton={customRemoveButton}
        filenameTruncateLength={filenameTruncateLength}
      />
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FilePreviewButton.displayName = "FilePreviewButton";
