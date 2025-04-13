import { useCallback } from "react";
import { useDropzone } from "react-dropzone";

import {
  useCreateChat,
  fetchUploadFile,
  type UploadFileVariables,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { FileTypeUtil, FILE_TYPES } from "@/utils/fileTypes";

import { useFileUploadStore } from "./useFileUploadStore";

import type {
  FileUploadItem,
  FileUploadResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
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
  /** Existing chat ID to use for uploads, if any */
  chatId?: string | null;
  /** Called when a chat is silently created for file uploads */
  onSilentChatCreated?: (newChatId: string) => void;
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
  uploadFiles: (files: File[]) => Promise<FileUploadItem[] | undefined>;
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
  chatId = null,
  // onSilentChatCreated,
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
    setSilentChatId,
  } = useFileUploadStore();

  // Add create chat mutation for silent chat creation
  const createChatMutation = useCreateChat({
    onError: (error) => {
      console.error("Failed to create chat for file upload:", error);
      setError(new Error("Failed to prepare chat for file upload"));
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

      let uploadedItems: FileUploadItem[] | undefined;

      try {
        setUploading(true);
        setError(null);

        const filesToUpload = files.slice(0, multiple ? maxFiles : 1);

        // Determine which chat ID to use for the upload
        let uploadChatId = chatId;

        // If no chatId exists, create one silently first
        if (!uploadChatId) {
          console.log("[FILE_UPLOAD] Creating silent chat for file uploads");
          const createChatResult = await createChatMutation.mutateAsync({
            body: {},
          });
          console.log(
            "[FILE_UPLOAD] Silent chat creation result:",
            createChatResult,
          );
          uploadChatId = createChatResult.chat_id;
          // Set the silentChatId in the store
          console.log(
            `[FILE_UPLOAD] Setting silentChatId in store: ${uploadChatId}`,
          );
          setSilentChatId(uploadChatId);
        }

        // --- WORKAROUND START: Create FormData ---
        const formData = new FormData();
        filesToUpload.forEach((file) => {
          // Use the standard 'file' key expected by the backend/msw handler
          formData.append("file", file, file.name);
        });
        // --- WORKAROUND END ---

        // Prepare variables for the fetch function
        const variables = {
          queryParams: {
            chat_id: uploadChatId,
          },
          body: formData as unknown,
          headers: {
            "Content-Type": "multipart/form-data",
          },
        };

        // Call fetchUploadFile directly, bypassing the problematic hook
        let result: FileUploadResponse;
        try {
          // Use type assertion on the variables object for the call
          result = await fetchUploadFile(variables as UploadFileVariables);
          console.log(
            "[FILE_UPLOAD] File upload API call successful, result:",
            result,
          );
        } catch (uploadError) {
          console.error("Error calling fetchUploadFile:", uploadError);
          // Simplify error handling to satisfy linter
          throw new Error(String(uploadError) || "Failed to upload files");
        }

        if (result.files.length > 0) {
          addFiles(result.files);
          onFilesUploaded?.(result.files);
          uploadedItems = result.files; // Store the result
        }
      } catch (err) {
        console.error("Error uploading files (outer catch):", err);
        setError(
          err instanceof Error
            ? err
            : new Error("An unknown error occurred during upload"),
        );
      } finally {
        setUploading(false);
      }

      return uploadedItems; // Return the uploaded items
    },
    [
      disabled,
      isUploading,
      multiple,
      maxFiles,
      chatId,
      createChatMutation,
      // onSilentChatCreated,
      addFiles,
      onFilesUploaded,
      setUploading,
      setError,
      setSilentChatId,
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

  // Format any dropzone validation errors or manually set errors
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
