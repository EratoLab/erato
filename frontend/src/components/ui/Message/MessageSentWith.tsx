import { t } from "@lingui/core/macro";
import { useId } from "react";

import { ComposerContextGlyph } from "../Chat/ComposerContext/composerContextIcons";

import type { SentWithChip } from "@/utils/chat/sentWith";

export interface MessageSentWithProps {
  chips: readonly SentWithChip[];
}

/**
 * The context a sent message carried, as read-only chips under its text,
 * named as the composer chips named it. Nothing is focusable: there is
 * nothing to act on, and a message must not add a tab stop per chip.
 */
export const MessageSentWith = ({ chips }: MessageSentWithProps) => {
  const labelId = useId();
  if (chips.length === 0) {
    return null;
  }
  return (
    <div data-ui="message-sent-with" className="mt-1.5 flex flex-col gap-1">
      <span
        id={labelId}
        data-ui="message-sent-with-label"
        className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-theme-fg-muted"
      >
        {t({ id: "chat.message.sentWith.label", message: "Sent with" })}
      </span>
      <ul
        aria-labelledby={labelId}
        data-ui="message-sent-with-list"
        className="flex min-w-0 flex-wrap gap-1"
      >
        {chips.map((chip) => (
          <li
            key={chip.id}
            data-ui="message-sent-with-chip"
            data-kind={chip.kind}
            title={chip.meta ? `${chip.label} · ${chip.meta}` : chip.label}
            className="inline-flex h-[22px] min-w-0 max-w-full items-center gap-1 rounded-[var(--theme-radius-base)] border border-[var(--theme-border-attachment)] bg-theme-bg-secondary px-[7px] text-xs text-theme-fg-secondary"
          >
            <ComposerContextGlyph
              icon={chip.icon}
              state="included"
              tone="neutral"
              size="sm"
            />
            <span data-ui="message-sent-with-chip-label" className="truncate">
              {chip.label}
            </span>
            {chip.meta ? (
              <span className="sr-only">{`, ${chip.meta}`}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
};
