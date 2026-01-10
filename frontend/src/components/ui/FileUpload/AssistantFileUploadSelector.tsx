/**
 * AssistantFileUploadSelector Component
 *
 * File upload selector for assistant file attachments
 * Supports both local disk uploads and cloud file linking (OneDrive/SharePoint)
 * Files are uploaded as standalone (without chat association) for use with assistants
 */
import { t } from "@lingui/core/macro";
import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";

import { useStandaloneFileUpload } from "@/hooks/files/useStandaloneFileUpload";
import { fetchLinkFile } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useCloudProvidersFeature } from "@/providers/FeatureConfigProvider";
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

interface AssistantFileUploadSelectorProps {
  /** Callback when files are successfully uploaded or linked */
  onFilesUploaded?: (files: FileUploadItem[]) => void;
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
  /** Whether files are currently being uploaded (from parent) */
  isUploading?: boolean;
  /** Upload error (from parent) */
  uploadError?: Error | null;
}

/**
 * File upload selector for assistants with support for disk and cloud sources
 * Creates standalone file uploads (not associated with a chat)
 */
export const AssistantFileUploadSelector: React.FC<
  AssistantFileUploadSelectorProps
> = ({
  onFilesUploaded,
  acceptedFileTypes = [],
  multiple = false,
  label = t({ id: "fileUpload.uploadFiles", message: "Upload Files" }),
  iconOnly = false,
  maxFiles = 5,
  className = "",
  disabled = false,
  isUploading: externalIsUploading = false,
  uploadError: externalUploadError = null,
}) => {
  // Get cloud providers configuration
  const { availableProviders } = useCloudProvidersFeature();
  const hasCloudProviders = availableProviders.length > 0;

  // Cloud picker state
  const [cloudPickerOpen, setCloudPickerOpen] = useState(false);
  const [selectedCloudProvider, setSelectedCloudProvider] =
    useState<CloudProvider | null>(null);
  const [isLinkingFiles, setIsLinkingFiles] = useState(false);

  // Use standalone file upload hook
  const {
    uploadFiles,
    isUploading: isUploadingFiles,
    error: uploadHookError,
  } = useStandaloneFileUpload();

  // Setup react-dropzone for disk file selection when cloud providers are available
  const {
    open: openDiskFilePicker,
    getRootProps,
    getInputProps,
  } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        void (async () => {
          const uploadedFiles = await uploadFiles(acceptedFiles);
          if (uploadedFiles && onFilesUploaded) {
            onFilesUploaded(uploadedFiles);
          }
        })();
      }
    },
    accept:
      acceptedFileTypes.length > 0
        ? FileTypeUtil.getAcceptObject(acceptedFileTypes)
        : undefined,
    multiple,
    disabled: disabled || externalIsUploading || isLinkingFiles,
    noClick: true, // We'll manually open via the selector
    noKeyboard: true,
  });

  const isProcessing =
    externalIsUploading || isLinkingFiles || isUploadingFiles;

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

          // Link files as standalone (no chat_id) using the generated API client
          const allLinkedFiles: FileUploadItem[] = [];

          for (const file of files) {
            // Link file without chat_id for standalone upload
            const response = await fetchLinkFile({
              body: {
                source: selectedCloudProvider,
                chat_id: null, // Standalone upload for assistants
                provider_metadata: {
                  drive_id: file.drive_id,
                  item_id: file.item_id,
                },
              } as unknown as LinkFileRequest,
            });

            // Transform response to FileUploadItem format
            allLinkedFiles.push(
              ...response.files.map((f) => ({
                id: f.id,
                filename: f.filename,
                download_url: f.download_url,
              })),
            );
          }

          // Call the onFilesUploaded callback with linked files
          if (allLinkedFiles.length > 0 && onFilesUploaded) {
            onFilesUploaded(allLinkedFiles);
          }

          setSelectedCloudProvider(null);
        } catch (error) {
          console.error("Error linking cloud files for assistant:", error);
          // TODO: Show error toast/notification to user
        } finally {
          setIsLinkingFiles(false);
        }
      })();
    },
    [selectedCloudProvider, onFilesUploaded],
  );

  // Handle cloud picker close
  const handleCloudPickerClose = useCallback(() => {
    setCloudPickerOpen(false);
    setSelectedCloudProvider(null);
  }, []);

  return (
    <div className="relative">
      {/* File upload button - show selector if cloud providers available */}
      {hasCloudProviders ? (
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

          <FileSourceSelector
            availableProviders={availableProviders}
            onSelectDisk={handleSelectDisk}
            onSelectCloud={handleSelectCloud}
            disabled={disabled || isProcessing}
            isProcessing={isProcessing}
            className={className}
          />
        </>
      ) : (
        <FileUploadButton
          acceptedFileTypes={acceptedFileTypes}
          multiple={multiple}
          label={label}
          iconOnly={iconOnly}
          className={className}
          disabled={disabled || isProcessing}
          performFileUpload={uploadFiles}
          isUploading={isProcessing}
          uploadError={externalUploadError ?? uploadHookError}
          onFilesUploaded={onFilesUploaded}
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
          chatId={undefined} // No chat context for assistant files
        />
      )}
    </div>
  );
};
