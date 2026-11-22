import { t } from "@lingui/core/macro";
import { useId, useRef, useState } from "react";

import { useVoiceTracesShown } from "@/hooks/audio/voiceTraces";

import { PlayIcon, StopIcon } from "../icons";

interface SpokenReplyProps {
  /** What the voice said, one entry per spoken part of the reply. */
  texts: string[];
  /** The recording of the reply, where the deployment keeps it. */
  audioUrl?: string;
  hasAudio: boolean;
  isStreaming: boolean;
}

const clock = (seconds: number) => {
  const whole = Math.max(1, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * A small play button with the recording's length, read from its header. A
 * recording that cannot be played says so next to the button.
 */
function ReplayButton({
  src,
  describedBy,
}: {
  src?: string;
  describedBy?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (playing) {
      element.pause();
      element.currentTime = 0;
      return;
    }
    setFailed(false);
    void element.play().catch(() => {
      setPlaying(false);
      setFailed(true);
    });
  };

  const length = seconds === null ? null : clock(seconds);
  const label = playing
    ? t({ id: "chat.audio_replay.stop", message: "Stop the replay" })
    : length
      ? t({
          id: "chat.audio_replay.length",
          message: `Replay audio response, ${length}`,
        })
      : t({ id: "chat.audio_replay", message: "Replay audio response" });
  const problem = !src
    ? t({
        id: "chat.audio_replay.unavailable",
        message: "The recording is not available.",
      })
    : failed
      ? t({
          id: "chat.audio_replay.failed",
          message:
            "The recording could not be played. Reload the chat to try again.",
        })
      : null;

  return (
    <span className="inline-flex items-center gap-2">
      {/* The spoken text is the recording's caption. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audio}
        preload="metadata"
        src={src}
        onLoadedMetadata={(event) => {
          const { duration } = event.currentTarget;
          if (Number.isFinite(duration) && duration > 0) setSeconds(duration);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setFailed(true);
        }}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        className="inline-flex items-center gap-1 rounded-full border border-theme-border px-2 py-0.5 text-xs text-theme-fg-secondary hover:bg-theme-bg-hover disabled:opacity-50"
        aria-label={label}
        aria-describedby={describedBy}
        data-testid="spoken-reply-replay"
      >
        {playing ? (
          <StopIcon className="size-3.5" />
        ) : (
          <PlayIcon className="size-3.5" />
        )}
        {length && <span aria-hidden>{length}</span>}
      </button>
      {problem && (
        <span role="status" className="text-xs text-theme-fg-muted">
          {problem}
        </span>
      )}
    </span>
  );
}

/**
 * What the voice said for a reply in conversation mode, kept apart from the
 * written answer below it: a muted line while it is spoken, then folded, with
 * a replay button inside the fold where the recording was kept. Shown only
 * where the user's setting asks for it; the chat otherwise holds the written
 * answer alone.
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
  const shown = useVoiceTracesShown(Boolean(said) || hasAudio);
  const label = t({ id: "chat.spoken_reply.label", message: "Spoken" });

  if (!shown) return null;

  if (isStreaming) {
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

  if (!said) {
    return (
      <div className="mb-3" data-testid="spoken-reply">
        <ReplayButton src={audioUrl} />
      </div>
    );
  }

  return (
    <details
      className="group mb-3 text-sm text-theme-fg-muted"
      data-testid="spoken-reply"
    >
      <summary className="cursor-pointer truncate">
        <span className="font-medium">{label}</span>
        {/* Open, the text below is the whole of it. */}
        <span className="group-open:hidden">: {said}</span>
      </summary>
      <div className="mt-1 flex flex-col items-start gap-2">
        <p id={captionId} className="whitespace-pre-wrap">
          {said}
        </p>
        {hasAudio && <ReplayButton src={audioUrl} describedBy={captionId} />}
      </div>
    </details>
  );
}
