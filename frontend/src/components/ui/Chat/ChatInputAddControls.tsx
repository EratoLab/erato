import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import { componentRegistry } from "@/config/componentRegistry";
import { useChatFileSources } from "@/hooks/files/useChatFileSources";
import {
  ADD_MENU_ID,
  addMenuEntries,
  describeAddMenu,
  toolChoice,
} from "@/lib/shell/menus/describeAddMenu";
import { modelChoice } from "@/lib/shell/menus/describeModelMenu";
import { addMenuItems } from "@/lib/shell/menus/web/addMenuItems";
import { useSystemMenu } from "@/lib/shell/systemMenus/useSystemMenu";

import { ChatInputAddMenu } from "./ChatInputAddMenu";
import { ModelSelectorOptionContent } from "./ModelSelector";
import { CloudFilePickerModal } from "../FileUpload/CloudFilePickerModal";

import type { UseChatFileSourcesParams } from "@/hooks/files/useChatFileSources";
import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { AddMenuState } from "@/lib/shell/menus/describeAddMenu";
import type { MenuEntry } from "@/lib/shell/menus/menuEntry";

/** The rows besides uploads and tools, as data; absent ones are not offered. */
export type ChatInputAddMenuData = Pick<
  AddMenuState,
  | "onlySingleFacet"
  | "toolsLocked"
  | "connectors"
  | "assistants"
  | "compaction"
  | "model"
>;

export interface ChatInputAddMenuActions {
  openConnectors: () => void;
  openAssistants: () => void;
  compact: () => void;
  selectModel: (chatProviderId: string) => void;
}

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

  menu: ChatInputAddMenuData;
  actions: ChatInputAddMenuActions;
  /** Shown on the trigger where the selected tools have no chips. */
  selectedToolCount?: number;

  /** Disable the whole control (general composer-disabled state). */
  disabled?: boolean;
  /** Extra gate for file-source rows (e.g. attachment limit reached). */
  uploadDisabled?: boolean;
}

/**
 * Mobile composer control: a single "+" menu that merges file sources and
 * tool toggles, replacing the separate upload button + Tools dropdown that the
 * desktop layout uses. The menu is one description, drawn by
 * ChatInputAddMenu on the web and by the host app where it offers system
 * menus; this container wires upload behavior and what each row does.
 */
export function ChatInputAddControls({
  canUpload,
  upload,
  facets,
  selectedFacetIds,
  onToggleFacet,
  menu,
  actions,
  selectedToolCount,
  disabled = false,
  uploadDisabled = false,
}: ChatInputAddControlsProps) {
  const {
    isProcessing,
    fileSources,
    onSelectDisk,
    onSelectCloud,
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

  const state: AddMenuState = {
    ...menu,
    fileSources: canUpload ? fileSources : [],
    uploadLimitReached: uploadDisabled,
    facets,
    selectedFacetIds,
    hostContent: ExtraContent != null,
  };
  const choose = (itemId: string) => {
    switch (itemId) {
      case ADD_MENU_ID.uploadComputer:
        return onSelectDisk();
      case ADD_MENU_ID.uploadSharepoint:
        return onSelectCloud("sharepoint");
      case ADD_MENU_ID.connectors:
        return actions.openConnectors();
      case ADD_MENU_ID.assistants:
        return actions.openAssistants();
      case ADD_MENU_ID.compact:
        return actions.compact();
    }
    const chatProviderId = modelChoice(itemId);
    if (chatProviderId) actions.selectModel(chatProviderId);
  };
  const toggle = (itemId: string, on: boolean) => {
    const facetId = toolChoice(itemId);
    if (facetId && selectedFacetIdSet.has(facetId) !== on) {
      onToggleFacet(facetId);
    }
  };
  // A model row shows the model's icon and name as the composer's picker does.
  const label = (entry: MenuEntry) => {
    const chatProviderId = modelChoice(entry.id);
    const model = menu.model?.models.find(
      (candidate) => candidate.chat_provider_id === chatProviderId,
    );
    return model ? (
      <ModelSelectorOptionContent model={model} compact />
    ) : (
      entry.label
    );
  };
  const {
    fileSources: sourceRows,
    tools,
    extraSections,
  } = addMenuItems(addMenuEntries(state), { choose, toggle, label });

  // While the composer waits, its "+" does nothing, as the web one is off.
  const waiting = disabled || isProcessing;
  const nativeMenu = useSystemMenu({
    id: "chat-input-add",
    mode: "attach",
    entries: waiting ? null : describeAddMenu(state),
    onChoose: choose,
    onToggle: toggle,
  });

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
        fileSources={sourceRows}
        tools={tools}
        extraSections={extraSections.length > 0 ? extraSections : undefined}
        extraContent={
          ExtraContent
            ? ({ close }) => (
                <ExtraContent
                  onSelectFiles={onSelectFiles}
                  onClose={close}
                  disabled={disabled}
                  uploadDisabled={uploadDisabled}
                  isProcessing={isProcessing}
                />
              )
            : undefined
        }
        isProcessing={isProcessing}
        selectedToolCount={selectedToolCount}
        disabled={disabled}
        nativeMenu={nativeMenu}
      />

      {canUpload && cloudPickerProps && (
        <CloudFilePickerModal {...cloudPickerProps} />
      )}
    </>
  );
}
