import React, { useState, useCallback, memo, useEffect } from "react";
import { useDropzone } from "react-dropzone";

import { FileTypeUtil, FILE_TYPES } from "@/utils/fileTypes";

import { FilePreviewButton } from "./FilePreviewButton";
import { FileUploadButton } from "./FileUploadButton";
import { FileUploadProgress } from "./FileUploadProgress";
import { Button } from "../Controls/Button";
import { PlusIcon } from "../icons";
import { DROP_ZONE_STYLES } from "./fileUploadStyles";

import type { FileUploadItemWithSize } from "./FilePreviewBase";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type { FileRejection } from "react-dropzone";

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
  /** File upload function provided by a parent component */
  performFileUpload?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Whether a file upload is in progress */
  isUploading?: boolean;
  /** Any error that occurred during file upload */
  uploadError?: Error | null;
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
    performFileUpload,
    isUploading = false,
    uploadError = null,
  }) => {
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadedFiles, setUploadedFiles] = useState<
      FileUploadItemWithSize[]
    >(
      () =>
        initialFiles.map((file) => ({
          ...file,
          size: undefined,
        })) as FileUploadItemWithSize[],
    );
    const [dropzoneError, setDropzoneError] = useState<string | null>(null);

    // Determine if upload button should be disabled
    const isUploadDisabled =
      disabled ||
      (multiple ? uploadedFiles.length >= maxFiles : uploadedFiles.length > 0);

    // Handle new files being uploaded
    const handleNewFiles = useCallback(
      (files: FileUploadItem[]) => {
        // Add file size information to the uploaded files
        const enhancedFiles = files.map((file) => ({
          ...file,
          size: undefined, // Set to undefined since we don't have size info from the API
        })) as FileUploadItemWithSize[];

        setUploadedFiles((prev) => {
          // Limit to maxFiles
          const updatedFiles = [...prev, ...enhancedFiles].slice(-maxFiles);
          // Notify parent component with the standard FileUploadItem[]
          onFilesUploaded?.(updatedFiles);
          return updatedFiles;
        });
      },
      [maxFiles, onFilesUploaded],
    );

    // Initialize with initial files if provided
    useEffect(() => {
      if (initialFiles.length > 0 && uploadedFiles.length === 0) {
        handleNewFiles(initialFiles);
      }
    }, [initialFiles, uploadedFiles.length, handleNewFiles]);

    // Calculate max file size based on accepted file types
    const getMaxSizeForFileTypes = useCallback((): number => {
      if (!acceptedFileTypes.length) {
        return Infinity; // No size limit if all file types are allowed
      }

      // Find the largest max size among the accepted file types
      return acceptedFileTypes.reduce((maxSize, type) => {
        const config = FILE_TYPES[type];
        if (!config.enabled) return maxSize;

        // If no max size specified for this type, don't limit
        if (!config.maxSize) return Infinity;

        // Return the larger of current max or this type's max
        return Math.max(maxSize, config.maxSize);
      }, 0);
    }, [acceptedFileTypes]);

    // Simulated progress update for better UX
    useEffect(() => {
      if (!isUploading) {
        // Reset progress when not uploading
        if (uploadProgress !== 0) {
          const timer = setTimeout(() => {
            setUploadProgress(0);
          }, 500); // Show 100% for a moment before resetting
          return () => clearTimeout(timer);
        }
        return;
      }

      // Create a realistic progress simulation
      const simulateProgress = () => {
        // Calculate a random increment that slows down as it approaches 90%
        const getIncrement = (current: number) => {
          const remainingToNinety = 90 - current;
          if (remainingToNinety <= 0) return 0;
          // Smaller increments as we get closer to 90%
          return Math.max(0.5, Math.random() * (remainingToNinety / 10));
        };

        setUploadProgress((prev) => {
          // Cap at 90% for simulated progress (the last 10% happens when complete)
          const increment = getIncrement(prev);
          return Math.min(90, prev + increment);
        });
      };

      // Start simulation and update every 200ms
      const timer = setInterval(simulateProgress, 200);

      // Complete to 100% when upload is done
      if (uploadProgress >= 90) {
        clearInterval(timer);
        setUploadProgress(100);
      }

      return () => clearInterval(timer);
    }, [isUploading, uploadProgress]);

    // Handle file drop from react-dropzone
    const onDrop = useCallback(
      (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
        if (disabled || isUploading) return;

        // Clear previous errors
        setDropzoneError(null);

        // Handle rejections first
        if (rejectedFiles.length > 0) {
          const errorMessages = rejectedFiles.map((rejection) => {
            const { file, errors } = rejection;
            const errorTypes = errors.map((e) => e.code).join(", ");
            return `${file.name} (${errorTypes})`;
          });

          setDropzoneError(`Rejected files: ${errorMessages.join("; ")}`);
          return;
        }

        // Handle maxFiles limit
        if (acceptedFiles.length > 0) {
          const remainingSlots = maxFiles - uploadedFiles.length;
          const filesToUpload = acceptedFiles.slice(
            0,
            multiple ? remainingSlots : 1,
          );

          if (filesToUpload.length > 0 && performFileUpload) {
            void performFileUpload(filesToUpload).then((files) => {
              if (files) {
                handleNewFiles(files);
              }
            });
          }
        }
      },
      [
        disabled,
        isUploading,
        maxFiles,
        multiple,
        uploadedFiles.length,
        performFileUpload,
        handleNewFiles,
      ],
    );

    // Setup react-dropzone with validation
    const maxSize = getMaxSizeForFileTypes();

    const {
      getRootProps,
      getInputProps,
      isDragActive,
      isDragAccept,
      isDragReject,
    } = useDropzone({
      onDrop,
      accept:
        acceptedFileTypes.length > 0
          ? FileTypeUtil.getAcceptObject(acceptedFileTypes)
          : undefined,
      multiple,
      disabled: isUploadDisabled,
      maxSize: maxSize === Infinity ? undefined : maxSize,
      noClick: buttonOnly, // Disable clicks if buttonOnly mode
      noKeyboard: buttonOnly,
      maxFiles: multiple ? maxFiles - uploadedFiles.length : 1,
      validator: (file) => {
        const validation = FileTypeUtil.validateFile(file);
        if (!validation.valid) {
          return {
            code: "file-type-not-allowed",
            message: validation.error ?? "File type not allowed",
          };
        }
        return null;
      },
    });

    // Handle removing a file
    const handleRemoveFile = useCallback(
      (fileId: string) => {
        setUploadedFiles((prev) => {
          const updatedFiles = prev.filter((f) => f.id !== fileId);
          // Notify parent component
          onFilesUploaded?.(updatedFiles);
          return updatedFiles;
        });
      },
      [onFilesUploaded],
    );

    // Clear all uploaded files
    const handleClearFiles = useCallback(() => {
      setUploadedFiles([]);
      onFilesUploaded?.([]);
    }, [onFilesUploaded]);

    // Determine container classes with enhanced dropzone state
    const containerClasses = [
      DROP_ZONE_STYLES.container,
      isDragActive ? DROP_ZONE_STYLES.active : DROP_ZONE_STYLES.default,
      isDragAccept ? "border-green-500 bg-green-50 dark:bg-green-900/20" : "",
      isDragReject ? "border-red-500 bg-red-50 dark:bg-red-900/20" : "",
      isUploadDisabled ? DROP_ZONE_STYLES.disabled : "",
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
            disabled={isUploadDisabled}
            iconOnly={buttonIconOnly}
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
        {(uploadError ?? dropzoneError) && (
          <div className="rounded-md bg-[var(--theme-error-bg)] p-2 text-sm text-[var(--theme-error-fg)]">
            {uploadError?.message ?? dropzoneError}
          </div>
        )}

        {/* Progress bar during upload */}
        {showProgress && isUploading && (
          <FileUploadProgress progress={uploadProgress} className="my-2" />
        )}

        {/* File previews */}
        {showFilePreviews && uploadedFiles.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--theme-fg-secondary)]">
                Uploaded Files ({uploadedFiles.length}/{maxFiles})
              </h3>
              {uploadedFiles.length > 1 && (
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
              {uploadedFiles.map((file) => (
                <FilePreviewButton
                  key={file.id}
                  file={file}
                  onRemove={(fileIdOrFile) => {
                    // Ensure we only pass the ID string
                    if (typeof fileIdOrFile === "string") {
                      handleRemoveFile(fileIdOrFile);
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
