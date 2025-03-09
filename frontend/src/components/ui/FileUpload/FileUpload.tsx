import React, { useState, useMemo } from "react";

import { FilePreview } from "./FilePreview";
import { FileUploadButton } from "./FileUploadButton";

import type { FileUploadItem } from "../../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "../../../utils/fileTypes";

interface FileUploadProps {
  /** Callback when files are selected */
  onFilesSelected?: (files: FileUploadItem[]) => void;
  /** Array of accepted file types */
  acceptedFileTypes?: FileType[];
  /** Whether multiple files can be selected */
  multiple?: boolean;
  /** Custom button label */
  buttonLabel?: string;
  /** Initial list of files to show */
  initialFiles?: FileUploadItem[];
  /** Whether the component is in a loading state */
  isLoading?: boolean;
  /** Whether the component is disabled */
  disabled?: boolean;
}

/**
 * Component for file uploads with previews
 */
export const FileUpload: React.FC<FileUploadProps> = ({
  onFilesSelected,
  acceptedFileTypes = [],
  multiple = false,
  buttonLabel,
  initialFiles = [],
  isLoading = false,
  disabled = false,
}) => {
  // State to track uploaded files
  const [files, setFiles] = useState<FileUploadItem[]>(initialFiles);

  // Determines if the "add file" button should be shown
  const showUploadButton = useMemo(
    () => multiple || files.length === 0,
    [multiple, files.length],
  );

  // Handle when files are uploaded
  const handleFilesUploaded = (uploadedFiles: FileUploadItem[]) => {
    if (!uploadedFiles.length) return;

    setFiles((prevFiles) => {
      let newFiles: FileUploadItem[];

      if (multiple) {
        // Add new files to existing files, avoiding duplicates
        const newFilesMap = new Map<string, FileUploadItem>();

        // Add existing files to map
        prevFiles.forEach((file) => newFilesMap.set(file.id, file));

        // Add new files, overwriting any with same ID
        uploadedFiles.forEach((file) => newFilesMap.set(file.id, file));

        newFiles = Array.from(newFilesMap.values());
      } else {
        // In single file mode, replace existing files
        newFiles = uploadedFiles;
      }

      // Call callback with all files
      if (onFilesSelected) {
        onFilesSelected(newFiles);
      }

      return newFiles;
    });
  };

  // Handle removing a file
  const handleRemoveFile = (fileId: string) => {
    setFiles((prevFiles) => {
      const newFiles = prevFiles.filter((file) => file.id !== fileId);

      // Call callback with updated files
      if (onFilesSelected) {
        onFilesSelected(newFiles);
      }

      return newFiles;
    });
  };

  // Remove all files at once
  const handleRemoveAllFiles = () => {
    setFiles([]);

    // Call callback with empty array
    if (onFilesSelected) {
      onFilesSelected([]);
    }
  };

  // If there are no files and we're not allowing uploads, render nothing
  if (files.length === 0 && !showUploadButton) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* File previews */}
      {files.length > 0 && (
        <div className="space-y-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-theme-fg-secondary">
              Attachments ({files.length})
            </h3>
            {files.length > 1 && (
              <button
                onClick={handleRemoveAllFiles}
                className="text-xs text-gray-500 hover:text-gray-700"
                disabled={isLoading || disabled}
              >
                Remove all
              </button>
            )}
          </div>

          {files.map((file) => (
            <FilePreview
              key={file.id}
              file={file}
              onRemove={handleRemoveFile}
              disabled={isLoading || disabled}
            />
          ))}
        </div>
      )}

      {/* Upload button */}
      {showUploadButton && (
        <FileUploadButton
          onFilesUploaded={handleFilesUploaded}
          acceptedFileTypes={acceptedFileTypes}
          multiple={multiple}
          label={buttonLabel}
          disabled={isLoading || disabled}
          iconOnly={true}
        />
      )}
    </div>
  );
};
