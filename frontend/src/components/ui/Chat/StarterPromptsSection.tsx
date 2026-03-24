import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import clsx from "clsx";

import { useStarterPrompts } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useStarterPromptsFeature } from "@/providers/FeatureConfigProvider";

import { ResolvedIcon } from "../icons";
import { useChatInputControls } from "./ChatInputControlsContext";

import type { StarterPromptInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface StarterPromptsSectionProps {
  className?: string;
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

export function StarterPromptsSection({
  className = "",
}: StarterPromptsSectionProps) {
  // Keep these markers so Lingui extracts the dynamic starter prompt keys.
  const _starterPromptTitleMarker = t`starter_prompts.<starter-prompt-id>.title`;
  const _starterPromptSubtitleMarker = t`starter_prompts.<starter-prompt-id>.subtitle`;
  const { enabled } = useStarterPromptsFeature();
  const {
    setDraftMessage,
    setSelectedFacetIds,
    setSelectedChatProviderId,
    focusInput,
  } = useChatInputControls();
  const { data } = useStarterPrompts(enabled ? {} : skipToken);

  const starterPrompts = data?.starter_prompts ?? [];
  if (!enabled || starterPrompts.length === 0) {
    return null;
  }

  return (
    <div
      className={clsx(
        "grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-3",
        className,
      )}
      data-testid="starter-prompts-section"
    >
      {starterPrompts.map((starterPrompt) => (
        <button
          key={starterPrompt.id}
          type="button"
          onClick={() => {
            setDraftMessage(starterPrompt.prompt, { focus: false });
            setSelectedFacetIds(starterPrompt.selected_facets ?? []);
            if (starterPrompt.chat_provider) {
              setSelectedChatProviderId(starterPrompt.chat_provider);
            }
            focusInput();
          }}
          className={clsx(
            "group rounded-2xl border p-4 text-center",
            "[background:var(--theme-starter-prompt-bg)] [border-color:var(--theme-starter-prompt-border)]",
            "transition-colors hover:[background:var(--theme-starter-prompt-hover-bg)] hover:[border-color:var(--theme-starter-prompt-hover-border)]",
            "focus:outline-none focus:ring-2 focus:ring-[var(--theme-starter-prompt-focus-ring)] focus:ring-offset-2 focus:ring-offset-[var(--theme-starter-prompt-focus-offset)]",
          )}
          data-testid={`starter-prompt-${starterPrompt.id}`}
        >
          <div className="mb-3 flex flex-col items-center gap-3">
            <div className="rounded-full p-3 [background:var(--theme-starter-prompt-icon-bg)] [color:var(--theme-starter-prompt-icon-fg)]">
              <ResolvedIcon iconId={starterPrompt.icon} className="size-7" />
            </div>
            <div className="min-w-0">
              <div className="font-extrabold [color:var(--theme-starter-prompt-title-fg)]">
                {getStarterPromptTitle(starterPrompt)}
              </div>
              <div className="mt-1 text-sm [color:var(--theme-starter-prompt-subtitle-fg)]">
                {getStarterPromptSubtitle(starterPrompt)}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
