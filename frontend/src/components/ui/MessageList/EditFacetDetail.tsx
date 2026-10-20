import type { SentWithChip } from "@/utils/chat/sentWith";

export interface EditFacetDetailProps {
  chip: SentWithChip;
  /** Why the context cannot be left out of the edit. */
  note: string;
}

/**
 * The detail of the context an edited message is sent with again: what it
 * carried, then why it stays. A long passage scrolls on its own, so the note
 * stays in reach.
 */
export const EditFacetDetail = ({ chip, note }: EditFacetDetailProps) => (
  <div data-ui="message-editor-facet-detail" className="flex flex-col gap-3">
    {chip.meta ? (
      <p className="text-sm text-theme-fg-secondary">{chip.meta}</p>
    ) : null}
    {chip.quote ? (
      <blockquote
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region must take focus to scroll by keyboard
        tabIndex={0}
        aria-label={chip.spokenLabel ?? chip.label}
        data-ui="message-editor-facet-quote"
        className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-r-[var(--theme-radius-control)] border-l-2 border-theme-border bg-theme-bg-secondary py-2 pl-3 pr-2 text-sm text-theme-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
      >
        {chip.quote}
      </blockquote>
    ) : null}
    <p
      data-ui="message-editor-facet-note"
      className="text-xs text-theme-fg-muted"
    >
      {note}
    </p>
  </div>
);
