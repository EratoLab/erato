import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";

import type React from "react";

export interface AudioTranscriptExcerptProps {
  transcript: string;
  /** Names the recording when a message carries more than one. */
  label?: string;
}

/**
 * The transcript of a sent recording, clamped to three lines. Recordings run
 * up to twenty minutes, so the full text only opens on request.
 */
export const AudioTranscriptExcerpt: React.FC<AudioTranscriptExcerptProps> = ({
  transcript,
  label,
}) => {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const text = textRef.current;
    // Once expanded the element is as tall as its content, so the last
    // collapsed measurement stands.
    if (!text || expanded) {
      return;
    }

    const measure = () => {
      setOverflows(text.scrollHeight > text.clientHeight + 1);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [expanded, transcript]);

  return (
    <figure
      className="m-0 flex max-w-prose flex-col items-start gap-1 text-sm"
      data-ui="message-audio-transcript"
      data-testid="message-audio-transcript"
    >
      <figcaption className="text-xs font-medium text-theme-fg-muted">
        {label ?? t`Transcript`}
      </figcaption>
      <p
        ref={textRef}
        className={clsx(
          "whitespace-pre-wrap break-words text-theme-fg-secondary",
          !expanded && "line-clamp-3",
        )}
      >
        {transcript}
      </p>
      {(overflows || expanded) && (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t`Show less` : t`Show more`}
        </Button>
      )}
    </figure>
  );
};

// eslint-disable-next-line lingui/no-unlocalized-strings
AudioTranscriptExcerpt.displayName = "AudioTranscriptExcerpt";
