import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

import { useUploadFile } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { FileTypeUtil, FILE_TYPES } from "@/utils/fileTypes";

import { useFileUploadStore } from "./useFileUploadStore";

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
  /** Error message from dropzone validation or upload */
  error: Error | string | null;
  /** Uploaded files */
  uploadedFiles: FileUploadItem[];
  /** Whether an upload is in progress */
  isUploading: boolean;
  /** Clear uploaded files */
  clearFiles: () => void;
  /** Upload files manually */
  uploadFiles: (files: File[]) => Promise<void>;
}

/**
 * Modern hook for handling file dropzone and upload functionality
 */
export function useFileDropzone({
  acceptedFileTypes = [],
  multiple = false,
  maxFiles = 5,
  disabled = false,
  onFilesUploaded,
}: UseFileDropzoneProps): UseFileDropzoneResult {
  // Use the Zustand store for state management
  const {
    uploadedFiles,
    isUploading,
    error: uploadError,
    setUploading,
    addFiles,
    setError,
    clearFiles,
  } = useFileUploadStore();

  // Use the generated API hook for file upload
  const uploadFileMutation = useUploadFile({
    onError: (error) => {
      console.error("File upload error:", error);
      setError(new Error("Failed to upload files"));
      setUploading(false);
    },
  });

  // Calculate max file size based on accepted file types
  const getMaxFileSize = useCallback((): number => {
    if (!acceptedFileTypes.length) {
      return Infinity; // No size limit if all file types are allowed
    }

    // Find the largest max size among the accepted file types
    return acceptedFileTypes.reduce((maxSize, type) => {
      const typeConfig = FILE_TYPES[type];
      if (!typeConfig.enabled) return maxSize;

      // If no max size specified for this type, don't limit
      if (!typeConfig.maxSize) return Infinity;

      // Return the larger of current max or this type's max
      return Math.max(maxSize, typeConfig.maxSize);
    }, 0);
  }, [acceptedFileTypes]);

  // Function to upload files
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (disabled || isUploading || files.length === 0) return;

      try {
        setUploading(true);
        setError(null);

        const filesToUpload = files.slice(0, multiple ? maxFiles : 1);

        // Add each file to the form data
        const uploadBodies = filesToUpload.map((file) => ({
          file,
          name: file.name,
        }));

        // Upload the files using our API client
        const result = await uploadFileMutation.mutateAsync({
          body: uploadBodies,
        });

        if (result.files.length > 0) {
          addFiles(result.files);
          onFilesUploaded?.(result.files);
        }
      } catch (err) {
        console.error("Error uploading files:", err);
        setError(
          err instanceof Error ? err : new Error("Failed to upload files"),
        );
      } finally {
        setUploading(false);
      }
    },
    [
      disabled,
      isUploading,
      multiple,
      maxFiles,
      uploadFileMutation,
      addFiles,
      onFilesUploaded,
      setUploading,
      setError,
    ],
  );

  // Handle file drop from react-dropzone
  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      if (disabled || isUploading) return;

      // Handle rejections first
      if (rejectedFiles.length > 0) {
        const errorMessages = rejectedFiles.map((rejection) => {
          const { file, errors } = rejection;
          return `${file.name}: ${errors.map((e) => e.message).join(", ")}`;
        });

        setError(new Error(`Invalid files: ${errorMessages.join("; ")}`));
        return;
      }

      // If we have accepted files, upload them
      if (acceptedFiles.length > 0) {
        void uploadFiles(acceptedFiles);
      }
    },
    [disabled, isUploading, uploadFiles, setError],
  );

  // Create the dropzone hook instance
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
    maxSize: getMaxFileSize(),
  });

  // Format any dropzone validation errors or API errors
  const error = uploadError ?? null;

  return {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragAccept,
    isDragReject,
    open,
    error,
    uploadedFiles,
    isUploading,
    clearFiles,
    uploadFiles,
  };
}
