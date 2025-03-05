import React from "react";
import clsx from "clsx";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { FileTypeUtil, FILE_TYPES } from "@/utils/fileTypes";
import { Button } from "./Button";

interface FilePreviewProps {
  file: File;
  onRemove: (file: File) => void;
  className?: string;
  /** Show file size - defaults to true */
  showFileSize?: boolean;
  /** Show the remove button - defaults to true */
  showRemoveButton?: boolean;
}

/**
 * Component for displaying a preview of a file attachment
 */
export const FilePreview: React.FC<FilePreviewProps> = ({
  file,
  onRemove,
  className = "",
  showFileSize = true,
  showRemoveButton = true,
}) => {
  // Get file type and configuration
  const fileType = FileTypeUtil.getFileType(file);
  const typeConfig = FILE_TYPES[fileType];

  // Get the icon component for this file type
  const IconComponent = typeConfig.icon;

  // Create formatted file size string if needed
  const formattedSize = showFileSize
    ? FileTypeUtil.formatFileSize(file.size)
    : null;

  return (
    <div
      className={clsx(
        "flex items-center rounded-lg p-2 bg-theme-bg-secondary",
        "border border-theme-border",
        "max-w-xs relative group hover:border-theme-border-strong theme-transition",
        className,
      )}
    >
      <div
        className={clsx(
          "flex justify-center items-center",
          "h-10 w-10 rounded-md bg-theme-bg-primary",
          "mr-2",
        )}
      >
        <IconComponent
          className="h-5 w-5"
          style={{ color: typeConfig.iconColor }}
        />
      </div>
      <div className="flex-1 min-w-0 mr-1">
        <p className="text-sm font-medium text-theme-fg-primary truncate">
          {truncateFilename(file.name)}
        </p>
        <div className="flex items-center text-xs text-theme-fg-secondary">
          <span className="uppercase">{typeConfig.displayName}</span>
          {showFileSize && formattedSize && (
            <>
              <span className="mx-1">•</span>
              <span>{formattedSize}</span>
            </>
          )}
        </div>
      </div>
      {showRemoveButton && (
        <Button
          onClick={() => onRemove(file)}
          variant="icon-only"
          size="sm"
          className="ml-1 -mr-1 hover:bg-theme-bg-hover"
          icon={<XMarkIcon className="h-4 w-4" />}
          aria-label="Remove file"
        />
      )}
    </div>
  );
};

/**
 * Truncate a long filename for display
 * @param filename Filename to truncate
 * @param maxLength Maximum length before truncation
 * @returns Truncated filename
 */
const truncateFilename = (filename: string, maxLength = 30): string => {
  if (filename.length <= maxLength) return filename;

  const extension = filename.split(".").pop() || "";
  const nameWithoutExtension = filename.substring(
    0,
    filename.length - extension.length - 1,
  );

  if (nameWithoutExtension.length <= maxLength - 3 - extension.length) {
    return filename;
  }

  return `${nameWithoutExtension.substring(0, maxLength - 3 - extension.length)}...${extension ? `.${extension}` : ""}`;
};
