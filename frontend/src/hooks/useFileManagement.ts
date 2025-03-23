import { useState, useCallback } from "react";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface FileWithSize extends FileUploadItem {
  size?: number;
}

interface UseFileManagementProps {
  /** Maximum number of files allowed */
  maxFiles?: number;
  /** Initial files to display */
  initialFiles?: FileUploadItem[];
  /** Callback when files change */
  onFilesChange?: (files: FileUploadItem[]) => void;
}

interface UseFileManagementResult {
  /** Current files */
  files: FileWithSize[];
  /** Add new files */
  handleNewFiles: (files: FileUploadItem[]) => void;
  /** Remove a single file */
  handleRemoveFile: (fileIdOrFile: string | File) => void;
  /** Clear all files */
  handleClearFiles: () => void;
}

/**
 * Hook to manage file collections with add, remove, and clear operations
 */
export function useFileManagement({
  maxFiles = 5,
  initialFiles = [],
  onFilesChange,
}: UseFileManagementProps = {}): UseFileManagementResult {
  const [files, setFiles] = useState<FileWithSize[]>(
    initialFiles.map((file) => ({
      ...file,
      size: undefined,
    })),
  );

  // Handle new files being added
  const handleNewFiles = useCallback(
    (newFiles: FileUploadItem[]) => {
      // Add file size information to the uploaded files
      const enhancedFiles = newFiles.map((file) => ({
        ...file,
        size: undefined, // Set to undefined since we don't have size info from the API
      }));

      setFiles((prev) => {
        // Limit to maxFiles
        const updatedFiles = [...prev, ...enhancedFiles].slice(-maxFiles);
        // Notify parent component
        onFilesChange?.(updatedFiles);
        return updatedFiles;
      });
    },
    [maxFiles, onFilesChange],
  );

  // Remove a single file
  const handleRemoveFile = useCallback(
    (fileIdOrFile: string | File) => {
      // For File objects, we would need to compare by name/lastModified/etc
      // For FileUploadItem objects, we compare by ID
      const fileId =
        typeof fileIdOrFile === "string"
          ? fileIdOrFile
          : "id" in fileIdOrFile
            ? (fileIdOrFile as { id: string }).id
            : undefined;

      setFiles((prev) => {
        // Remove file with matching ID
        const updatedFiles = fileId
          ? prev.filter((file) => file.id !== fileId)
          : prev;

        // Notify parent component
        onFilesChange?.(updatedFiles);
        return updatedFiles;
      });
    },
    [onFilesChange],
  );

  // Clear all files
  const handleClearFiles = useCallback(() => {
    setFiles([]);
    onFilesChange?.([]);
  }, [onFilesChange]);

  return {
    files,
    handleNewFiles,
    handleRemoveFile,
    handleClearFiles,
  };
}
