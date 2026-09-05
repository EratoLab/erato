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
import { usePageAlignment } from "@/hooks/ui/usePageAlignment";

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
  const { justifyAlignment } = usePageAlignment("headers");

  return (
    <div
      className={clsx(
        "flex w-full flex-wrap gap-2",
        justifyAlignment,
        className,
      )}
      data-testid="starter-prompts-section"
    >
      {starterPrompts.map((starterPrompt) => (
        <button
          key={starterPrompt.id}
          type="button"
          onClick={() => onStarterPromptSelect(starterPrompt)}
          title={starterPrompt.resolvedSubtitle}
          className={clsx(
            "inline-flex min-h-9 items-center gap-2 rounded-[var(--theme-radius-control)] border px-3 py-2 text-sm font-medium",
            "[background:var(--theme-starter-prompt-bg)] [border-color:var(--theme-starter-prompt-border)]",
            "transition-colors hover:[background:var(--theme-starter-prompt-hover-bg)] hover:[border-color:var(--theme-starter-prompt-hover-border)]",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-starter-prompt-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-starter-prompt-focus-offset)]",
          )}
          data-testid={`starter-prompt-${starterPrompt.id}`}
        >
          <ResolvedIcon
            iconId={starterPrompt.icon}
            className="size-4 shrink-0 [color:var(--theme-starter-prompt-icon-fg)]"
          />
          <span className="[color:var(--theme-starter-prompt-title-fg)]">
            {starterPrompt.resolvedTitle}
          </span>
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
