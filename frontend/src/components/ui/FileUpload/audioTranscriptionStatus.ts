import { t } from "@lingui/core/macro";

/** What a staged recording carries in `audio_transcription`, loosely typed as the API sends it. */
export interface AudioTranscriptionChunkState {
  status?: string;
  transcript?: string | null;
  end_ms?: number | null;
}

export interface AudioTranscriptionState {
  status?: string;
  transcript?: string | null;
  error?: string | null;
  chunks?: readonly AudioTranscriptionChunkState[] | null;
  /**
   * Set by the composer once the recording stopped: its length as recorded.
   * The chunks reach it only as the server takes them up, one at a time.
   */
  recorded_duration_ms?: number | null;
  /** Set by the composer while the recording runs: its length so far, by the recorder's clock. */
  recording_elapsed_ms?: number | null;
}

export type AudioTranscriptionPhase =
  | "recording"
  | "uploading"
  | "transcribing"
  | "completed"
  | "failed"
  | "canceled";

export interface AudioTranscriptionTileAction {
  label: string;
  /** Names the file too, so two failed recordings' buttons differ. */
  name: string;
  disabled: boolean;
}

export interface AudioTranscriptionTileStatus {
  phase: AudioTranscriptionPhase;
  busy: boolean;
  /** The tile's remove control while it is busy, offered only when the recording can be canceled. */
  cancel?: { label: string; name: string };
  tone?: "error";
  /** The tile's meta line, e.g. "Transcribing · 0:42". */
  metaLabel: string;
  /** The error, for the tile's title. */
  title?: string;
  /** "Retry transcription", offered only for a recording the recorder still holds. */
  action?: AudioTranscriptionTileAction;
  /**
   * Set for the composer's own recordings, whose generated file name says
   * nothing: the tile shows their latest words instead and keeps the name for
   * its tooltip and accessible name. Without an excerpt yet, the meta line
   * stands alone.
   */
  transcript?: {
    excerpt?: string;
    /** Opens the preview with the player and the whole transcript. */
    more?: { label: string; name: string };
  };
}

export function getCompletedChunkTranscript(
  chunks?: readonly AudioTranscriptionChunkState[] | null,
): string | undefined {
  if (!chunks || chunks.length === 0) {
    return undefined;
  }

  const completedChunkText = chunks
    .filter((chunk) => chunk.status?.toLowerCase() === "completed")
    .map((chunk) => chunk.transcript?.trim())
    .filter((transcript): transcript is string => Boolean(transcript))
    .join(" ");

  return completedChunkText.length > 0 ? completedChunkText : undefined;
}

export function isAudioTranscriptionComplete(
  status?: string,
  chunks?: readonly AudioTranscriptionChunkState[] | null,
): boolean {
  const normalizedStatus = status?.toLowerCase();

  if (normalizedStatus) {
    return normalizedStatus === "completed";
  }

  if (!chunks || chunks.length === 0) {
    return false;
  }

  return chunks.every((chunk) => chunk.status?.toLowerCase() === "completed");
}

export function getDisplayTranscript(
  transcript?: string | null,
  chunks?: readonly AudioTranscriptionChunkState[] | null,
): string | undefined {
  if (transcript?.trim()) {
    return transcript;
  }

  return getCompletedChunkTranscript(chunks);
}

function formatDuration(ms: number): string | null {
  if (ms <= 0) {
    return null;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const EXCERPT_MAX_CHARS = 200;

/**
 * The transcript's latest words, cut at a word boundary. The tile shows the
 * last two lines of it, so the newest text stays in view as chunks arrive.
 */
export function audioTranscriptExcerpt(transcript: string): string {
  const text = transcript.replace(/\s+/g, " ").trim();
  if (text.length <= EXCERPT_MAX_CHARS) {
    return text;
  }
  const tail = text.slice(-EXCERPT_MAX_CHARS);
  const wordStart = tail.indexOf(" ") + 1;
  return `…${wordStart > 0 ? tail.slice(wordStart) : tail}`;
}

/** The recording's length so far, from its chunks' largest end, as "m:ss". */
export function audioTranscriptionDuration(
  chunks?: readonly AudioTranscriptionChunkState[] | null,
): string | null {
  let endMs = 0;
  for (const chunk of chunks ?? []) {
    if (typeof chunk.end_ms === "number" && chunk.end_ms > endMs) {
      endMs = chunk.end_ms;
    }
  }
  return formatDuration(endMs);
}

const SETTLED_CHUNK_STATUSES = new Set(["completed", "failed"]);

/**
 * The server can end a recording on "transcribing" after one of its chunks
 * failed for good (a later chunk's success overwrites the failure), and nothing
 * is then left to work on.
 */
function hasSettledWithFailure(
  chunks?: readonly AudioTranscriptionChunkState[] | null,
): boolean {
  if (!chunks || chunks.length === 0) {
    return false;
  }
  const statuses = chunks.map((chunk) => chunk.status?.toLowerCase() ?? "");
  return (
    statuses.every((status) => SETTLED_CHUNK_STATUSES.has(status)) &&
    statuses.includes("failed")
  );
}

/** Anything the backend reports that is not an end state is still being worked on. */
export function audioTranscriptionPhase(
  state: AudioTranscriptionState,
): AudioTranscriptionPhase {
  const status = state.status?.toLowerCase();
  switch (status) {
    case "recording":
    case "uploading":
    case "completed":
    case "failed":
    case "canceled":
      return status;
    case undefined:
    case "":
      return isAudioTranscriptionComplete(undefined, state.chunks)
        ? "completed"
        : hasSettledWithFailure(state.chunks)
          ? "failed"
          : "transcribing";
    default:
      return hasSettledWithFailure(state.chunks) ? "failed" : "transcribing";
  }
}

function phaseText(
  phase: AudioTranscriptionPhase,
  duration: string | null,
): string {
  switch (phase) {
    case "recording":
      return duration
        ? t({
            id: "chat.audio.status.recordingDuration",
            message: `Recording · ${duration}`,
          })
        : t({ id: "chat.audio.status.recording", message: "Recording…" });
    case "uploading":
      return duration
        ? t({
            id: "chat.audio.status.uploadingDuration",
            message: `Uploading · ${duration}`,
          })
        : t({ id: "chat.audio.status.uploading", message: "Uploading…" });
    case "transcribing":
      return duration
        ? t({
            id: "chat.audio.status.transcribingDuration",
            message: `Transcribing · ${duration}`,
          })
        : t({
            id: "chat.audio.status.transcribing",
            message: "Transcribing…",
          });
    case "completed":
      return duration
        ? t({
            id: "chat.audio.status.readyDuration",
            message: `Transcript ready · ${duration}`,
          })
        : t({ id: "chat.audio.status.ready", message: "Transcript ready" });
    case "failed":
      return t({
        id: "chat.audio.status.failed",
        message: "Couldn't transcribe",
      });
    case "canceled":
      return t({
        id: "chat.audio.status.canceled",
        message: "Transcription canceled",
      });
  }
}

/**
 * A staged recording's transcription status as its file tile draws it; null
 * for a file that is no recording. The send stays blocked until `completed`.
 */
export function audioTranscriptionTileStatus(
  file: { filename: string; audio_transcription?: AudioTranscriptionState },
  options: {
    retryable: boolean;
    retrying: boolean;
    locked?: boolean;
    cancelable?: boolean;
  } = {
    retryable: false,
    retrying: false,
  },
): AudioTranscriptionTileStatus | null {
  const state = file.audio_transcription;
  if (!state) {
    return null;
  }
  const recordedMs = state.recorded_duration_ms ?? null;
  const lengthMs = recordedMs ?? state.recording_elapsed_ms ?? null;
  const serverPhase = audioTranscriptionPhase(state);
  // The server reports "recording" until it takes up the last chunk.
  const phase =
    serverPhase === "recording" && recordedMs !== null
      ? "transcribing"
      : serverPhase;
  const busy =
    phase === "recording" || phase === "uploading" || phase === "transcribing";
  const metaLabel = phaseText(
    phase,
    phase === "failed" || phase === "canceled"
      ? null
      : lengthMs !== null
        ? formatDuration(lengthMs)
        : audioTranscriptionDuration(state.chunks),
  );
  const error = state.error?.trim();
  const { filename } = file;
  // Only the composer's own recordings carry their length; an uploaded audio
  // file keeps its name.
  const transcriptText =
    lengthMs !== null
      ? getDisplayTranscript(state.transcript, state.chunks)
      : undefined;
  const excerpt = transcriptText
    ? audioTranscriptExcerpt(transcriptText)
    : undefined;
  return {
    phase,
    busy,
    metaLabel,
    ...(lengthMs !== null
      ? {
          transcript: excerpt
            ? {
                excerpt,
                more: {
                  label: t({ id: "chat.audio.more", message: "More" }),
                  name: t({
                    id: "chat.audio.moreNamed",
                    message: `More: ${filename}`,
                  }),
                },
              }
            : {},
        }
      : {}),
    ...(busy && options.cancelable
      ? {
          cancel: {
            label: t({
              id: "chat.audio.cancel",
              message: "Cancel transcription",
            }),
            name: t({
              id: "chat.audio.cancelNamed",
              message: `Cancel transcription: ${filename}`,
            }),
          },
        }
      : {}),
    ...(phase === "failed" ? { tone: "error" as const } : {}),
    ...(phase === "failed" && error ? { title: error } : {}),
    ...(phase === "failed" && options.retryable
      ? {
          action: {
            label: options.retrying
              ? t({ id: "chat.audio.retrying", message: "Retrying…" })
              : t({ id: "chat.audio.retry", message: "Retry transcription" }),
            // The visible label stays part of the name (WCAG 2.5.3).
            name: options.retrying
              ? t({
                  id: "chat.audio.retryingNamed",
                  message: `Retrying… ${filename}`,
                })
              : t({
                  id: "chat.audio.retryNamed",
                  message: `Retry transcription: ${filename}`,
                }),
            disabled: options.retrying || Boolean(options.locked),
          },
        }
      : {}),
  };
}

/** Said once a staged recording leaves an in-progress phase. */
export function audioTranscriptionOutcomeText(
  filename: string,
  phase: AudioTranscriptionPhase,
): string | null {
  if (phase === "completed") {
    return t({
      id: "chat.audio.announce.ready",
      message: `${filename}: transcript ready.`,
    });
  }
  if (phase === "failed") {
    return t({
      id: "chat.audio.announce.failed",
      message: `${filename}: couldn't transcribe.`,
    });
  }
  if (phase === "canceled") {
    return t({
      id: "chat.audio.announce.canceled",
      message: `${filename}: transcription canceled.`,
    });
  }
  return null;
}

export const audioTranscriptionPendingText = () =>
  t({
    id: "chat.audio.preview.pending",
    message: "The transcript appears here once it is ready.",
  });
