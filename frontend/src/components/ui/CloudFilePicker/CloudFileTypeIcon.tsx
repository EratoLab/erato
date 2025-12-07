/**
 * CloudFileTypeIcon component
 *
 * Renders appropriate icons based on mime_type and is_folder
 * Reuses existing file type logic
 */

import { memo } from "react";

import { FileTypeUtil } from "@/utils/fileTypes";

import {
  DocumentIcon,
  FolderIcon,
  ImageIcon,
  SpreadsheetIcon,
  PresentationIcon,
  FileTextIcon,
} from "../icons";

interface CloudFileTypeIconProps {
  isFolder: boolean;
  mimeType?: string;
  fileName?: string;
  className?: string;
}

/**
 * Get icon component based on file type
 */
function getIconForFileType(mimeType?: string, fileName?: string) {
  if (!mimeType && !fileName) {
    return FileTextIcon;
  }

  // Try to determine file type from mime type or filename
  let fileType = FileTypeUtil.getTypeFromMimeType(mimeType ?? "");

  if (!fileType && fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext) {
      fileType = FileTypeUtil.getTypeFromExtension(ext);
    }
  }

  // Map file types to icons
  switch (fileType) {
    case "document":
      return DocumentIcon;
    case "spreadsheet":
      return SpreadsheetIcon;
    case "presentation":
      return PresentationIcon;
    case "image":
      return ImageIcon;
    case "pdf":
      return DocumentIcon;
    case "text":
      return FileTextIcon;
    default:
      return FileTextIcon;
  }
}

export const CloudFileTypeIcon = memo<CloudFileTypeIconProps>(
  ({ isFolder, mimeType, fileName, className = "size-5" }) => {
    if (isFolder) {
      return <FolderIcon className={className} />;
    }

    const IconComponent = getIconForFileType(mimeType, fileName);
    return <IconComponent className={className} />;
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
CloudFileTypeIcon.displayName = "CloudFileTypeIcon";
