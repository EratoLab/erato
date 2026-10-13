import { t } from "@lingui/core/macro";

import type { AddMenuSection } from "./ChatInputAddMenu";
import type { AssistantToolsMenuDescriptionDisplay } from "@/app/env";
import type { MentionableAssistant } from "@/hooks/chat/useMentionableAssistants";

export const ASSISTANT_MENTION_SECTION_ID = "assistant-mentions";
export const ASSISTANT_MENTION_BROWSE_ITEM_ID = "browse-assistants";

interface AssistantMentionSectionOptions {
  assistants: MentionableAssistant[];
  onSelect: (assistant: MentionableAssistant) => void;
  onBrowse: () => void;
  disabled?: boolean;
  descriptionDisplay?: AssistantToolsMenuDescriptionDisplay;
}

/**
 * The "Assistants" group in its host-neutral form. Both composer surfaces —
 * the mobile "+" menu and the desktop tool dropdown — render this same data,
 * so the offered assistants and their order never diverge between hosts.
 */
export function buildAssistantMentionSection({
  assistants,
  onSelect,
  onBrowse,
  disabled = false,
  descriptionDisplay = "truncated",
}: AssistantMentionSectionOptions): AddMenuSection {
  return {
    id: ASSISTANT_MENTION_SECTION_ID,
    header: t({
      id: "chatInput.mentions.sectionHeader",
      message: "Assistants",
    }),
    // eslint-disable-next-line lingui/no-unlocalized-strings -- AddMenuSection placement enum
    placement: "belowTools",
    items: [
      ...assistants.map((assistant) => ({
        id: assistant.id,
        label: assistant.name,
        description:
          descriptionDisplay === "none" ? undefined : assistant.description,
        truncateDescription: descriptionDisplay === "truncated",
        disabled,
        onSelect: () => onSelect(assistant),
      })),
      {
        id: ASSISTANT_MENTION_BROWSE_ITEM_ID,
        label: t({
          id: "chatInput.mentions.browse",
          message: "Browse assistants…",
        }),
        disabled,
        closesImmediately: true,
        onSelect: onBrowse,
      },
    ],
  };
}
