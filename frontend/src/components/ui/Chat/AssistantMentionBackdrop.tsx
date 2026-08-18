import clsx from "clsx";
import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";

import { findMentionRanges } from "@/utils/chat/assistantMentions";

import type { AssistantMention } from "@/utils/chat/assistantMentions";
import type { RefObject } from "react";

export interface AssistantMentionBackdropProps {
  text: string;
  tracked: AssistantMention[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** The textarea fades its own glyphs when locked; the mirror is a sibling. */
  dimmed?: boolean;
}

interface MentionSegment {
  start: number;
  text: string;
  id: string | null;
}

/**
 * Paints a fill behind every tracked `@Name` in the composer, so that the rule
 * "only a picked mention delegates" is visible: a hand-typed token reads the
 * same as a picked one otherwise.
 *
 * It mirrors the textarea's text with `color: transparent` and only backs the
 * mention spans, rather than the more common inversion where the mirror shows
 * the text and the textarea hides it. A mirror that drifts then offsets a patch
 * of colour instead of what the user is typing.
 *
 * Alignment therefore depends on the mirror matching the textarea's box: same
 * padding class, inherited font metrics, the same wrapping, and the same
 * scroll offset.
 */
export function AssistantMentionBackdrop({
  text,
  tracked,
  textareaRef,
  dimmed = false,
}: AssistantMentionBackdropProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  const segments = useMemo(() => {
    const parts: MentionSegment[] = [];
    let cursor = 0;
    for (const range of findMentionRanges(text, tracked)) {
      if (range.start > cursor) {
        parts.push({
          start: cursor,
          text: text.slice(cursor, range.start),
          id: null,
        });
      }
      parts.push({
        start: range.start,
        text: text.slice(range.start, range.end),
        id: range.id,
      });
      cursor = range.end;
    }
    if (cursor < text.length) {
      parts.push({ start: cursor, text: text.slice(cursor), id: null });
    }
    return parts;
  }, [text, tracked]);

  const syncViewport = useCallback(() => {
    const textarea = textareaRef.current;
    const backdrop = backdropRef.current;
    if (!textarea || !backdrop) {
      return;
    }
    backdrop.scrollTop = textarea.scrollTop;
    // A scrollbar narrows the textarea's content box once the draft outgrows
    // the field; the mirror wraps a character late unless it loses the same
    // width.
    backdrop.style.width = `${textarea.clientWidth}px`;
  }, [textareaRef]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    syncViewport();
    textarea.addEventListener("scroll", syncViewport);
    const observer = new ResizeObserver(syncViewport);
    observer.observe(textarea);
    return () => {
      textarea.removeEventListener("scroll", syncViewport);
      observer.disconnect();
    };
  }, [syncViewport, textareaRef]);

  useEffect(syncViewport, [syncViewport, text]);

  return (
    <div
      ref={backdropRef}
      aria-hidden="true"
      className={clsx(
        "pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden",
        "chat-input-textarea-geometry",
        "max-h-[200px] whitespace-pre-wrap break-words",
        "text-base text-transparent",
        dimmed && "opacity-50",
      )}
      data-testid="chat-input-mention-backdrop"
    >
      {segments.map((segment) =>
        segment.id === null ? (
          <Fragment key={segment.start}>{segment.text}</Fragment>
        ) : (
          <span
            key={segment.start}
            // On the composer's own surface the fill alone is a ~4% luminance
            // step, so the outline is what makes the pill a shape. Inset rather
            // than a border: a border box widens the span and walks the mirrored
            // glyphs out of line with the textarea's.
            className="rounded-[var(--theme-radius-control)] bg-theme-info-bg box-decoration-clone shadow-[inset_0_0_0_1px_var(--theme-info-border)]"
            data-mention-id={segment.id}
            data-testid="chat-input-mention-highlight"
          >
            {segment.text}
          </span>
        ),
      )}
      {/* The textarea keeps a line box for a trailing newline; the mirror only
          gets one from an explicit break. */}
      <br />
    </div>
  );
}
