/**
 * Custom hook for active model selection
 *
 * Provides interactive model selection functionality for input components.
 * Handles user selection state and provides ready state for UI interaction.
 */
import { useState, useMemo, useEffect, useCallback } from "react";

import { useAvailableModels } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { ChatModel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface UseActiveModelSelectionParams {
  initialModel?: ChatModel | null;
}

export function useActiveModelSelection({
  initialModel,
}: UseActiveModelSelectionParams = {}) {
  // Fetch available models
  const {
    data: availableModels = [],
    isLoading: isModelsLoading,
    error: modelsError,
  } = useAvailableModels({});

  // Local selection state
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null);

  // Get the default model (highest priority = first in array)
  const defaultModel = useMemo(() => {
    return availableModels[0] ?? null;
  }, [availableModels]);

  // Initialize selection based on initial model or default
  useEffect(() => {
    if (initialModel && availableModels.length > 0) {
      // Validate initial model still exists in available models
      const modelExists = availableModels.find(
        (model) => model.chat_provider_id === initialModel.chat_provider_id,
      );
      if (modelExists) {
        console.log(
          "[ACTIVE_MODEL_SELECTION] Initializing with chat last model:",
          {
            modelId: initialModel.chat_provider_id,
            modelName: initialModel.model_display_name,
          },
        );
        setSelectedModel(initialModel);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      } else if (defaultModel) {
        console.log(
          "[ACTIVE_MODEL_SELECTION] Initial model no longer available, using default:",
          {
            unavailableModelId: initialModel.chat_provider_id,
            defaultModelId: defaultModel.chat_provider_id,
          },
        );
        setSelectedModel(defaultModel);
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (defaultModel) {
      console.log("[ACTIVE_MODEL_SELECTION] Initializing with default model:", {
        modelId: defaultModel.chat_provider_id,
        modelName: defaultModel.model_display_name,
      });
      setSelectedModel(defaultModel);
    }
  }, [initialModel, availableModels, defaultModel]);

  // Determine if model selection is ready for user interaction
  const isSelectionReady = useMemo(() => {
    return (
      availableModels.length > 0 && // Models are loaded
      !isModelsLoading && // Not currently loading models
      selectedModel !== null // A model is selected
    );
  }, [availableModels.length, isModelsLoading, selectedModel]);

  // Handle model selection changes
  const handleModelChange = useCallback(
    (model: ChatModel) => {
      console.log("[ACTIVE_MODEL_SELECTION] Model changed:", {
        from: selectedModel?.chat_provider_id ?? "none",
        to: model.chat_provider_id,
        modelName: model.model_display_name,
      });
      setSelectedModel(model);
    },
    [selectedModel],
  );

  return {
    // Model data
    availableModels,
    selectedModel,
    defaultModel,

    // Actions
    setSelectedModel: handleModelChange,

    // States
    isModelsLoading,
    modelsError,
    isSelectionReady,
  };
}
