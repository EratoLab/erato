/**
 * useChatFileSources
 *
 * Shared disk + cloud file-source logic for the chat composer. Extracted from
 * FileUploadWithTokenCheck so the same upload machinery (dropzone, cloud
 * linking, token-limit checks) can feed both the desktop FileSourceSelector
 * and the unified mobile "+" menu (ChatInputAddMenu) without duplication.
 *
 * The hook owns *behavior and state*; callers render the bits that must live
 * in their own tree — the hidden dropzone input and the cloud picker modal —
 * using the props this hook returns.
 */
import { t } from "@lingui/core/macro";
import { Cloud, Computer } from "iconoir-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useDropzone } from "react-dropzone";

import { UploadTooLargeError } from "@/hooks/files/errors";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { useFileUploadWithTokenCheck } from "@/hooks/files/useFileUploadWithTokenCheck";
import {
  useCreateChat,
  useLinkFile,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  useCloudProvidersFeature,
  useUploadFeature,
} from "@/providers/FeatureConfigProvider";
import { FileTypeUtil } from "@/utils/fileTypes";

import type { AddMenuActionItem } from "@/components/ui/Chat/ChatInputAddMenu";
import type { CloudFilePickerModalProps } from "@/components/ui/FileUpload/CloudFilePickerModal";
import type {
  CloudProvider,
  SelectedCloudFile,
} from "@/lib/api/cloudProviders/types";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";
import type { DropzoneInputProps, DropzoneRootProps } from "react-dropzone";

const getPreviewUrl = (file: { preview_url?: unknown }): string | undefined =>
  typeof file.preview_url === "string" ? file.preview_url : undefined;

export interface UseChatFileSourcesParams {
  message: string;
  chatId?: string | null;
  assistantId?: string;
  previousMessageId?: string | null;
  chatProviderId?: string;
  onFilesUploaded?: (files: FileUploadItem[]) => void;
  onTokenLimitExceeded?: (isExceeded: boolean) => void;
  performFileUpload?: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  uploadError?: Error | null;
  acceptedFileTypes?: FileType[];
  multiple?: boolean;
  maxFiles?: number;
  disabled?: boolean;
  onProcessingChange?: (isProcessing: boolean) => void;
}

export interface UseChatFileSourcesResult {
  /** Whether any cloud provider is available (i.e. show a source picker). */
  hasCloudProviders: boolean;
  /** Cloud providers available for this workspace. */
  availableProviders: CloudProvider[];
  /** Combined upload + estimation + linking processing state. */
  isProcessing: boolean;
  /** The disk upload path, resolving the external override when supplied. */
  performDiskUpload: (files: File[]) => Promise<FileUploadItem[] | undefined>;
  /** Aggregated upload error (external, cloud-link, or disk). */
  resolvedUploadError: Error | null;
  /** Open the OS disk file picker. */
  onSelectDisk: () => void;
  /** Begin selecting from a cloud provider (opens the cloud modal). */
  onSelectCloud: (provider: CloudProvider) => void;
  /** Upload already-resolved File objects (used by hosts/drag-drop). */
  onSelectFiles: (files: File[]) => Promise<void>;
  /** Ready-made action items for the unified "+" menu. */
  fileSourceItems: AddMenuActionItem[];
  /** Spread onto the hidden dropzone wrapper. */
  dropzoneRootProps: (props?: DropzoneRootProps) => DropzoneRootProps;
  /** Spread onto the hidden dropzone <input>. */
  dropzoneInputProps: (props?: DropzoneInputProps) => DropzoneInputProps;
  /** Props for <CloudFilePickerModal>, or null when no provider is active. */
  cloudPickerProps: CloudFilePickerModalProps | null;
}

export function useChatFileSources({
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
  maxFiles = 5,
  disabled = false,
  onProcessingChange,
}: UseChatFileSourcesParams): UseChatFileSourcesResult {
  const { availableProviders } = useCloudProvidersFeature();
  const hasCloudProviders = availableProviders.length > 0;

  const { maxSizeBytes, maxSizeFormatted } = useUploadFeature();

  const [selectedCloudProvider, setSelectedCloudProvider] =
    useState<CloudProvider | null>(null);
  const [cloudLinkError, setCloudLinkError] = useState<Error | null>(null);
  // Linking runs as a React 19 Action: `isLinkingFiles` is the transition's
  // pending flag, so there is no manual setIsLinkingFiles bookkeeping. The
  // cloud picker's open state is derived from it (see cloudPickerProps below).
  const [isLinkingFiles, startLinkTransition] = useTransition();

  const { setSilentChatId, setError } = useFileUploadStore();
  const createChatMutation = useCreateChat();
  const linkFileMutation = useLinkFile();

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
    externalUploadError ??
    cloudLinkError ??
    (uploadError instanceof Error ? uploadError : null);

  const handleSelectedFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const uploadedFiles = await performDiskUpload(files);
      if (
        !externalPerformFileUpload &&
        uploadedFiles &&
        uploadedFiles.length > 0
      ) {
        onFilesUploaded?.(uploadedFiles);
      }
    },
    [externalPerformFileUpload, onFilesUploaded, performDiskUpload],
  );

  const {
    open: openDiskFilePicker,
    getRootProps,
    getInputProps,
  } = useDropzone({
    onDrop: (acceptedFiles, rejectedFiles) => {
      if (rejectedFiles.length > 0) {
        const hasSizeError = rejectedFiles.some((rejection) =>
          rejection.errors.some((e) => e.code === "file-too-large"),
        );

        if (hasSizeError) {
          setError(new UploadTooLargeError(maxSizeFormatted));
          return;
        }
      }

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
    maxSize: maxSizeBytes,
    noClick: true,
    noKeyboard: true,
  });

  const isProcessing = isUploading || isEstimating || isLinkingFiles;

  const handleSelectDisk = useCallback(() => {
    openDiskFilePicker();
  }, [openDiskFilePicker]);

  const handleSelectCloud = useCallback((provider: CloudProvider) => {
    setSelectedCloudProvider(provider);
  }, []);

  const handleCloudFilesSelected = useCallback(
    (files: SelectedCloudFile[]) => {
      // The empty-selection guard must run synchronously, before the transition
      // starts — otherwise an empty pick would needlessly flip the pending flag.
      if (files.length === 0 || !selectedCloudProvider) {
        setSelectedCloudProvider(null);
        return;
      }

      const provider = selectedCloudProvider;
      setCloudLinkError(null);

      startLinkTransition(async () => {
        const allLinkedFiles: FileUploadItem[] = [];
        try {
          let linkChatId = chatId;

          if (!linkChatId) {
            const createChatResult = await createChatMutation.mutateAsync({
              body: {
                ...(assistantId ? { assistant_id: assistantId } : {}),
                ...(chatProviderId ? { chat_provider_id: chatProviderId } : {}),
              },
            });
            linkChatId = createChatResult.chat_id;
            setSilentChatId(linkChatId);
          }

          try {
            for (const file of files) {
              const response = await linkFileMutation.mutateAsync({
                body: {
                  source: provider,
                  chat_id: linkChatId,
                  provider_metadata: {
                    drive_id: file.drive_id,
                    item_id: file.item_id,
                  },
                },
              });

              allLinkedFiles.push(
                ...response.files.map((f) => {
                  const previewUrl = getPreviewUrl(f);

                  return {
                    id: f.id,
                    filename: f.filename,
                    download_url: f.download_url,
                    file_contents_unavailable_missing_permissions:
                      f.file_contents_unavailable_missing_permissions,
                    audio_transcription: f.audio_transcription,
                    is_sharepoint_file: provider === "sharepoint",
                    ...(previewUrl ? { preview_url: previewUrl } : {}),
                    file_capability: f.file_capability,
                  };
                }),
              );
            }
          } finally {
            // Flush files linked before any mid-loop failure so partial
            // successes still attach (and feed token estimation) rather than
            // being discarded along with the failed file.
            if (allLinkedFiles.length > 0) {
              onFilesUploaded?.(allLinkedFiles);
            }
          }
        } catch (error) {
          console.error("Error linking cloud files:", error);
          setCloudLinkError(
            error instanceof Error
              ? error
              : new Error("Failed to link selected cloud files."),
          );
        } finally {
          setSelectedCloudProvider(null);
        }
      });
    },
    [
      selectedCloudProvider,
      onFilesUploaded,
      chatId,
      assistantId,
      chatProviderId,
      createChatMutation,
      linkFileMutation,
      setSilentChatId,
    ],
  );

  const handleCloudPickerClose = useCallback(() => {
    setSelectedCloudProvider(null);
  }, []);

  useEffect(() => {
    onProcessingChange?.(isProcessing);
  }, [isProcessing, onProcessingChange]);

  useEffect(() => {
    onTokenLimitExceeded?.(exceedsTokenLimit);
  }, [exceedsTokenLimit, onTokenLimitExceeded]);

  const hasSharepoint = availableProviders.includes("sharepoint");
  const fileSourceItems: AddMenuActionItem[] = useMemo(
    () => [
      {
        id: "computer",
        label: t({
          id: "fileSourceSelector.uploadFromComputer",
          message: "Upload from Computer",
        }),
        icon: <Computer className="size-4" />,
        onSelect: handleSelectDisk,
        disabled,
      },
      ...(hasSharepoint
        ? [
            {
              id: "sharepoint",
              label: t({
                id: "fileSourceSelector.uploadFromOneDrive",
                message: "Upload from Sharepoint",
              }),
              icon: <Cloud className="size-4" />,
              onSelect: () => handleSelectCloud("sharepoint"),
              disabled,
            } satisfies AddMenuActionItem,
          ]
        : []),
    ],
    [hasSharepoint, disabled, handleSelectDisk, handleSelectCloud],
  );

  const cloudPickerProps: CloudFilePickerModalProps | null =
    selectedCloudProvider != null
      ? {
          // Close the modal the moment linking begins; setSelectedCloudProvider
          // stays non-null through the Action so these props don't collapse to
          // null mid-flight while the picker animates out.
          isOpen: !isLinkingFiles,
          onClose: handleCloudPickerClose,
          provider: selectedCloudProvider,
          acceptedFileTypes,
          multiple,
          maxFiles,
          onFilesSelected: handleCloudFilesSelected,
          chatId: chatId ?? undefined,
        }
      : null;

  return {
    hasCloudProviders,
    availableProviders,
    isProcessing,
    performDiskUpload,
    resolvedUploadError,
    onSelectDisk: handleSelectDisk,
    onSelectCloud: handleSelectCloud,
    onSelectFiles: handleSelectedFiles,
    fileSourceItems,
    dropzoneRootProps: getRootProps,
    dropzoneInputProps: getInputProps,
    cloudPickerProps,
  };
}
