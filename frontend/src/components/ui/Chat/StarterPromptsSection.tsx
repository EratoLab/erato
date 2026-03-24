import { skipToken } from "@tanstack/react-query";
import clsx from "clsx";

import { useStarterPrompts } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useStarterPromptsFeature } from "@/providers/FeatureConfigProvider";

import { ResolvedIcon } from "../icons";
import { useChatInputControls } from "./ChatInputControlsContext";

export interface StarterPromptsSectionProps {
  className?: string;
}

export function StarterPromptsSection({
  className = "",
}: StarterPromptsSectionProps) {
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
                {starterPrompt.title}
              </div>
              <div className="mt-1 text-sm [color:var(--theme-starter-prompt-subtitle-fg)]">
                {starterPrompt.subtitle}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
