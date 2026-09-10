import clsx from "clsx";
import { memo } from "react";

import { SpinnerIcon } from "../Feedback/SpinnerIcon";
import { ErrorIcon, InfoIcon } from "../icons";

export type AttachmentNoticeTone = "neutral" | "error";

export interface AttachmentNoticeProps {
  label: string;
  description?: string;
  tone?: AttachmentNoticeTone;
  /** Waiting rather than reporting: a spinner replaces the glyph. */
  busy?: boolean;
  /** Drops the frame to a centred spinner. Only meaningful while `busy`. */
  bare?: boolean;
  className?: string;
}

/**
 * Stands in for an attachment that is not one: a status line, or a placeholder
 * for one still loading. Takes the chip corner, so a card that reshapes its
 * attachments reshapes this too.
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
      // Keeps the published `attachment-loading` hook, which a shipped kit
      // emits. With no frame to be the live region, the ring carries the wait.
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
            // The frame is the live region; a ring with its own role would
            // announce the same wait twice.
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
