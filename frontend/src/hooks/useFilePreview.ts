import { useMemo } from "react";

import { FileTypeUtil, FILE_TYPES } from "@/utils/fileTypes";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

export type FileResource = File | FileUploadItem;

interface FilePreviewInfo {
  /** File name to display */
  displayName: string;
  /** File size formatted for display (if available) */
  displaySize: string | null;
  /** File type (pdf, image, etc.) */
  fileType: FileType;
  /** Icon component for this file type */
  icon: React.ElementType;
  /** Color for the icon */
  iconColor: string;
  /** File extension without dot */
  extension: string;
  /** Whether this is a regular File or a FileUploadItem */
  isUploadedFile: boolean;
}

interface UseFilePreviewProps {
  /** The file to generate preview info for */
  file: FileResource;
  /** Maximum length for the filename before truncation */
  filenameTruncateLength?: number;
}

/**
 * Hook to generate preview information for files
 */
export function useFilePreview({
  file,
  filenameTruncateLength,
}: UseFilePreviewProps): FilePreviewInfo {
  return useMemo(() => {
    // Check if this is a browser File or server FileUploadItem
    const isUploadedFile = !("type" in file);

    // Get the filename
    const filename = isUploadedFile ? file.filename : file.name;

    // Truncate filename if specified
    const displayName =
      filenameTruncateLength && filename.length > filenameTruncateLength
        ? `${filename.substring(0, filenameTruncateLength)}...${getExtensionWithDot(filename)}`
        : filename;

    // Get size if available
    const size = isUploadedFile
      ? "size" in file
        ? (file as { size: number }).size
        : undefined
      : file.size;

    const displaySize =
      size !== undefined ? FileTypeUtil.formatFileSize(size) : null;

    // Determine file type and icon
    const fileType = isUploadedFile
      ? getFileTypeFromName(filename)
      : FileTypeUtil.getFileType(file);

    const config = FILE_TYPES[fileType];

    return {
      displayName,
      displaySize,
      fileType,
      icon: config.icon,
      iconColor: config.iconColor,
      extension: getExtension(filename),
      isUploadedFile,
    };
  }, [file, filenameTruncateLength]);
}

/**
 * Helper to get file extension from name
 */
function getExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === 0) return "";
  return filename.substring(lastDotIndex + 1).toLowerCase();
}

/**
 * Helper to get file extension with dot from name
 */
function getExtensionWithDot(filename: string): string {
  const ext = getExtension(filename);
  return ext ? `.${ext}` : "";
}

/**
 * Determine file type from filename only
 * Less accurate than using File.type but works for FileUploadItem
 */
function getFileTypeFromName(filename: string): FileType {
  const extension = getExtension(filename);
  if (!extension) return "other";

  // Check each file type for matching extension
  for (const [type, config] of Object.entries(FILE_TYPES)) {
    if (!config.enabled) continue;
    if (config.extensions.includes(extension)) {
      return type as FileType;
    }
  }

  return "other";
}
