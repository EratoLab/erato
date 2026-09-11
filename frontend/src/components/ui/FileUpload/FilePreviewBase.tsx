import { FILE_TYPES } from "@/utils/fileTypes";

import { AttachmentTile } from "./AttachmentTile";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type React from "react";

/**
 * Lightweight local preview item that hasn't been uploaded yet.
 */
export interface LocalFilePreviewItem {
  id: string;
  filename: string;
  displayName?: string;
  size?: number;
}

/**
 * Type that can represent a browser File, a local preview item, or a server-side FileUploadItem
 */
export type FileResource = File | LocalFilePreviewItem | FileUploadItem;

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
 * Type guard to determine if a FileResource is a local preview item
 */
export function isLocalFilePreviewItem(
  file: FileResource,
): file is LocalFilePreviewItem {
  return "id" in file && "filename" in file && !("download_url" in file);
}

/**
 * Get the name of a file regardless of type
 */
export function getFileName(file: FileResource): string {
  if (isFile(file)) {
    return file.name;
  }

  // Any resource may carry a friendlier name, not only an un-uploaded one: a
  // stored upload can have a minted filename that is a join key rather than
  // something to read. The API type has no `displayName`, so this only ever
  // fires where a caller deliberately supplied one.
  if ("displayName" in file && file.displayName) {
    return file.displayName;
  }

  return file.filename;
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

// Only a short, space-free, alphanumeric suffix counts as a real file
// extension. Without this guard, free-text labels that merely contain a dot —
// e.g. an email subject like "Kickoff Kundenportal 2.0 – Lastenheft" shown in a
// context chip — would have their tail (".0 – Lastenheft …") treated as an
// extension and pinned un-truncated, swamping the visible text.
const FILE_EXTENSION_PATTERN = /^\.[A-Za-z0-9]{1,12}$/;

export function splitFilenameForDisplay(filename: string): {
  stem: string;
  extension: string;
} {
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

  const candidateExtension = filename.slice(extensionSeparatorIndex);
  if (!FILE_EXTENSION_PATTERN.test(candidateExtension)) {
    // Not a plausible extension (too long, or contains spaces/punctuation):
    // keep the whole string as the stem so it truncates with a trailing
    // ellipsis like ordinary text instead of pinning the tail.
    return {
      stem: filename,
      extension: "",
    };
  }

  return {
    stem: filename.slice(0, extensionSeparatorIndex),
    extension: candidateExtension,
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
  /** Accepted and ignored: the chip truncates against its width, not a count. */
  filenameTruncateLength?: number;
  /** Accepted and ignored; `className` still reaches the chip as a whole. */
  filenameClassName?: string;
  /**
   * Render without the chip chrome (border/background/radius) so a parent
   * surface can own it.
   */
  chromeless?: boolean;
}

/**
 * A file chip, drawn by the shared attachment tile. Keeps its own name and
 * module because the component kits import it directly, and a flat named import
 * fails module linking as a whole.
 *
 * Handles both browser File objects and server-side FileUploadItem objects.
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
  filenameClassName: _filenameClassName = "",
  chromeless = false,
}) => (
  <AttachmentTile
    file={file}
    // They sit in wrapping rows, where a stretched chip means one file a line.
    variant={chromeless ? "bare" : "tile"}
    // What this component has always shown: a `.csv` reads SPREADSHEET here.
    showType={showFileType ? "family" : "none"}
    showSize={showSize}
    disabled={disabled}
    className={className}
    onRemove={
      showRemoveButton
        ? () => {
            if (!disabled) {
              onRemove(file);
            }
          }
        : undefined
    }
    removeControl={showRemoveButton ? removeButton : undefined}
  />
);

// eslint-disable-next-line lingui/no-unlocalized-strings
FilePreviewBase.displayName = "FilePreviewBase";
