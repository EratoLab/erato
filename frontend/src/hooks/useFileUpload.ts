import { useState } from "react";

import { useUploadFile } from "../lib/generated/v1betaApi/v1betaApiComponents";
import { FileTypeUtil } from "../utils/fileTypes";

import type {
  FileUploadItem,
  MultipartFormFile,
} from "../lib/generated/v1betaApi/v1betaApiSchemas";

interface UploadOptions {
  /** Function to call when upload starts */
  onUploadStart?: () => void;
  /** Function to call when upload completes successfully */
  onUploadSuccess?: (files: FileUploadItem[]) => void;
  /** Function to call when upload fails */
  onUploadError?: (error: Error) => void;
}

interface FileUploadResult {
  /** Upload the given files */
  uploadFiles: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Whether an upload is currently in progress */
  isUploading: boolean;
  /** Any error that occurred during upload */
  error: Error | null;
  /** The uploaded files (if any) */
  uploadedFiles: FileUploadItem[];
  /** Reset the upload state */
  reset: () => void;
}

/**
 * Hook for handling file uploads to the API
 */
export function useFileUpload(options?: UploadOptions): FileUploadResult {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<FileUploadItem[]>([]);

  // Use the API mutation for file uploads
  const uploadMutation = useUploadFile();

  /**
   * Reset the upload state
   */
  const reset = () => {
    setIsUploading(false);
    setError(null);
    setUploadedFiles([]);
  };

  /**
   * Upload files to the API
   */
  const uploadFiles = async (
    files: File[],
  ): Promise<FileUploadItem[] | undefined> => {
    if (!files.length) return [];

    try {
      setIsUploading(true);
      setError(null);

      // Call the onUploadStart callback
      options?.onUploadStart?.();

      // Validate the files before uploading
      const invalidFiles = files
        .map((file) => {
          const result = FileTypeUtil.validateFile(file);
          return result.valid
            ? null
            : {
                file,
                error: result.error ?? "Invalid file",
              };
        })
        .filter(Boolean);

      if (invalidFiles.length > 0) {
        throw new Error(
          `Invalid files: ${invalidFiles.map((f) => f?.file.name).join(", ")}`,
        );
      }

      // Convert files to MultipartFormFile format
      const formFiles: MultipartFormFile[] = files.map((file) => ({
        file: file, // This is a Blob
        name: file.name,
      }));

      // Call the API mutation
      const result = await uploadMutation.mutateAsync({
        body: formFiles,
      });

      // Store the uploaded files
      setUploadedFiles(result.files);

      // Call the onUploadSuccess callback
      options?.onUploadSuccess?.(result.files);

      return result.files;
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("File upload failed");
      setError(error);

      // Call the onUploadError callback
      options?.onUploadError?.(error);

      return undefined;
    } finally {
      setIsUploading(false);
    }
  };

  return {
    uploadFiles,
    isUploading,
    error,
    uploadedFiles,
    reset,
  };
}
