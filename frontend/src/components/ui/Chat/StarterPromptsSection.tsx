import { t } from "@lingui/core/macro";
import clsx from "clsx";

import {
  componentRegistry,
  resolveComponentOverride,
} from "@/config/componentRegistry";
import {
  useStarterPromptsData,
  type ResolvedStarterPromptInfo,
} from "@/hooks/chat/useStarterPrompts";

import { ResolvedIcon } from "../icons";

export interface StarterPromptsSectionProps {
  className?: string;
}

export interface StarterPromptsRendererProps {
  className?: string;
  starterPrompts: ResolvedStarterPromptInfo[];
  onStarterPromptSelect: (starterPrompt: ResolvedStarterPromptInfo) => void;
}

export function DefaultStarterPromptsSection({
  className = "",
  starterPrompts,
  onStarterPromptSelect,
}: StarterPromptsRendererProps) {
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
          onClick={() => onStarterPromptSelect(starterPrompt)}
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
                {starterPrompt.resolvedTitle}
              </div>
              <div className="mt-1 text-sm [color:var(--theme-starter-prompt-subtitle-fg)]">
                {starterPrompt.resolvedSubtitle}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export function StarterPromptsSection({
  className = "",
}: StarterPromptsSectionProps) {
  // Keep at least one static Lingui reference in this module so extraction continues
  // if only the renderer is imported elsewhere.
  void t`starter_prompts.<starter-prompt-id>.title`;
  void t`starter_prompts.<starter-prompt-id>.subtitle`;

  const { enabled, starterPrompts, handleStarterPromptSelect } =
    useStarterPromptsData();

  if (!enabled || starterPrompts.length === 0) {
    return null;
  }

  const StarterPromptsRenderer = resolveComponentOverride(
    componentRegistry.StarterPrompts,
    DefaultStarterPromptsSection,
  );

  return (
    <StarterPromptsRenderer
      className={className}
      starterPrompts={starterPrompts}
      onStarterPromptSelect={handleStarterPromptSelect}
    />
  );
}
