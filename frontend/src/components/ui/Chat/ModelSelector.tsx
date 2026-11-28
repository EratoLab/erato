/**
 * ModelSelector component for choosing chat models in the input area
 *
 * Displays the currently selected model and allows users to switch between
 * available models using a dropdown interface.
 */
import { t } from "@lingui/core/macro";
import { useId, useMemo, useState } from "react";

import {
  describeModelMenu,
  modelChoice,
  modelDescription,
} from "@/lib/shell/menus/describeModelMenu";
import { useSystemMenu } from "@/lib/shell/systemMenus/useSystemMenu";

import { DropdownMenu } from "../Controls/DropdownMenu";
import { ChevronDownIcon, ResolvedIcon } from "../icons";

import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { ChatModel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface ModelSelectorProps {
  /** Array of available models to choose from */
  availableModels: ChatModel[];
  /** Currently selected model */
  selectedModel: ChatModel | null;
  /** Callback when user selects a different model */
  onModelChange: (model: ChatModel) => void;
  /** Whether clearing the selection is allowed */
  allowNoSelection?: boolean;
  /** Callback when user clears the selection */
  onClearSelection?: () => void;
  /** Whether the selector is disabled (e.g., during loading) */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /**
   * Which edge the dropdown menu aligns to. Defaults to "right" (the selector
   * normally sits at the right edge of the input toolbar). Set to "left" when
   * the selector is rendered on the left (e.g. the collapsed mobile/add-in
   * layout) so the menu opens flush-left instead of clipping.
   */
  align?: "left" | "right";
}

const modelOfEntry = (models: readonly ChatModel[], itemId: string) =>
  models.find((model) => model.chat_provider_id === modelChoice(itemId));

export function ModelSelectorOptionContent({
  model,
  compact = false,
  reserveIconSpace = false,
}: {
  model: ChatModel;
  compact?: boolean;
  reserveIconSpace?: boolean;
}) {
  const description = modelDescription(model);
  const shouldShowIconSlot = reserveIconSpace || Boolean(model.model_icon);

  return (
    <div className="flex min-w-0 max-w-[22rem] items-center gap-2">
      {shouldShowIconSlot ? (
        <div className="flex size-4 shrink-0 items-center justify-center">
          {model.model_icon ? (
            <ResolvedIcon
              iconId={model.model_icon}
              className="size-4 shrink-0 text-[var(--theme-fg-secondary)]"
            />
          ) : null}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm font-medium text-[var(--theme-fg-primary)]"
          title={model.model_display_name}
        >
          {model.model_display_name}
        </div>
        {!compact && description ? (
          <div
            className="truncate text-xs font-normal text-[var(--theme-fg-muted)]"
            title={description}
          >
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const ModelSelector = ({
  availableModels,
  selectedModel,
  onModelChange,
  allowNoSelection = false,
  onClearSelection,
  disabled = false,
  className = "",
  align = "right",
}: ModelSelectorProps) => {
  // Keep this marker so Lingui extracts the dynamic model description keys.
  const _modelDescriptionMarker = t`chat_models.<chat-provider-id>.description`;
  const noneLabel = t({
    id: "assistant.form.model.none",
    message: "No default model",
  });
  // Track dropdown open state for chevron rotation
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const shouldReserveIconSpace = useMemo(
    () => availableModels.some((model) => Boolean(model.model_icon)),
    [availableModels],
  );

  // One description of the models, for the dropdown and the app's menu.
  const entries = useMemo(
    () =>
      describeModelMenu(
        {
          models: availableModels,
          selectedId: selectedModel?.chat_provider_id ?? null,
          ready: !disabled,
        },
        { descriptions: true },
      ),
    [availableModels, selectedModel, disabled],
  );
  const dropdownItems: DropdownMenuItem[] = useMemo(() => {
    const items: DropdownMenuItem[] = entries.flatMap((entry) => {
      const model = modelOfEntry(availableModels, entry.id);
      if (!model) return [];
      return [
        {
          label: (
            <ModelSelectorOptionContent
              model={model}
              reserveIconSpace={shouldReserveIconSpace}
            />
          ),
          onClick: () => onModelChange(model),
          checked: entry.state === "on",
        },
      ];
    });

    if (allowNoSelection) {
      items.unshift({
        label: (
          <span className="text-sm font-medium text-[var(--theme-fg-primary)]">
            {noneLabel}
          </span>
        ),
        onClick: () => onClearSelection?.(),
        checked: selectedModel == null,
      });
    }

    return items;
  }, [
    allowNoSelection,
    availableModels,
    entries,
    noneLabel,
    onClearSelection,
    onModelChange,
    selectedModel,
    shouldReserveIconSpace,
  ]);

  const menuId = useId();
  const nativeMenu = useSystemMenu({
    id: `model:${menuId}`,
    mode: "attach",
    // "No default model" is a row the description does not have.
    entries: allowNoSelection || availableModels.length < 2 ? null : entries,
    onChoose: (itemId) => {
      const chosen = modelOfEntry(availableModels, itemId);
      if (chosen) onModelChange(chosen);
    },
  });

  // Don't render if no models available
  if (availableModels.length === 0) {
    return null;
  }

  // If only one model available, show read-only display
  if (availableModels.length === 1 && !allowNoSelection) {
    const singleModel = availableModels[0];
    return (
      <div
        className={`flex items-center px-2 py-1 text-sm text-[var(--theme-fg-secondary)] ${className}`}
      >
        <div className="max-w-40 sm:max-w-48">
          <ModelSelectorOptionContent model={singleModel} compact />
        </div>
      </div>
    );
  }

  const displayName =
    selectedModel?.model_display_name ??
    (allowNoSelection ? noneLabel : t`Loading...`);

  return (
    <div className={`flex items-center ${className}`}>
      <DropdownMenu
        items={dropdownItems}
        nativeMenu={nativeMenu}
        align={align}
        onOpenChange={setIsDropdownOpen}
        dataUi="model-selector-menu"
        matchContentWidth
        triggerButtonVariant="secondary"
        triggerButtonClassName="min-w-[10rem] justify-between gap-2"
        triggerIcon={
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {selectedModel?.model_icon ? (
              <ResolvedIcon
                iconId={selectedModel.model_icon}
                className="size-4 shrink-0 text-[var(--theme-fg-secondary)]"
              />
            ) : null}
            <span
              className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[var(--theme-fg-primary)]"
              title={selectedModel?.model_display_name ?? noneLabel}
            >
              {displayName}
            </span>
            <ChevronDownIcon
              className={`size-3 shrink-0 text-[var(--theme-fg-secondary)] transition-transform duration-200 ${
                isDropdownOpen ? "rotate-180" : ""
              }`}
            />
          </div>
        }
        className={`${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        id="model-selector-dropdown"
      />
    </div>
  );
};
