import clsx from "clsx";
import { memo } from "react";

import { SpinnerIcon } from "../Feedback/SpinnerIcon";
import { ErrorIcon, InfoIcon } from "../icons";

export type AttachmentNoticeTone = "neutral" | "error";

export interface AttachmentNoticeProps {
  /** What happened, or what is being waited for. */
  label: string;
  /** Secondary line under the label. */
  description?: string;
  tone?: AttachmentNoticeTone;
  /**
   * Waiting rather than reporting: a spinner takes the glyph's place and the
   * row reports itself busy.
   */
  busy?: boolean;
  /**
   * Drops the frame down to a centred spinner. Only the busy form has a bare
   * reading — a notice with something to say needs the frame to stand in a row
   * of chips.
   */
  bare?: boolean;
  className?: string;
}

/**
 * The chip-shaped row that stands in for an attachment that is not one: a
 * status line about the group around it, or a placeholder for one still
 * loading. It takes the chip corner rather than a radius of its own, so a card
 * that reshapes its attachments reshapes this too.
 */
export const AttachmentNotice = memo<AttachmentNoticeProps>(
  ({
    label,
    description,
    tone = "neutral",
    busy = false,
    bare = false,
    className,
  }) => {
    if (bare) {
      // Keeps `attachment-loading` rather than taking the notice hook: that
      // name is published as a theme hook and a shipped kit emits it, and this
      // is the one form of this component that is not chip-shaped. The ring
      // carries the wait itself here — there is no frame to make a live region
      // out of, so nothing would announce it otherwise.
      return (
        <div
          className={clsx("flex w-full justify-center py-2", className)}
          data-ui="attachment-loading"
          aria-busy="true"
        >
          <SpinnerIcon size="md" srText={label} />
          {description ? <span className="sr-only">{description}</span> : null}
        </div>
      );
    }

    const isError = tone === "error";
    const Icon = isError ? ErrorIcon : InfoIcon;

    return (
      <div
        data-ui="attachment-notice"
        data-tone={tone}
        className={clsx(
          "attachment-notice-geometry attachment-notice-skin flex items-center gap-2 border p-2",
          className,
        )}
        role={isError ? "alert" : "status"}
        aria-live={isError ? undefined : "polite"}
        aria-busy={busy || undefined}
      >
        <span className="attachment-notice-icon-skin mr-2 shrink-0">
          {busy ? (
            // The frame is already the live region; a ring keeping its own
            // `role="status"` inside it would announce the same wait twice.
            <SpinnerIcon size="md" aria-hidden />
          ) : (
            <Icon className="size-5" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="attachment-notice-label-skin flex min-w-0 max-w-full items-baseline text-sm font-medium"
            title={label}
          >
            {label}
          </span>
          {description && (
            <span className="block text-xs text-[var(--theme-fg-muted)]">
              {description}
            </span>
          )}
        </span>
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
AttachmentNotice.displayName = "AttachmentNotice";
