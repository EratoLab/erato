import { XMarkIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import React, { useState, useEffect } from "react";

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
  const [maxFilenameLength, setMaxFilenameLength] = useState(30);

  // Get the icon component for this file type
  const IconComponent = typeConfig.icon;

  // Create formatted file size string if needed
  const formattedSize = showFileSize
    ? FileTypeUtil.formatFileSize(file.size)
    : null;

  // Set max filename length based on screen size
  useEffect(() => {
    const handleResize = () => {
      setMaxFilenameLength(window.innerWidth < 640 ? 20 : 30);
    };

    handleResize(); // Initial check
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div
      className={clsx(
        "flex items-center rounded-lg bg-theme-bg-secondary p-2",
        "border border-theme-border",
        "theme-transition group relative w-full hover:border-theme-border-strong sm:max-w-xs",
        className,
      )}
    >
      <div
        className={clsx(
          "flex items-center justify-center",
          "size-10 rounded-md bg-theme-bg-primary",
          "mr-2 shrink-0",
        )}
      >
        <IconComponent
          className="size-5"
          style={{ color: typeConfig.iconColor }}
        />
      </div>
      <div className="mr-1 min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-theme-fg-primary">
          {truncateFilename(file.name, maxFilenameLength)}
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
          className="-mr-1 ml-1 touch-manipulation p-2 hover:bg-theme-bg-hover"
          icon={<XMarkIcon className="size-4" />}
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

  const extension = filename.split(".").pop() ?? "";
  const nameWithoutExtension = filename.substring(
    0,
    filename.length - extension.length - 1,
  );

  if (nameWithoutExtension.length <= maxLength - 3 - extension.length) {
    return filename;
  }

  return `${nameWithoutExtension.substring(0, maxLength - 3 - extension.length)}...${extension ? `.${extension}` : ""}`;
};
