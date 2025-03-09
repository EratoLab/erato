import { XMarkIcon } from "@heroicons/react/24/outline";
import React, { useMemo } from "react";

import { FILE_TYPES } from "../../../utils/fileTypes";

import type { FileUploadItem } from "../../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "../../../utils/fileTypes";

/**
 * Props for the FilePreview component
 */
export interface FilePreviewProps {
  /** The file to preview */
  file: FileUploadItem;
  /** Callback when file is removed */
  onRemove: (fileId: string) => void;
  /** Whether the component is disabled */
  disabled?: boolean;
}

/**
 * Determine file type based on filename extension
 */
export const getFileType = (filename: string): FileType => {
  const fileExtension = filename.split(".").pop()?.toLowerCase() ?? "";

  // Find matching file type in our configuration
  for (const [type, config] of Object.entries(FILE_TYPES)) {
    if (config.extensions.includes(fileExtension)) {
      return type as FileType;
    }
  }

  return "other";
};

/**
 * Component that displays a preview of an uploaded file with its icon and a remove button
 */
export const FilePreview: React.FC<FilePreviewProps> = ({
  file,
  onRemove,
  disabled,
}) => {
  // Memoize file type determination to avoid recalculating on each render
  const fileType = useMemo(() => getFileType(file.filename), [file.filename]);

  // Get file type configuration
  const fileConfig = FILE_TYPES[fileType];
  const Icon = fileConfig.icon;

  return (
    <div className="mb-2 flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 p-2">
      <div className="flex items-center space-x-2">
        <div className="shrink-0">
          <Icon className="size-5" style={{ color: fileConfig.iconColor }} />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium text-gray-900"
            title={file.filename}
          >
            {file.filename}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(file.id)}
        disabled={disabled}
        className={`ml-2 inline-flex items-center rounded-full border border-transparent p-1 text-gray-400 ${disabled ? "cursor-not-allowed opacity-50" : "hover:bg-gray-100 hover:text-gray-500"} focus:outline-none focus:ring-2 focus:ring-blue-500`}
        aria-label={`Remove ${file.filename}`}
      >
        <XMarkIcon className="size-4" />
      </button>
    </div>
  );
};
