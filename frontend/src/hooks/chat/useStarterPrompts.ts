import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useChatInputControls } from "@/components/ui/Chat/ChatInputControlsContext";
import { useStarterPrompts } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useStarterPromptsFeature } from "@/providers/FeatureConfigProvider";

import type { StarterPromptInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ResolvedStarterPromptInfo extends StarterPromptInfo {
  resolvedTitle: string;
  resolvedSubtitle: string;
}

function resolveStarterPromptTranslation(
  translationId: string,
  fallback: string,
): string {
  // eslint-disable-next-line lingui/no-single-variables-to-translate
  const translatedValue = t({ id: translationId, message: "" });
  if (translatedValue && translatedValue !== translationId) {
    return translatedValue;
  }

  return fallback;
}

function getStarterPromptTitle(starterPrompt: StarterPromptInfo): string {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Translation key is dynamic by starter prompt ID
  const translationId = `starter_prompts.${starterPrompt.id}.title`;
  return resolveStarterPromptTranslation(translationId, starterPrompt.title);
}

function getStarterPromptSubtitle(starterPrompt: StarterPromptInfo): string {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Translation key is dynamic by starter prompt ID
  const translationId = `starter_prompts.${starterPrompt.id}.subtitle`;
  return resolveStarterPromptTranslation(translationId, starterPrompt.subtitle);
}

export function useStarterPromptsData() {
  // Keep these markers so Lingui extracts the dynamic starter prompt keys.
  const _starterPromptTitleMarker = t`starter_prompts.<starter-prompt-id>.title`;
  const _starterPromptSubtitleMarker = t`starter_prompts.<starter-prompt-id>.subtitle`;
  void _starterPromptTitleMarker;
  void _starterPromptSubtitleMarker;

  const { enabled } = useStarterPromptsFeature();
  const {
    setDraftMessage,
    setSelectedFacetIds,
    setSelectedChatProviderId,
    focusInput,
  } = useChatInputControls();
  const { data } = useStarterPrompts(enabled ? {} : skipToken);

  const starterPrompts = useMemo<ResolvedStarterPromptInfo[]>(
    () =>
      (data?.starter_prompts ?? []).map((starterPrompt) => ({
        ...starterPrompt,
        resolvedTitle: getStarterPromptTitle(starterPrompt),
        resolvedSubtitle: getStarterPromptSubtitle(starterPrompt),
      })),
    [data?.starter_prompts],
  );

  const handleStarterPromptSelect = useCallback(
    (starterPrompt: ResolvedStarterPromptInfo) => {
      setDraftMessage(starterPrompt.prompt, { focus: false });
      setSelectedFacetIds(starterPrompt.selected_facets ?? []);
      if (starterPrompt.chat_provider) {
        setSelectedChatProviderId(starterPrompt.chat_provider);
      }
      focusInput();
    },
    [
      focusInput,
      setDraftMessage,
      setSelectedChatProviderId,
      setSelectedFacetIds,
    ],
  );

  return {
    enabled,
    starterPrompts,
    handleStarterPromptSelect,
  };
}
