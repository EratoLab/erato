import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import { useChatFileSources } from "@/hooks/files/useChatFileSources";

import { CloudFilePickerModal } from "../FileUpload/CloudFilePickerModal";
import { ResolvedIcon } from "../icons";
import { ChatInputAddMenu } from "./ChatInputAddMenu";
import { getFacetDisplayName } from "./FacetSelector";

import type { AddMenuToolItem } from "./ChatInputAddMenu";
import type {
  FacetInfo,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { FileType } from "@/utils/fileTypes";

export interface ChatInputAddControlsProps {
  /** Whether file upload is available (feature flag + handler present). */
  canUpload: boolean;

  // --- Upload wiring (mirrors FileUploadWithTokenCheck) ---
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
  onProcessingChange?: (isProcessing: boolean) => void;

  // --- Tools / facets ---
  facets: FacetInfo[];
  selectedFacetIds: string[];
  onToggleFacet: (facetId: string) => void;

  /** Disable the whole control (general composer-disabled state). */
  disabled?: boolean;
  /** Extra gate for file-source rows (e.g. attachment limit reached). */
  uploadDisabled?: boolean;
  /** Extra gate for tool rows (e.g. facet selection is enforced/locked). */
  toolsDisabled?: boolean;
}

/**
 * Mobile composer control: a single "+" menu that merges file sources and
 * tool toggles, replacing the separate upload button + Tools dropdown that the
 * desktop layout uses. Presentation lives in ChatInputAddMenu; this container
 * wires upload behavior (via useChatFileSources) and maps facets to tool rows.
 */
export function ChatInputAddControls({
  canUpload,
  message,
  chatId,
  assistantId,
  previousMessageId,
  chatProviderId,
  onFilesUploaded,
  onTokenLimitExceeded,
  performFileUpload,
  uploadError = null,
  acceptedFileTypes = [],
  multiple = false,
  maxFiles = 5,
  onProcessingChange,
  facets,
  selectedFacetIds,
  onToggleFacet,
  disabled = false,
  uploadDisabled = false,
  toolsDisabled = false,
}: ChatInputAddControlsProps) {
  const {
    isProcessing,
    fileSourceItems,
    dropzoneRootProps,
    dropzoneInputProps,
    cloudPickerProps,
  } = useChatFileSources({
    message,
    chatId,
    assistantId,
    previousMessageId,
    chatProviderId,
    onFilesUploaded,
    onTokenLimitExceeded,
    performFileUpload,
    uploadError,
    acceptedFileTypes,
    multiple,
    maxFiles,
    // When upload is off, keep the hook inert (no estimation/dropzone work).
    disabled: disabled || uploadDisabled || !canUpload,
    onProcessingChange,
  });

  const selectedFacetIdSet = useMemo(
    () => new Set(selectedFacetIds),
    [selectedFacetIds],
  );

  const tools: AddMenuToolItem[] = useMemo(
    () =>
      facets.map((facet) => ({
        id: facet.id,
        label: getFacetDisplayName(facet),
        icon: <ResolvedIcon iconId={facet.icon} className="size-4" />,
        checked: selectedFacetIdSet.has(facet.id),
        onToggle: () => onToggleFacet(facet.id),
        disabled: disabled || toolsDisabled,
      })),
    [facets, selectedFacetIdSet, onToggleFacet, disabled, toolsDisabled],
  );

  return (
    <>
      {canUpload && (
        <div {...dropzoneRootProps({ className: "contents" })}>
          <input
            {...dropzoneInputProps()}
            aria-label={t({
              id: "fileUpload.disk.ariaLabel",
              message: "Upload files from disk",
            })}
          />
        </div>
      )}

      <ChatInputAddMenu
        fileSources={canUpload ? fileSourceItems : []}
        tools={tools}
        selectedCount={selectedFacetIds.length}
        isProcessing={isProcessing}
        disabled={disabled}
      />

      {canUpload && cloudPickerProps && (
        <CloudFilePickerModal {...cloudPickerProps} />
      )}
    </>
  );
}
