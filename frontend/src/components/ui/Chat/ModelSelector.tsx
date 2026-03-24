/**
 * ModelSelector component for choosing chat models in the input area
 *
 * Displays the currently selected model and allows users to switch between
 * available models using a dropdown interface.
 */
import { t } from "@lingui/core/macro";
import { useMemo, useState } from "react";

import { DropdownMenu } from "../Controls/DropdownMenu";
import { ResolvedIcon } from "../icons";

import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { ChatModel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface ModelSelectorProps {
  /** Array of available models to choose from */
  availableModels: ChatModel[];
  /** Currently selected model */
  selectedModel: ChatModel | null;
  /** Callback when user selects a different model */
  onModelChange: (model: ChatModel) => void;
  /** Whether the selector is disabled (e.g., during loading) */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

function resolveModelDescription(model: ChatModel): string | null {
  if (!model.model_description) {
    return null;
  }

  // eslint-disable-next-line lingui/no-unlocalized-strings -- Translation key is dynamic by chat provider ID
  const translationId = `chat_models.${model.chat_provider_id}.description`;
  // eslint-disable-next-line lingui/no-single-variables-to-translate
  const translatedDescription = t({ id: translationId, message: "" });
  if (translatedDescription && translatedDescription !== translationId) {
    return translatedDescription;
  }

  return model.model_description;
}

export function ModelSelectorOptionContent({
  model,
  compact = false,
  reserveIconSpace = false,
}: {
  model: ChatModel;
  compact?: boolean;
  reserveIconSpace?: boolean;
}) {
  const description = resolveModelDescription(model);
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
  disabled = false,
  className = "",
}: ModelSelectorProps) => {
  // Keep this marker so Lingui extracts the dynamic model description keys.
  const _modelDescriptionMarker = t`chat_models.<chat-provider-id>.description`;
  // Track dropdown open state for chevron rotation
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const shouldReserveIconSpace = useMemo(
    () => availableModels.some((model) => Boolean(model.model_icon)),
    [availableModels],
  );

  // Convert available models to dropdown menu items
  const dropdownItems: DropdownMenuItem[] = useMemo(() => {
    return availableModels.map((model) => ({
      label: (
        <ModelSelectorOptionContent
          model={model}
          reserveIconSpace={shouldReserveIconSpace}
        />
      ),
      onClick: () => onModelChange(model),
      checked: selectedModel?.chat_provider_id === model.chat_provider_id,
    }));
  }, [availableModels, onModelChange, selectedModel, shouldReserveIconSpace]);

  // Don't render if no models available
  if (availableModels.length === 0) {
    return null;
  }

  // If only one model available, show read-only display
  if (availableModels.length === 1) {
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

  // Show loading state if disabled but models exist
  const displayName = selectedModel?.model_display_name ?? t`Loading...`;

  return (
    <div className={`flex items-center ${className}`}>
      <DropdownMenu
        items={dropdownItems}
        align="right"
        onOpenChange={setIsDropdownOpen}
        matchContentWidth
        triggerIcon={
          <div className="flex items-center gap-1 px-2">
            {selectedModel?.model_icon ? (
              <ResolvedIcon
                iconId={selectedModel.model_icon}
                className="size-4 shrink-0 text-[var(--theme-fg-secondary)]"
              />
            ) : null}
            <span
              className="max-w-32 truncate text-sm font-medium text-[var(--theme-fg-primary)] sm:max-w-40"
              title={selectedModel?.model_display_name}
            >
              {displayName}
            </span>
            <svg
              className={`size-3 shrink-0 text-[var(--theme-fg-secondary)] transition-transform duration-200 ${
                isDropdownOpen ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        }
        className={`${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        id="model-selector-dropdown"
      />
    </div>
  );
};
