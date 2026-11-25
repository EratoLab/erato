import { plural, t } from "@lingui/core/macro";

import type { AddMenuSection } from "./ChatInputAddMenu";
import type { MentionableAssistant } from "@/hooks/chat/useMentionableAssistants";

export const ASSISTANT_MENTION_SECTION_ID = "assistant-mentions";
export const ASSISTANT_MENTION_OPEN_ITEM_ID = "ask-assistant";

interface AssistantMentionSectionOptions {
  /** The assistants the user turns to most, most used first. */
  suggested: MentionableAssistant[];
  /**
   * Whether `suggested` comes from the user's usage. Without usage it is
   * just the list's start, and the row must not claim the user uses them.
   */
  suggestedFromUsage?: boolean;
  /** Opens the assistant dialog. */
  onOpen: () => void;
  disabled?: boolean;
}

/**
 * The assistants in their host-neutral form: one row that opens the assistant
 * dialog, where the ones the user turns to most come first and the rest are a
 * search away. Picking one there mentions it, as typing "@" does. Both
 * composer surfaces — the mobile "+" menu and the desktop tool dropdown —
 * render this same data.
 *
 * The row carries no group header: its own label names the group, and the
 * menus separate header-less groups with a divider.
 */
export function buildAssistantMentionSection({
  suggested,
  suggestedFromUsage = true,
  onOpen,
  disabled = false,
}: AssistantMentionSectionOptions): AddMenuSection {
  const firstName = suggested.length > 0 ? suggested[0].name : "";
  const moreCount = suggested.length - 1;
  const description =
    suggested.length === 0
      ? undefined
      : moreCount === 0
        ? firstName
        : suggestedFromUsage
          ? t({
              id: "chatInput.mentions.open.description",
              message: plural(moreCount, {
                one: `${firstName} and # more you use often`,
                other: `${firstName} and # more you use often`,
              }),
            })
          : t({
              id: "chatInput.mentions.open.descriptionUnranked",
              message: plural(moreCount, {
                one: `${firstName} and # more`,
                other: `${firstName} and # more`,
              }),
            });

  return {
    id: ASSISTANT_MENTION_SECTION_ID,
    // eslint-disable-next-line lingui/no-unlocalized-strings -- AddMenuSection placement enum
    placement: "belowTools",
    items: [
      {
        id: ASSISTANT_MENTION_OPEN_ITEM_ID,
        label: t({
          id: "chatInput.mentions.open",
          message: "Ask an assistant…",
        }),
        description,
        truncateDescription: true,
        disabled,
        closesImmediately: true,
        onSelect: onOpen,
      },
    ],
  };
}
