/* eslint-disable lingui/no-unlocalized-strings -- fixture data standing in for what a server sends */
import type { ModelMenuState } from "../describeModelMenu";
import type { ChatModel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export const MODELS: ChatModel[] = [
  {
    chat_provider_id: "gpt-5-4-mini-eu",
    model_display_name: "GPT-5.4 Mini (EU)",
    model_icon: "openai",
    model_description: "Fast answers, hosted in the EU",
  },
  {
    chat_provider_id: "claude-sonnet",
    model_display_name: "Claude Sonnet 5.5",
    model_icon: "anthropic",
  },
  {
    chat_provider_id: "mistral-large",
    model_display_name: "Mistral Large",
  },
];

export const MODEL_MENU_FIXTURES: Record<string, ModelMenuState> = {
  many: { models: MODELS, selectedId: "claude-sonnet", ready: true },
  noneSelected: { models: MODELS, selectedId: null, ready: true },
  notReady: { models: MODELS, selectedId: "gpt-5-4-mini-eu", ready: false },
};
