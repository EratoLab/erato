import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";

import { FileTypeUtil, FILE_TYPES } from "@/utils/fileTypes";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type { FileRejection } from "react-dropzone";

interface UseFileDropzoneProps {
  /** Array of accepted file types */
  acceptedFileTypes?: FileType[];
  /** Whether multiple files can be selected */
  multiple?: boolean;
  /** Maximum number of files allowed */
  maxFiles?: number;
  /** Whether the dropzone is disabled */
  disabled?: boolean;
  /** Whether an upload is in progress */
  isUploading?: boolean;
  /** Function to upload files */
  performFileUpload?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Callback when files are successfully uploaded */
  onFilesUploaded?: (files: FileUploadItem[]) => void;
}

interface UseFileDropzoneResult {
  /** react-dropzone getRootProps */
  getRootProps: ReturnType<typeof useDropzone>["getRootProps"];
  /** react-dropzone getInputProps */
  getInputProps: ReturnType<typeof useDropzone>["getInputProps"];
  /** Whether files are being dragged over the dropzone */
  isDragActive: boolean;
  /** Whether dragged files are valid */
  isDragAccept: boolean;
  /** Whether dragged files are invalid */
  isDragReject: boolean;
  /** Open the file dialog programmatically */
  open: () => void;
  /** Error message from dropzone validation */
  dropzoneError: string | null;
  /** Handle file drop */
  onDrop: (acceptedFiles: File[], rejectedFiles: FileRejection[]) => void;
  /** Get maximum file size for selected file types */
  getMaxSizeForFileTypes: () => number;
}

/**
 * Hook to handle file dropzone functionality
 */
export function useFileDropzone({
  acceptedFileTypes = [],
  multiple = false,
  maxFiles = 5,
  disabled = false,
  isUploading = false,
  performFileUpload,
  onFilesUploaded,
}: UseFileDropzoneProps): UseFileDropzoneResult {
  const [dropzoneError, setDropzoneError] = useState<string | null>(null);

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

  // Handle file drop
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
        const filesToUpload = acceptedFiles.slice(0, multiple ? maxFiles : 1);

        if (filesToUpload.length > 0 && performFileUpload) {
          void performFileUpload(filesToUpload).then((files) => {
            if (files) {
              onFilesUploaded?.(files);
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
      performFileUpload,
      onFilesUploaded,
    ],
  );

  // Setup react-dropzone
  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject,
    open,
  } = useDropzone({
    onDrop,
    accept:
      acceptedFileTypes.length > 0
        ? FileTypeUtil.getAcceptObject(acceptedFileTypes)
        : undefined,
    multiple,
    disabled: disabled || isUploading,
    maxSize: getMaxSizeForFileTypes(),
  });

  return {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject,
    open,
    dropzoneError,
    onDrop,
    getMaxSizeForFileTypes,
  };
}
