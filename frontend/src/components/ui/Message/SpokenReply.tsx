import { t } from "@lingui/core/macro";
import { useId } from "react";

interface SpokenReplyProps {
  /** What the voice said, one entry per spoken part of the reply. */
  texts: string[];
  /** The recording of the reply, once speech has finished. */
  audioUrl?: string;
  hasAudio: boolean;
  isStreaming: boolean;
}

/**
 * What the voice said for a reply in conversation mode, kept apart from the
 * written answer below it: a muted line while it is spoken, then a replay
 * button with the spoken text folded as its caption.
 */
export function SpokenReply({
  texts,
  audioUrl,
  hasAudio,
  isStreaming,
}: SpokenReplyProps) {
  const captionId = useId();
  const said = texts
    .map((text) => text.trim())
    .filter(Boolean)
    .join(" ");
  const label = t({ id: "chat.spoken_reply.label", message: "Spoken" });

  if (isStreaming || !hasAudio) {
    if (!said) return null;
    return (
      <p
        className="mb-3 text-sm text-theme-fg-muted"
        data-testid="spoken-reply-live"
      >
        <span className="font-medium">{label}: </span>
        {said}
      </p>
    );
  }

  return (
    <div
      className="mb-3 flex flex-col gap-1 text-sm text-theme-fg-muted"
      data-testid="spoken-reply"
    >
      {/* The spoken text below is the recording's caption. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        controls
        preload="none"
        src={audioUrl}
        aria-label={t({
          id: "chat.audio_replay",
          message: "Replay audio response",
        })}
        aria-describedby={said ? captionId : undefined}
      />
      {said && (
        <details>
          <summary className="cursor-pointer truncate">
            <span className="font-medium">{label}: </span>
            {said}
          </summary>
          <p id={captionId} className="mt-1 whitespace-pre-wrap">
            {said}
          </p>
        </details>
      )}
    </div>
  );
}
