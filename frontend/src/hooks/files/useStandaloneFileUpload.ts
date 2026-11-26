import { useCallback, useState } from "react";

import { sendWhenOnline } from "@/lib/connectivity/sendWhenOnline";
import {
  fetchUploadFile,
  type UploadFileVariables,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useUploadFeature } from "@/providers/FeatureConfigProvider";
import { createLogger } from "@/utils/debugLogger";
import { validateFileSizes } from "@/utils/validateFileSizes";

import {
  UnsupportedFileTypeError,
  UploadNetworkError,
  UploadTooLargeError,
  UploadUnknownError,
  type UploadError,
  toUploadError,
} from "./errors";
import { uploadTimeLimitMs } from "./uploadTimeLimit";

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
  const { maxSizeBytes, maxSizeFormatted } = useUploadFeature();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (isUploading || files.length === 0) return;

      const sizeValidation = validateFileSizes(files, maxSizeBytes);
      if (!sizeValidation.valid) {
        setError(
          new UploadTooLargeError(
            maxSizeFormatted,
            sizeValidation.oversizedFiles.map((file) => file.name),
          ),
        );
        return undefined;
      }

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

        let result;
        try {
          result = await sendWhenOnline(() =>
            fetchUploadFile({
              ...(variables as UploadFileVariables),
              requestTimeoutMs: uploadTimeLimitMs(
                files.reduce((sum, file) => sum + file.size, 0),
              ),
            }),
          );
          logger.log("Standalone file upload successful, result:", result);
        } catch (uploadError) {
          logger.error("Error calling fetchUploadFile:", uploadError);
          throw toUploadError(
            uploadError,
            files.map((file) => file.name),
            maxSizeFormatted,
          );
        }

        if (result.rejected_files && result.rejected_files.length > 0) {
          setError(new UnsupportedFileTypeError(result.rejected_files));
        }

        if (result.files.length > 0) {
          uploadedItems = result.files;
          logger.log(`Successfully uploaded ${result.files.length} file(s)`);
        } else if (result.rejected_files && result.rejected_files.length > 0) {
          uploadedItems = [];
        }
      } catch (err) {
        logger.error("Error uploading standalone files:", err);
        const isKnownError =
          err instanceof UploadTooLargeError ||
          err instanceof UploadUnknownError ||
          err instanceof UploadNetworkError;

        setError(isKnownError ? err : new UploadUnknownError(err));
      } finally {
        setIsUploading(false);
      }

      return uploadedItems;
    },
    [isUploading, maxSizeBytes, maxSizeFormatted],
  );

  return {
    uploadFiles,
    isUploading,
    error,
    clearError,
  };
}
