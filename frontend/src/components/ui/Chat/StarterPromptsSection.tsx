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
            "group rounded-2xl border border-theme-border bg-theme-bg-primary p-4 text-center",
            "transition-colors hover:border-theme-border-focus hover:bg-theme-bg-hover",
            "focus:outline-none focus:ring-2 focus:ring-[var(--theme-border-focus)] focus:ring-offset-2 focus:ring-offset-[var(--theme-bg-primary)]",
          )}
          data-testid={`starter-prompt-${starterPrompt.id}`}
        >
          <div className="mb-3 flex flex-col items-center gap-3">
            <div className="rounded-full bg-theme-bg-accent p-3 text-theme-fg-primary">
              <ResolvedIcon iconId={starterPrompt.icon} className="size-7" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-theme-fg-primary">
                {starterPrompt.title}
              </div>
              <div className="mt-1 text-sm text-theme-fg-secondary">
                {starterPrompt.subtitle}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
