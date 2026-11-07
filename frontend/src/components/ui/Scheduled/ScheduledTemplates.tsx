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
}

/**
 * Templates as starter-prompt pills, through the same override slot as the
 * chat's starter prompts. The icon tags each one with its type.
 */
export function ScheduledTemplates({
  templates,
  onSelect,
}: ScheduledTemplatesProps) {
  const headingId = useId();
  const Renderer = resolveComponentOverride(
    componentRegistry.StarterPrompts,
    DefaultStarterPromptsSection,
  );

  if (templates.length === 0) return null;

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
      <Renderer
        className="max-w-3xl"
        starterPrompts={templates.map((template) => ({
          id: template.id,
          title: template.title,
          resolvedTitle: template.title,
          subtitle: template.description,
          resolvedSubtitle: template.description,
          prompt: "",
          icon: TYPE_ICON[template.type],
        }))}
        onStarterPromptSelect={(prompt) => {
          const template = templates.find((entry) => entry.id === prompt.id);
          if (template) onSelect(template);
        }}
      />
      <p className="text-xs text-theme-fg-muted">
        {t({
          id: "scheduled.templates.note",
          message: "A template opens the form with the text filled in.",
        })}
      </p>
    </section>
  );
}
