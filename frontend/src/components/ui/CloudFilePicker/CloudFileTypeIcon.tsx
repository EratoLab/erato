/**
 * CloudFileTypeIcon component
 *
 * Renders appropriate icons based on mime_type and is_folder
 * Reuses existing file type logic
 */

import { memo } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { FileTypeUtil, getFileTypeIcon } from "@/utils/fileTypes";

import { ResolvedIcon } from "../icons";

interface CloudFileTypeIconProps {
  isFolder: boolean;
  mimeType?: string;
  fileName?: string;
  className?: string;
}

/**
 * Get icon ID based on file type
 */
function getIconIdForFileType(
  mimeType: string | undefined,
  fileName: string | undefined,
  iconMappings: Record<string, string> | undefined,
): string {
  // Try to determine file type from mime type or filename
  let fileType = FileTypeUtil.getTypeFromMimeType(mimeType ?? "");

  if (!fileType && fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext) {
      fileType = FileTypeUtil.getTypeFromExtension(ext);
    }
  }

  // Get the icon ID with theme override
  if (fileType) {
    return getFileTypeIcon(fileType, iconMappings);
  }

  // Default fallback for unknown types
  return getFileTypeIcon("text", iconMappings);
}

export const CloudFileTypeIcon = memo<CloudFileTypeIconProps>(
  ({ isFolder, mimeType, fileName, className = "size-5" }) => {
    const { iconMappings } = useTheme();

    if (isFolder) {
      // eslint-disable-next-line lingui/no-unlocalized-strings
      return <ResolvedIcon iconId="Folder" className={className} />;
    }

    const iconId = getIconIdForFileType(
      mimeType,
      fileName,
      iconMappings?.fileTypes,
    );
    return <ResolvedIcon iconId={iconId} className={className} />;
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
CloudFileTypeIcon.displayName = "CloudFileTypeIcon";
