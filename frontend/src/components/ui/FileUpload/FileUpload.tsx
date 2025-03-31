import React, { useCallback, memo, useEffect } from "react";

import { useFileDropzone } from "@/hooks/files";
import { FILE_TYPES } from "@/utils/fileTypes";

import { FilePreviewButton } from "./FilePreviewButton";
import { FileUploadButton } from "./FileUploadButton";
import { FileUploadProgress } from "./FileUploadProgress";
import { Button } from "../Controls/Button";
import { PlusIcon } from "../icons";
import { DROP_ZONE_STYLES } from "./fileUploadStyles";

import type { FileUploadItemWithSize } from "./FilePreviewBase";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

/**
 * Props for the main FileUpload component
 */
export interface FileUploadProps {
  /** Callback when files are successfully uploaded */
  onFilesUploaded?: (files: FileUploadItem[]) => void;
  /** Array of accepted file types */
  acceptedFileTypes?: FileType[];
  /** Whether multiple files can be selected */
  multiple?: boolean;
  /** Custom button label */
  buttonLabel?: string;
  /** Drop zone text */
  dropZoneText?: string;
  /** CSS class name for the container */
  className?: string;
  /** Whether the upload is disabled */
  disabled?: boolean;
  /** Maximum number of files allowed */
  maxFiles?: number;
  /** Show only the button without the drop zone */
  buttonOnly?: boolean;
  /** Show progress during upload */
  showProgress?: boolean;
  /** Custom CSS class for the button */
  buttonClassName?: string;
  /** Whether to show only the icon in the button */
  buttonIconOnly?: boolean;
  /** Show file previews after upload */
  showFilePreviews?: boolean;
  /** Initial files to display (optional) */
  initialFiles?: FileUploadItem[];
  /** Show file type labels in previews */
  showFileTypes?: boolean;
}

/**
 * Enhanced FileUpload component with drop zone and previews
 *
 * This component provides a complete file upload experience, including:
 * - File selection via button or drag-and-drop using react-dropzone
 * - Upload progress indication with simulated progress
 * - File previews with remove options
 * - Comprehensive error handling with validation
 * - Support for file type restrictions and size limits
 */
export const FileUpload = memo<FileUploadProps>(
  ({
    onFilesUploaded,
    acceptedFileTypes = [],
    multiple = false,
    buttonLabel = "Upload Files",
    dropZoneText = "Drag files here or click to upload",
    className = "",
    disabled = false,
    maxFiles = 5,
    buttonOnly = false,
    showProgress = true,
    buttonClassName = "",
    buttonIconOnly = false,
    showFilePreviews = true,
    initialFiles = [],
    showFileTypes = false,
  }) => {
    // Use our modernized file upload hook
    const {
      uploadFiles,
      isUploading,
      uploadedFiles,
      error: uploadError,
      clearFiles,
      getRootProps,
      getInputProps,
      isDragActive,
      isDragAccept,
      isDragReject,
    } = useFileDropzone({
      acceptedFileTypes,
      multiple,
      maxFiles,
      disabled,
      onFilesUploaded,
    });

    // Convert to FileUploadItemWithSize for compatibility
    const enhancedUploadedFiles = uploadedFiles.map((file) => ({
      ...file,
      size: undefined,
    })) as FileUploadItemWithSize[];

    // Initialize with initial files if provided
    useEffect(() => {
      if (
        initialFiles.length > 0 &&
        uploadedFiles.length === 0 &&
        onFilesUploaded
      ) {
        onFilesUploaded(initialFiles);
      }
    }, [initialFiles, uploadedFiles.length, onFilesUploaded]);

    // Calculate upload progress based on isUploading state
    const uploadProgress = isUploading ? 90 : uploadError ? 0 : 100;

    // Handle removing a file
    const handleRemoveFile = useCallback(
      (fileId: string) => {
        const updatedFiles = uploadedFiles.filter((f) => f.id !== fileId);

        // Update state through hook API
        if (updatedFiles.length === 0) {
          clearFiles();
        } else if (onFilesUploaded) {
          onFilesUploaded(updatedFiles);
        }
      },
      [uploadedFiles, onFilesUploaded, clearFiles],
    );

    // Clear all uploaded files
    const handleClearFiles = useCallback(() => {
      clearFiles();
      if (onFilesUploaded) {
        onFilesUploaded([]);
      }
    }, [onFilesUploaded, clearFiles]);

    // Determine container classes with enhanced dropzone state
    const containerClasses = [
      DROP_ZONE_STYLES.container,
      isDragActive ? DROP_ZONE_STYLES.active : DROP_ZONE_STYLES.default,
      isDragAccept ? "border-green-500 bg-green-50 dark:bg-green-900/20" : "",
      isDragReject ? "border-red-500 bg-red-50 dark:bg-red-900/20" : "",
      disabled ? DROP_ZONE_STYLES.disabled : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={`space-y-4 ${className}`}>
        {/* Upload interface */}
        {buttonOnly ? (
          <FileUploadButton
            onFilesUploaded={onFilesUploaded}
            acceptedFileTypes={acceptedFileTypes}
            multiple={multiple}
            label={buttonLabel}
            className={buttonClassName}
            disabled={
              disabled ||
              (multiple
                ? enhancedUploadedFiles.length >= maxFiles
                : enhancedUploadedFiles.length > 0)
            }
            iconOnly={buttonIconOnly}
            performFileUpload={async (files) => {
              await uploadFiles(files);
              return uploadedFiles;
            }}
            isUploading={isUploading}
            uploadError={uploadError instanceof Error ? uploadError : null}
          />
        ) : (
          <div {...getRootProps({ className: containerClasses })}>
            <input {...getInputProps()} />
            <div className="flex flex-col items-center justify-center p-4">
              <PlusIcon className={DROP_ZONE_STYLES.icon} />
              <p className={DROP_ZONE_STYLES.text}>
                {isDragActive
                  ? isDragAccept
                    ? "Drop files to upload..."
                    : "Some files won't be accepted..."
                  : dropZoneText}
              </p>
              {!isDragActive && (
                <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">
                  {acceptedFileTypes.length > 0
                    ? `Accepted types: ${acceptedFileTypes.map((type) => FILE_TYPES[type].displayName).join(", ")}`
                    : "All file types accepted"}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Error messages */}
        {uploadError && (
          <div className="rounded-md bg-[var(--theme-error-bg)] p-2 text-sm text-[var(--theme-error-fg)]">
            {uploadError instanceof Error
              ? uploadError.message
              : String(uploadError)}
          </div>
        )}

        {/* Progress bar during upload */}
        {showProgress && isUploading && (
          <FileUploadProgress progress={uploadProgress} className="my-2" />
        )}

        {/* File previews */}
        {showFilePreviews && enhancedUploadedFiles.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--theme-fg-secondary)]">
                Uploaded Files ({enhancedUploadedFiles.length}/{maxFiles})
              </h3>
              {enhancedUploadedFiles.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFiles}
                  className="text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg)]"
                >
                  Clear All
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {enhancedUploadedFiles.map((file) => (
                <FilePreviewButton
                  key={file.id}
                  file={file}
                  onRemove={(fileIdOrFile) => {
                    // Ensure we only pass the ID string
                    if (typeof fileIdOrFile === "string") {
                      handleRemoveFile(fileIdOrFile);
                    } else if (
                      fileIdOrFile &&
                      typeof fileIdOrFile === "object" &&
                      "id" in fileIdOrFile &&
                      typeof fileIdOrFile.id === "string"
                    ) {
                      handleRemoveFile(fileIdOrFile.id);
                    }
                  }}
                  disabled={isUploading || disabled}
                  showSize={true}
                  showFileType={showFileTypes}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
);

FileUpload.displayName = "FileUpload";
