import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useMemo } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { FILE_TYPES, getFileTypeIcon } from "@/utils/fileTypes";

import { CloseIcon, ResolvedIcon } from "../icons";
import { FILE_PREVIEW_STYLES } from "./fileUploadStyles";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type React from "react";

/**
 * Type that can represent either a browser File or a server-side FileUploadItem
 */
export type FileResource = File | FileUploadItem;

/**
 * Type guard to determine if a FileResource is a File
 */
export function isFile(file: FileResource): file is File {
  return "type" in file && "size" in file;
}

/**
 * Type guard to determine if a FileResource is a FileUploadItem
 */
export function isFileUploadItem(file: FileResource): file is FileUploadItem {
  return "id" in file && "filename" in file;
}

/**
 * Get the name of a file regardless of type
 */
export function getFileName(file: FileResource): string {
  return isFile(file) ? file.name : file.filename;
}

/**
 * Extended FileUploadItem that might have a size property
 */
export interface FileUploadItemWithSize extends FileUploadItem {
  size?: number;
}

/**
 * Get the size of a file in a formatted string (if available)
 */
export function getFileSize(file: FileResource): string | null {
  if (isFile(file)) {
    return formatFileSize(file.size);
  }

  // Some FileUploadItems might have a size property
  const fileWithSize = file as FileUploadItemWithSize;
  return typeof fileWithSize.size === "number"
    ? formatFileSize(fileWithSize.size)
    : null;
}

/**
 * Format a file size in bytes to a human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  } else {
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  }
}

/**
 * Determine the file type by its name
 */
export function getFileType(filename: string): FileType {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";

  // Check each file type for matching extension
  for (const [type, config] of Object.entries(FILE_TYPES)) {
    if (config.extensions.includes(extension)) {
      return type as FileType;
    }
  }

  return "other";
}

/**
 * Truncate a filename if it's too long
 */
export function truncateFilename(filename: string, maxLength = 30): string {
  if (filename.length <= maxLength) {
    return filename;
  }

  const extension = filename.split(".").pop() ?? "";
  const nameWithoutExtension = filename.substring(
    0,
    filename.length - extension.length - 1,
  );

  // Keep 1/3 of the filename at the beginning and 1/3 at the end
  const charsToKeep = maxLength - 3; // 3 is for the ellipsis
  const startChars = Math.ceil(charsToKeep / 2);
  const endChars = Math.floor(charsToKeep / 2);

  return `${nameWithoutExtension.substring(0, startChars)}...${nameWithoutExtension.substring(nameWithoutExtension.length - endChars)}.${extension}`;
}

function splitFilenameForDisplay(filename: string) {
  const extensionSeparatorIndex = filename.lastIndexOf(".");

  if (
    extensionSeparatorIndex <= 0 ||
    extensionSeparatorIndex === filename.length - 1
  ) {
    return {
      stem: filename,
      extension: "",
    };
  }

  return {
    stem: filename.slice(0, extensionSeparatorIndex),
    extension: filename.slice(extensionSeparatorIndex),
  };
}

/**
 * Props for the base file preview component
 */
export interface FilePreviewBaseProps {
  /** The file to preview (can be a browser File or server FileUploadItem) */
  file: FileResource;
  /** Callback when the file should be removed */
  onRemove: (file: FileResource) => void;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** CSS class name */
  className?: string;
  /** Whether to show the file size (if available) */
  showSize?: boolean;
  /** Whether to show the file type */
  showFileType?: boolean;
  /** Whether to show the remove button */
  showRemoveButton?: boolean;
  /** Custom remove button component */
  removeButton?: React.ReactNode;
  /** Maximum length of the displayed filename before truncation */
  filenameTruncateLength?: number;
  /** Additional CSS classes for the filename element */
  filenameClassName?: string;
}

/**
 * Base component for displaying file previews with consistent behavior
 *
 * This component can handle both browser File objects and server-side FileUploadItem objects.
 * It provides a unified interface for displaying file previews with customizable options.
 */
export const FilePreviewBase: React.FC<FilePreviewBaseProps> = ({
  file,
  onRemove,
  disabled = false,
  className = "",
  showSize = true,
  showFileType = false,
  showRemoveButton = true,
  removeButton,
  filenameTruncateLength: _filenameTruncateLength = 30,
  filenameClassName = "",
}) => {
  const { iconMappings } = useTheme();

  // Extract file information
  const filename = useMemo(() => getFileName(file), [file]);
  const fileSize = useMemo(
    () => (showSize ? getFileSize(file) : null),
    [file, showSize],
  );
  const fileType = useMemo(() => getFileType(filename), [filename]);
  const displayNameParts = useMemo(
    () => splitFilenameForDisplay(filename),
    [filename],
  );

  // Get the file type icon ID (with theme override) and display information
  const iconId = useMemo(
    () => getFileTypeIcon(fileType, iconMappings?.fileTypes),
    [fileType, iconMappings],
  );
  const iconColor = useMemo(() => FILE_TYPES[fileType].iconColor, [fileType]);
  const typeDisplayName = useMemo(
    () => FILE_TYPES[fileType].displayName || t`File`,
    [fileType],
  );

  // Handle removing the file
  const handleRemove = (e?: React.MouseEvent) => {
    // Stop event propagation if this is triggered by an event
    if (e) {
      e.stopPropagation();
    }

    if (!disabled) {
      onRemove(file);
    }
  };

  return (
    <div
      className={`${FILE_PREVIEW_STYLES.container} ${className}`}
      data-filetype={fileType}
    >
      {/* File icon */}
      <div className="mr-2 shrink-0" style={{ color: iconColor }}>
        <ResolvedIcon
          iconId={iconId}
          className={FILE_PREVIEW_STYLES.icon}
          aria-hidden="true"
        />
      </div>

      {/* File details */}
      <div className="min-w-0 flex-1">
        <div
          className={clsx(FILE_PREVIEW_STYLES.name, filenameClassName)}
          title={filename}
        >
          <span className={FILE_PREVIEW_STYLES.nameStem}>
            {displayNameParts.stem}
          </span>
          {displayNameParts.extension && (
            <span className={FILE_PREVIEW_STYLES.nameExtension}>
              {displayNameParts.extension}
            </span>
          )}
        </div>
        <div className="flex items-center text-xs text-[var(--theme-fg-muted)]">
          {showFileType && <span className="uppercase">{typeDisplayName}</span>}
          {showFileType && fileSize && <span className="mx-1">•</span>}
          {fileSize && <span>{fileSize}</span>}
        </div>
      </div>

      {/* Remove button */}
      {showRemoveButton &&
        (removeButton ?? (
          <button
            type="button"
            onClick={(e) => handleRemove(e)}
            disabled={disabled}
            className={FILE_PREVIEW_STYLES.closeButton}
            aria-label={`${t`Remove`} ${filename}`}
          >
            <CloseIcon className="size-4" />
          </button>
        ))}
    </div>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
FilePreviewBase.displayName = "FilePreviewBase";
