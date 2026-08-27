import { useMemo } from "react";

import { AttachmentTileList } from "./AttachmentTileList";

import type { AttachmentTileItem } from "./AttachmentTileList";
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
 * Staged file attachments, drawn with the shared attachment tile.
 *
 * The props are the component-kit override contract and stay as they are even
 * where the tile no longer needs them: `showFileSizes` has never had a size to
 * show (the API type carries none) and `filenameTruncateLength` is now handled
 * by CSS truncation against the tile width.
 */
export const FileAttachmentsPreview: React.FC<FileAttachmentsPreviewProps> = ({
  attachedFiles,
  maxFiles,
  onRemoveFile,
  onRemoveAllFiles,
  onFilePreview,
  disabled = false,
  className = "",
}) => {
  const items = useMemo<AttachmentTileItem[]>(
    () =>
      attachedFiles.map((file) => ({
        id: file.id,
        file,
        previewUrl: file.preview_url,
      })),
    [attachedFiles],
  );

  if (attachedFiles.length === 0) {
    return null;
  }

  return (
    <AttachmentTileList
      items={items}
      size="compact"
      onRemove={onRemoveFile}
      onRemoveAll={onRemoveAllFiles}
      onActivate={
        onFilePreview
          ? (item) => onFilePreview(item.file as FileUploadItem)
          : undefined
      }
      disabled={disabled}
      capHeight
      maxFiles={maxFiles}
      className={className}
    />
  );
};
