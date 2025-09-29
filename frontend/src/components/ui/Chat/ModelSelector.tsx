/**
 * ModelSelector component for choosing chat models in the input area
 *
 * Displays the currently selected model and allows users to switch between
 * available models using a dropdown interface.
 */
import { t } from "@lingui/core/macro";
import { useMemo, useState } from "react";

import { DropdownMenu } from "../Controls/DropdownMenu";

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

export const ModelSelector = ({
  availableModels,
  selectedModel,
  onModelChange,
  disabled = false,
  className = "",
}: ModelSelectorProps) => {
  // Track dropdown open state for chevron rotation
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Convert available models to dropdown menu items
  const dropdownItems: DropdownMenuItem[] = useMemo(() => {
    return availableModels.map((model) => ({
      label: model.model_display_name,
      onClick: () => onModelChange(model),
      checked: selectedModel?.chat_provider_id === model.chat_provider_id,
    }));
  }, [availableModels, selectedModel, onModelChange]);

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
        <span
          className="max-w-32 truncate sm:max-w-40"
          title={singleModel.model_display_name}
        >
          {singleModel.model_display_name}
        </span>
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
        triggerIcon={
          <div className="flex items-center gap-1 px-2">
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
