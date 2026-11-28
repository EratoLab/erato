import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import { componentRegistry } from "@/config/componentRegistry";
import { useChatFileSources } from "@/hooks/files/useChatFileSources";
import { compactChatLabel } from "@/lib/shell/menus/addMenuTexts";
import {
  ADD_MENU_ID,
  describeAddMenu,
  toolChoice,
} from "@/lib/shell/menus/describeAddMenu";
import { modelChoice } from "@/lib/shell/menus/describeModelMenu";
import { useSystemMenu } from "@/lib/shell/systemMenus/useSystemMenu";

import { CloudFilePickerModal } from "../FileUpload/CloudFilePickerModal";
import { ResolvedIcon } from "../icons";
import { ChatInputAddMenu } from "./ChatInputAddMenu";
import { getFacetDisplayName } from "./FacetSelector";
import { ModelSelectorOptionContent } from "./ModelSelector";
import { buildAssistantMentionSection } from "./assistantMentionSection";
import { buildMcpToolsSection } from "./mcpToolsSection";

import type { AddMenuSection, AddMenuToolItem } from "./ChatInputAddMenu";
import type { UseChatFileSourcesParams } from "@/hooks/files/useChatFileSources";
import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
  AddMenuFileSource,
  AddMenuState,
} from "@/lib/shell/menus/describeAddMenu";

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
 * desktop layout uses. The menu's state is one description, drawn by
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
    fileSourceItems,
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

  const toolsLocked = menu.toolsLocked !== undefined;
  const tools: AddMenuToolItem[] = facets.map((facet) => ({
    id: facet.id,
    label: getFacetDisplayName(facet),
    icon: <ResolvedIcon iconId={facet.icon} className="size-4" />,
    checked: selectedFacetIdSet.has(facet.id),
    onToggle: () => onToggleFacet(facet.id),
    disabled: disabled || toolsLocked,
    description: menu.toolsLocked?.reason,
  }));

  const extraSections = [
    menu.connectors &&
      buildMcpToolsSection({
        ...menu.connectors,
        onOpen: actions.openConnectors,
        disabled,
      }),
    menu.assistants &&
      buildAssistantMentionSection({
        ...menu.assistants,
        onOpen: actions.openAssistants,
        disabled,
      }),
    menu.compaction && compactionSection(menu.compaction, actions.compact),
    menu.model && modelSection(menu.model, actions.selectModel),
  ].filter((section): section is AddMenuSection => Boolean(section));

  // While the composer waits, its "+" does nothing, as the web one is off.
  const waiting = disabled || isProcessing;
  const nativeMenu = useSystemMenu({
    id: "chat-input-add",
    mode: "attach",
    entries: waiting
      ? null
      : describeAddMenu({
          ...menu,
          busy: false,
          fileSources: canUpload
            ? fileSourceItems.map((item) => item.id as AddMenuFileSource)
            : [],
          uploadLimitReached: uploadDisabled,
          facets,
          selectedFacetIds,
          hostContent: ExtraContent != null,
        }),
    onChoose: (itemId) => {
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
    },
    onToggle: (itemId, on) => {
      const facetId = toolChoice(itemId);
      if (facetId && selectedFacetIdSet.has(facetId) !== on) {
        onToggleFacet(facetId);
      }
    },
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
        fileSources={canUpload ? fileSourceItems : []}
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

function compactionSection(
  compaction: NonNullable<AddMenuState["compaction"]>,
  compact: () => void,
): AddMenuSection {
  return {
    id: "compaction",
    // eslint-disable-next-line lingui/no-unlocalized-strings -- AddMenuSection placement enum
    placement: "belowTools",
    items: [
      {
        id: ADD_MENU_ID.compact,
        label: compactChatLabel(),
        description: compaction.description,
        onSelect: compact,
        disabled: compaction.pending,
      },
    ],
  };
}

function modelSection(
  { models, selectedId, ready }: NonNullable<AddMenuState["model"]>,
  selectModel: (chatProviderId: string) => void,
): AddMenuSection {
  const selected = models.find(
    (model) => model.chat_provider_id === selectedId,
  );
  return {
    id: "model",
    header: t({ id: "chatInput.addMenu.modelHeader", message: "Model" }),
    // eslint-disable-next-line lingui/no-unlocalized-strings -- AddMenuSection placement enum
    placement: "belowTools",
    // A list of models outgrows the menu, so it opens as its own page; a
    // single model stays one row, there is nothing to choose between.
    submenu:
      models.length > 1 ? { summary: selected?.model_display_name } : undefined,
    items: models.map((model) => ({
      id: `model-${model.chat_provider_id}`,
      label: <ModelSelectorOptionContent model={model} compact />,
      checked: model.chat_provider_id === selectedId,
      exclusive: true,
      disabled: !ready,
      onToggle: () => selectModel(model.chat_provider_id),
    })),
  };
}
