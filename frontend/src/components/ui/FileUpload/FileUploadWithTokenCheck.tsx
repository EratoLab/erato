/**
 * FileUploadWithTokenCheck Component
 *
 * Extends the standard FileUpload component with token usage checking
 * Supports both local disk uploads and cloud file linking (OneDrive/Sharepoint)
 */
import { t } from "@lingui/core/macro";
import { useEffect, useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";

import { componentRegistry } from "@/config/componentRegistry";
import { UploadTooLargeError } from "@/hooks/files/errors";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { useFileUploadWithTokenCheck } from "@/hooks/files/useFileUploadWithTokenCheck";
import {
  fetchLinkFile,
  useCreateChat,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  useCloudProvidersFeature,
  useUploadFeature,
} from "@/providers/FeatureConfigProvider";
import { FileTypeUtil } from "@/utils/fileTypes";

import { CloudFilePickerModal } from "./CloudFilePickerModal";
import { FileSourceSelector } from "./FileSourceSelector";
import { FileUploadButton } from "./FileUploadButton";

import type {
  CloudProvider,
  SelectedCloudFile,
} from "@/lib/api/cloudProviders/types";
import type {
  FileUploadItem,
  LinkFileRequest,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type React from "react";

const getPreviewUrl = (file: { preview_url?: unknown }): string | undefined =>
  typeof file.preview_url === "string" ? file.preview_url : undefined;

interface FileUploadWithTokenCheckProps {
  /** Current message text to use for token estimation */
  message: string;
  /** Current chat ID */
  chatId?: string | null;
  /** Optional assistant ID to associate with a silently created chat */
  assistantId?: string;
  /** Previous message ID */
  previousMessageId?: string | null;
  /** Selected chat provider ID for new chats */
  chatProviderId?: string;
  /** Callback when files are successfully uploaded */
  onFilesUploaded?: (files: FileUploadItem[]) => void;
  /** Callback when token limit is exceeded */
  onTokenLimitExceeded?: (isExceeded: boolean) => void;
  /** Optional upload function supplied by a parent so drag/drop and buttons share one path */
  performFileUpload?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Optional upload error supplied by a parent */
  uploadError?: Error | null;
  /** Array of accepted file types */
  acceptedFileTypes?: FileType[];
  /** Whether multiple files can be selected */
  multiple?: boolean;
  /** Custom button label */
  label?: string;
  /** Whether to show only the icon in the button */
  iconOnly?: boolean;
  /** Maximum number of files allowed */
  maxFiles?: number;
  /** CSS class name for the button */
  className?: string;
  /** Whether the upload is disabled */
  disabled?: boolean;
  /** Callback when the combined processing (upload + estimation) state changes */
  onProcessingChange?: (isProcessing: boolean) => void;
}

/**
 * File upload button with integrated token usage checking
 * Note: Does not display its own warnings, defers to ChatInputTokenUsage
 */
export const FileUploadWithTokenCheck: React.FC<
  FileUploadWithTokenCheckProps
> = ({
  message,
  chatId,
  assistantId,
  previousMessageId,
  chatProviderId,
  onFilesUploaded,
  onTokenLimitExceeded,
  performFileUpload: externalPerformFileUpload,
  uploadError: externalUploadError = null,
  acceptedFileTypes = [],
  multiple = false,
  label = t({ id: "fileUpload.uploadFiles", message: "Upload Files" }),
  iconOnly = false,
  maxFiles = 5,
  className = "",
  disabled = false,
  onProcessingChange,
}) => {
  // Get cloud providers configuration
  const { availableProviders } = useCloudProvidersFeature();
  const hasCloudProviders = availableProviders.length > 0;
  const hasCustomSelector = componentRegistry.ChatFileSourceSelector != null;
  const shouldUseSourceSelector = hasCloudProviders || hasCustomSelector;

  // Get upload size limit for client-side validation
  const { maxSizeBytes, maxSizeFormatted } = useUploadFeature();

  // Cloud picker state
  const [cloudPickerOpen, setCloudPickerOpen] = useState(false);
  const [selectedCloudProvider, setSelectedCloudProvider] =
    useState<CloudProvider | null>(null);
  const [isLinkingFiles, setIsLinkingFiles] = useState(false);

  // File upload store for silent chat creation
  const { setSilentChatId } = useFileUploadStore();

  // Create chat mutation for silent chat creation
  const createChatMutation = useCreateChat();

  // Use the combined hook
  const {
    uploadFiles,
    isUploading,
    isEstimating,
    uploadError,
    exceedsTokenLimit,
  } = useFileUploadWithTokenCheck({
    message,
    chatId,
    assistantId,
    previousMessageId,
    chatProviderId,
    acceptedFileTypes,
    multiple,
    maxFiles,
    disabled,
  });

  const performDiskUpload = externalPerformFileUpload ?? uploadFiles;
  const resolvedUploadError =
    externalUploadError ?? (uploadError instanceof Error ? uploadError : null);

  // Get error setter from upload store for dropzone validation errors
  const { setError } = useFileUploadStore();

  const handleSelectedFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const uploadedFiles = await performDiskUpload(files);
      if (!externalPerformFileUpload && uploadedFiles && uploadedFiles.length > 0) {
        onFilesUploaded?.(uploadedFiles);
      }
    },
    [externalPerformFileUpload, onFilesUploaded, performDiskUpload],
  );

  // Setup react-dropzone for disk file selection when cloud providers are available
  const {
    open: openDiskFilePicker,
    getRootProps,
    getInputProps,
  } = useDropzone({
    onDrop: (acceptedFiles, rejectedFiles) => {
      // Handle file size rejections
      if (rejectedFiles.length > 0) {
        const hasSizeError = rejectedFiles.some((rejection) =>
          rejection.errors.some((e) => e.code === "file-too-large"),
        );

        if (hasSizeError) {
          setError(new UploadTooLargeError(maxSizeFormatted));
          return;
        }
      }

      // Upload accepted files
      if (acceptedFiles.length > 0) {
        void handleSelectedFiles(acceptedFiles);
      }
    },
    accept:
      acceptedFileTypes.length > 0
        ? FileTypeUtil.getAcceptObject(acceptedFileTypes)
        : undefined,
    multiple,
    disabled: disabled || isUploading,
    maxSize: maxSizeBytes, // Add client-side size validation
    noClick: true, // We'll manually open via the selector
    noKeyboard: true,
  });

  // Calculate combined processing state
  const isProcessing = isUploading || isEstimating || isLinkingFiles;

  // Handle disk file selection
  const handleSelectDisk = useCallback(() => {
    // Trigger the file picker dialog
    openDiskFilePicker();
  }, [openDiskFilePicker]);

  // Handle cloud provider selection
  const handleSelectCloud = useCallback((provider: CloudProvider) => {
    setSelectedCloudProvider(provider);
    setCloudPickerOpen(true);
  }, []);

  // Handle cloud file selection
  const handleCloudFilesSelected = useCallback(
    (files: SelectedCloudFile[]) => {
      void (async () => {
        if (files.length === 0 || !selectedCloudProvider) {
          setCloudPickerOpen(false);
          setSelectedCloudProvider(null);
          return;
        }

        try {
          setIsLinkingFiles(true);
          setCloudPickerOpen(false);

          // Determine which chat ID to use for linking (same pattern as disk upload)
          let linkChatId = chatId;

          // If no chatId exists, create one silently first
          if (!linkChatId) {
            const createChatResult = await createChatMutation.mutateAsync({
              body: {
                ...(assistantId ? { assistant_id: assistantId } : {}),
                ...(chatProviderId ? { chat_provider_id: chatProviderId } : {}),
              },
            });
            linkChatId = createChatResult.chat_id;
            // Set the silentChatId in the store
            setSilentChatId(linkChatId);
          }

          // Link files using the generated API client
          const allLinkedFiles: FileUploadItem[] = [];

          for (const file of files) {
            // Type assertion needed due to codegen bug with chat_id type
            // OpenAPI schema allows string|null, but codegen generates null|undefined
            const response = await fetchLinkFile({
              body: {
                source: selectedCloudProvider,
                chat_id: linkChatId,
                provider_metadata: {
                  drive_id: file.drive_id,
                  item_id: file.item_id,
                },
              } as unknown as LinkFileRequest,
            });

            // Transform response to FileUploadItem format
            allLinkedFiles.push(
              ...response.files.map((f) => {
                const previewUrl = getPreviewUrl(f);

                return {
                  id: f.id,
                  filename: f.filename,
                  download_url: f.download_url,
                  ...(previewUrl ? { preview_url: previewUrl } : {}),
                  file_capability: f.file_capability,
                } as FileUploadItem;
              }),
            );
          }

          // Trigger token estimation for the linked files
          if (allLinkedFiles.length > 0 && onFilesUploaded) {
            onFilesUploaded(allLinkedFiles);
          }

          setSelectedCloudProvider(null);
        } catch (error) {
          console.error("Error linking cloud files:", error);
          // TODO: Show error toast/notification to user
        } finally {
          setIsLinkingFiles(false);
        }
      })();
    },
    [
      selectedCloudProvider,
      onFilesUploaded,
      chatId,
      assistantId,
      chatProviderId,
      createChatMutation,
      setSilentChatId,
    ],
  );

  // Handle cloud picker close
  const handleCloudPickerClose = useCallback(() => {
    setCloudPickerOpen(false);
    setSelectedCloudProvider(null);
  }, []);

  // Effect to notify parent about processing state changes
  useEffect(() => {
    if (onProcessingChange) {
      onProcessingChange(isProcessing);
    }
  }, [isProcessing, onProcessingChange]);

  // Effect to notify parent about token limit changes
  // Now we only notify the parent and don't show warnings directly
  useEffect(() => {
    if (onTokenLimitExceeded) {
      onTokenLimitExceeded(exceedsTokenLimit);
    }
  }, [exceedsTokenLimit, onTokenLimitExceeded]);

  return (
    <div className="relative">
      {/* File upload button - show selector if cloud providers available */}
      {shouldUseSourceSelector ? (
        <>
          {/* Hidden dropzone input for disk uploads */}
          <div {...getRootProps({ className: "contents" })}>
            <input
              {...getInputProps()}
              aria-label={t({
                id: "fileUpload.disk.ariaLabel",
                message: "Upload files from disk",
              })}
            />
          </div>

          {/* Use custom component from registry if available, otherwise default */}
          {componentRegistry.ChatFileSourceSelector ? (
            <componentRegistry.ChatFileSourceSelector
              availableProviders={availableProviders}
              onSelectDisk={handleSelectDisk}
              onSelectCloud={handleSelectCloud}
              onSelectFiles={handleSelectedFiles}
              disabled={disabled || isProcessing}
              isProcessing={isProcessing}
              className={className}
            />
          ) : (
            <FileSourceSelector
              availableProviders={availableProviders}
              onSelectDisk={handleSelectDisk}
              onSelectCloud={handleSelectCloud}
              onSelectFiles={handleSelectedFiles}
              disabled={disabled || isProcessing}
              isProcessing={isProcessing}
              className={className}
            />
          )}
        </>
      ) : (
        <FileUploadButton
          acceptedFileTypes={acceptedFileTypes}
          multiple={multiple}
          label={label}
          iconOnly={iconOnly}
          className={className}
          disabled={disabled || isProcessing}
          performFileUpload={performDiskUpload}
          isUploading={isProcessing}
          uploadError={resolvedUploadError}
        />
      )}

      {/* Cloud file picker modal */}
      {selectedCloudProvider && (
        <CloudFilePickerModal
          isOpen={cloudPickerOpen}
          onClose={handleCloudPickerClose}
          provider={selectedCloudProvider}
          acceptedFileTypes={acceptedFileTypes}
          multiple={multiple}
          maxFiles={maxFiles}
          onFilesSelected={handleCloudFilesSelected}
          chatId={chatId ?? undefined}
        />
      )}
    </div>
  );
};
