import type { ChatModel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ChatTopLeftAccessoryProps {
  availableModels: ChatModel[];
  selectedModel: ChatModel | null;
  onModelChange: (model: ChatModel) => void;
  isModelSelectionReady: boolean;
}
