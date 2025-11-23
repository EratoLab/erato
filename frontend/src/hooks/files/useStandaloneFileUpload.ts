import { useCallback, useState } from "react";

import {
  fetchUploadFile,
  type UploadFileVariables,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createLogger } from "@/utils/debugLogger";

import {
  UploadTooLargeError,
  UploadUnknownError,
  type UploadError,
  isUploadTooLarge,
} from "./errors";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("HOOK", "useStandaloneFileUpload");

interface UseStandaloneFileUploadResult {
  /** Upload files without associating them with a chat */
  uploadFiles: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Whether an upload is in progress */
  isUploading: boolean;
  /** Error from upload process */
  error: UploadError | null;
  /** Clear the error state */
  clearError: () => void;
}

/**
 * Hook for uploading files without associating them with a chat
 *
 * This is used for features like Assistant file attachments where files
 * need to be uploaded independently before being associated with an entity.
 *
 * @example
 * ```tsx
 * const { uploadFiles, isUploading, error } = useStandaloneFileUpload();
 *
 * const handleUpload = async (files: File[]) => {
 *   const uploadedFiles = await uploadFiles(files);
 *   if (uploadedFiles) {
 *     // Use the file IDs from uploadedFiles
 *   }
 * };
 * ```
 */
export function useStandaloneFileUpload(): UseStandaloneFileUploadResult {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (isUploading || files.length === 0) return;

      let uploadedItems: FileUploadItem[] | undefined;

      try {
        setIsUploading(true);
        setError(null);

        logger.log(`Uploading ${files.length} standalone file(s)`);

        // Create FormData for multipart upload
        const formData = new FormData();
        files.forEach((file) => {
          formData.append("file", file, file.name);
        });

        // Prepare variables for the fetch function
        // Note: No chat_id query parameter - this creates standalone file uploads
        const variables = {
          queryParams: {},
          body: formData as unknown,
          headers: {
            "Content-Type": "multipart/form-data",
          },
        };

        // Call fetchUploadFile directly
        let result;
        try {
          result = await fetchUploadFile(variables as UploadFileVariables);
          logger.log("Standalone file upload successful, result:", result);
        } catch (uploadError) {
          logger.error("Error calling fetchUploadFile:", uploadError);

          // Check for file too large error
          if (isUploadTooLarge(uploadError)) {
            throw new UploadTooLargeError();
          }

          // Fallback to unknown error
          throw new UploadUnknownError(
            // eslint-disable-next-line lingui/no-unlocalized-strings
            String(uploadError) || "Failed to upload files",
          );
        }

        if (result.files.length > 0) {
          uploadedItems = result.files;
          logger.log(`Successfully uploaded ${result.files.length} file(s)`);
        }
      } catch (err) {
        logger.error("Error uploading standalone files:", err);
        const isKnownError =
          err instanceof UploadTooLargeError ||
          err instanceof UploadUnknownError;

        setError(isKnownError ? err : new UploadUnknownError());
      } finally {
        setIsUploading(false);
      }

      return uploadedItems;
    },
    [isUploading],
  );

  return {
    uploadFiles,
    isUploading,
    error,
    clearError,
  };
}
