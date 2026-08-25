/**
 * Custom hook for active model selection
 *
 * Provides interactive model selection functionality for input components.
 * Handles user selection state and provides ready state for UI interaction.
 */
import { useState, useMemo, useEffect, useCallback, useRef } from "react";

import { useProfile } from "@/hooks/useProfile";
import { useAvailableModels } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createLogger } from "@/utils/debugLogger";

import type { ChatModel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("HOOK", "useActiveModelSelection");

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
  const { profile, isLoading: isProfileLoading } = useProfile();

  // Local selection state
  const [selectedModel, setSelectedModel] = useState<ChatModel | null>(null);

  // undefined = never initialized, null = initialized with no initialModel.
  const appliedInitialRef = useRef<string | null | undefined>(undefined);

  // Prefer the user's configured model, falling back to the highest-priority
  // available model when no preference is set or it is no longer available.
  const defaultModel = useMemo(() => {
    const configuredModelId = profile?.preference_default_chat_provider;
    const configuredModel = availableModels.find(
      (model) => model.chat_provider_id === configuredModelId,
    );
    if (configuredModel) {
      return configuredModel;
    }
    return availableModels[0] ?? null;
  }, [availableModels, profile?.preference_default_chat_provider]);

  // Initialize selection based on initial model or default
  useEffect(() => {
    if (availableModels.length === 0 || isProfileLoading) return;

    const initialId = initialModel?.chat_provider_id ?? null;

    if (appliedInitialRef.current === initialId) return;

    if (initialModel) {
      const modelExists = availableModels.find(
        (model) => model.chat_provider_id === initialModel.chat_provider_id,
      );
      if (modelExists) {
        logger.log("Initializing with initial model:", {
          modelId: initialModel.chat_provider_id,
          modelName: initialModel.model_display_name,
        });
        setSelectedModel(initialModel);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      } else if (defaultModel) {
        logger.log("Initial model no longer available, using default:", {
          unavailableModelId: initialModel.chat_provider_id,
          defaultModelId: defaultModel.chat_provider_id,
        });
        setSelectedModel(defaultModel);
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (defaultModel && appliedInitialRef.current === undefined) {
      logger.log("Initializing with default model:", {
        modelId: defaultModel.chat_provider_id,
        modelName: defaultModel.model_display_name,
      });
      setSelectedModel(defaultModel);
    }

    appliedInitialRef.current = initialId;
  }, [initialModel, availableModels, defaultModel, isProfileLoading]);

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
      logger.log("Model changed:", {
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
