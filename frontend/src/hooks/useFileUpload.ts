import { useState } from "react";

import { FileTypeUtil } from "../utils/fileTypes";

import type { FileUploadItem } from "../lib/generated/v1betaApi/v1betaApiSchemas";

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

      // Use FormData to handle file uploads directly
      // This bypasses the deep merge issues in the generated client
      const formData = new FormData();

      // Append each file
      files.forEach((file) => {
        // Just append the file with the field name 'file'
        // Note: The backend should be able to handle multiple files with the same field name
        formData.append("file", file, file.name);
      });

      // Direct fetch approach to avoid the generated client's deepMerge issues
      const response = await fetch("/api/v1beta/me/files", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();

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
