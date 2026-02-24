import { useCallback, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";

import {
  useCreateChat,
  fetchUploadFile,
  type UploadFileVariables,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useUploadFeature } from "@/providers/FeatureConfigProvider";
import { useFileCapabilitiesContext } from "@/providers/FileCapabilitiesProvider";
import { createLogger } from "@/utils/debugLogger";
import { validateFiles } from "@/utils/fileCapabilities";
import { FileTypeUtil, FILE_TYPES } from "@/utils/fileTypes";

import {
  UploadTooLargeError,
  UploadUnknownError,
  UnsupportedFileTypeError,
  type UploadError,
  isUploadTooLarge,
} from "./errors";
import { useFileUploadStore } from "./useFileUploadStore";

import type {
  FileUploadItem,
  FileUploadResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type { FileRejection } from "react-dropzone";

const logger = createLogger("HOOK", "useFileDropzone");

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
  /** Optional assistant ID to associate with a silently created chat */
  assistantId?: string;
  /** Selected chat provider ID for silently created chats */
  chatProviderId?: string;
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
  error: UploadError | null;
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
  assistantId,
  chatProviderId,
  // onSilentChatCreated,
}: UseFileDropzoneProps): UseFileDropzoneResult {
  // Check if upload feature is enabled
  const {
    enabled: uploadEnabled,
    maxSizeBytes,
    maxSizeFormatted,
  } = useUploadFeature();

  // Get file capabilities for pre-upload validation
  const { capabilities, isLoading: isLoadingCapabilities } =
    useFileCapabilitiesContext();

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

  // Keep latest selected model for silent-chat creation even if dropzone callbacks are stale.
  const latestChatProviderIdRef = useRef<string | undefined>(chatProviderId);
  useEffect(() => {
    latestChatProviderIdRef.current = chatProviderId;
  }, [chatProviderId]);

  // Add create chat mutation for silent chat creation
  const createChatMutation = useCreateChat({
    onError: (error) => {
      logger.error("Failed to create chat for file upload:", error);
      setError(
        // eslint-disable-next-line lingui/no-unlocalized-strings
        new UploadUnknownError("Failed to prepare chat for file upload"),
      );
      setUploading(false);
    },
  });

  // Calculate max file size based on backend limit and accepted file types
  const getMaxFileSize = useCallback((): number => {
    // Start with the backend-configured max upload size
    let maxSize = maxSizeBytes;

    // If specific file types are accepted, check their limits too
    if (acceptedFileTypes.length > 0) {
      const typeMaxSize = acceptedFileTypes.reduce((max, type) => {
        const typeConfig = FILE_TYPES[type];
        if (!typeConfig.enabled || !typeConfig.maxSize) return max;
        return Math.max(max, typeConfig.maxSize);
      }, 0);

      // Use the smaller of backend limit and file type limit
      if (typeMaxSize > 0) {
        maxSize = Math.min(maxSize, typeMaxSize);
      }
    }

    return maxSize;
  }, [acceptedFileTypes, maxSizeBytes]);

  // Function to upload files
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (disabled || isUploading || files.length === 0) return;

      let uploadedItems: FileUploadItem[] | undefined;

      try {
        setUploading(true);
        setError(null);

        // Pre-validate files against capabilities (if loaded)
        if (!isLoadingCapabilities && capabilities.length > 0) {
          const { valid, invalid } = validateFiles(files, capabilities);

          // If there are invalid files, throw error and don't upload ANY files
          if (invalid.length > 0) {
            throw new UnsupportedFileTypeError(invalid.map((f) => f.name));
          }

          // Only proceed with valid files
          files = valid;
        } else {
          // Capabilities not loaded - log warning and allow upload (backend will validate)
          logger.warn("File capabilities not loaded, skipping pre-validation");
        }

        const filesToUpload = files.slice(0, multiple ? maxFiles : 1);

        // Determine which chat ID to use for the upload
        let uploadChatId = chatId;

        // If no chatId exists, create one silently first
        if (!uploadChatId) {
          logger.log("Creating silent chat for file uploads");
          const createChatResult = await createChatMutation.mutateAsync({
            body: {
              ...(assistantId ? { assistant_id: assistantId } : {}),
              ...(latestChatProviderIdRef.current
                ? { chat_provider_id: latestChatProviderIdRef.current }
                : {}),
            },
          });
          logger.log("Silent chat creation result:", createChatResult);
          uploadChatId = createChatResult.chat_id;
          // Set the silentChatId in the store
          logger.log(`Setting silentChatId in store: ${uploadChatId}`);
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
          logger.log("File upload API call successful, result:", result);
        } catch (uploadError) {
          logger.error("Error calling fetchUploadFile:", uploadError);

          // Check for fetch-like error with status
          if (isUploadTooLarge(uploadError)) {
            throw new UploadTooLargeError(maxSizeFormatted);
          }

          // Fallback to unknown error
          throw new UploadUnknownError(
            // eslint-disable-next-line lingui/no-unlocalized-strings
            String(uploadError) || "Failed to upload files",
          );
        }

        if (result.files.length > 0) {
          addFiles(result.files);
          onFilesUploaded?.(result.files);
          uploadedItems = result.files; // Store the result
        }
      } catch (err) {
        logger.error("Error uploading files (outer catch):", err);
        const isKnownError =
          err instanceof UploadTooLargeError ||
          err instanceof UploadUnknownError ||
          err instanceof UnsupportedFileTypeError;

        setError(isKnownError ? err : new UploadUnknownError());
      } finally {
        setUploading(false);
      }

      return uploadedItems; // Return the uploaded items
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isUploading is handled separately
    [
      capabilities,
      isLoadingCapabilities,
      disabled,
      multiple,
      maxFiles,
      chatId,
      assistantId,
      chatProviderId,
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
        // Check if any rejection is due to file size
        const hasSizeError = rejectedFiles.some((rejection) =>
          rejection.errors.some((e) => e.code === "file-too-large"),
        );

        if (hasSizeError) {
          setError(new UploadTooLargeError(maxSizeFormatted));
          return;
        }

        // Other rejection reasons
        const errorMessages = rejectedFiles.map((rejection) => {
          const { file, errors } = rejection;
          return `${file.name}: ${errors.map((e) => e.message).join(", ")}`;
        });
        setError(new UploadUnknownError(errorMessages.join("; ")));
        return;
      }

      // If we have accepted files, upload them
      if (acceptedFiles.length > 0) {
        void uploadFiles(acceptedFiles);
      }
    },
    [disabled, isUploading, uploadFiles, setError, maxSizeFormatted],
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
    disabled: disabled || isUploading || !uploadEnabled,
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
