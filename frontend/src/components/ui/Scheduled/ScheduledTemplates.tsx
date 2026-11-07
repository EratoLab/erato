import { t } from "@lingui/core/macro";
import { useId } from "react";

import {
  componentRegistry,
  resolveComponentOverride,
} from "@/config/componentRegistry";

import { DefaultStarterPromptsSection } from "../Chat/StarterPromptsSection";

import type { ScheduledItemType, ScheduledTemplate } from "./scheduledItems";

// Iconoir names, so a theme's StarterPrompts override resolves them too.
/* eslint-disable lingui/no-unlocalized-strings -- icon ids */
const TYPE_ICON: Record<ScheduledItemType, string> = {
  reminder: "Bell",
  scheduled_task: "Play",
};
/* eslint-enable lingui/no-unlocalized-strings */

interface ScheduledTemplatesProps {
  templates: ScheduledTemplate[];
  onSelect: (template: ScheduledTemplate) => void;
  /** Disables every template and takes the place of their descriptions. */
  disabledReason?: string | null;
}

/**
 * Templates as starter-prompt pills, through the same override slot as the
 * chat's starter prompts. The icon tags each one with its type.
 */
export function ScheduledTemplates({
  templates,
  onSelect,
  disabledReason,
}: ScheduledTemplatesProps) {
  const headingId = useId();
  const Renderer = resolveComponentOverride(
    componentRegistry.StarterPrompts,
    DefaultStarterPromptsSection,
  );

  if (templates.length === 0) return null;

  const pills = (
    <Renderer
      className="max-w-3xl"
      starterPrompts={templates.map((template) => ({
        id: template.id,
        title: template.title,
        resolvedTitle: template.title,
        subtitle: disabledReason ?? template.description,
        resolvedSubtitle: disabledReason ?? template.description,
        prompt: "",
        icon: TYPE_ICON[template.type],
      }))}
      onStarterPromptSelect={(prompt) => {
        if (disabledReason) return;
        const template = templates.find((entry) => entry.id === prompt.id);
        if (template) onSelect(template);
      }}
    />
  );

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col items-center gap-3"
      data-ui="scheduled-templates"
    >
      <h2
        id={headingId}
        className="text-xs font-semibold uppercase tracking-wide text-theme-fg-muted"
      >
        {t({
          id: "scheduled.templates.title",
          message: "Start from a template",
        })}
      </h2>
      {disabledReason ? (
        // A disabled fieldset disables the pills of any override renderer
        // without a prop of its own.
        <fieldset
          disabled
          className="flex w-full min-w-0 justify-center opacity-50 [&_button]:cursor-not-allowed"
        >
          {pills}
        </fieldset>
      ) : (
        pills
      )}
      <p className="text-xs text-theme-fg-muted">
        {disabledReason ??
          t({
            id: "scheduled.templates.note",
            message: "A template opens the form with the text filled in.",
          })}
      </p>
    </section>
  );
}
