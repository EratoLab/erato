import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import { componentRegistry } from "@/config/componentRegistry";
import { useChatFileSources } from "@/hooks/files/useChatFileSources";

import { CloudFilePickerModal } from "../FileUpload/CloudFilePickerModal";
import { ResolvedIcon } from "../icons";
import { ChatInputAddMenu } from "./ChatInputAddMenu";
import { getFacetDisplayName } from "./FacetSelector";

import type { AddMenuToolItem } from "./ChatInputAddMenu";
import type { UseChatFileSourcesParams } from "@/hooks/files/useChatFileSources";
import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ChatInputAddControlsProps {
  /** Whether file upload is available (feature flag + handler present). */
  canUpload: boolean;

  /**
   * Upload wiring forwarded verbatim to useChatFileSources. `disabled` is
   * omitted because this container owns the combined gate (general disabled +
   * upload limit + canUpload) below.
   */
  upload: Omit<UseChatFileSourcesParams, "disabled">;

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
  upload,
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
    onSelectFiles,
    dropzoneRootProps,
    dropzoneInputProps,
    cloudPickerProps,
  } = useChatFileSources({
    ...upload,
    // When upload is off, keep the hook inert (no estimation/dropzone work).
    disabled: disabled || uploadDisabled || !canUpload,
  });

  // A host (e.g. the Outlook add-in) can inject its own rows — email content,
  // attachments — into the shared menu instead of overriding the whole selector.
  const ExtraContent = componentRegistry.ChatAddMenuExtraContent;

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
        extraContent={
          ExtraContent
            ? ({ close }) => (
                <ExtraContent
                  onSelectFiles={onSelectFiles}
                  onClose={close}
                  disabled={disabled}
                  isProcessing={isProcessing}
                />
              )
            : undefined
        }
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
