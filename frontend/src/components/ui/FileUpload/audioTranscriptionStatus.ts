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
  tone?: "error";
  /** The tile's meta line, e.g. "Transcribing · 0:42". */
  metaLabel: string;
  /** The error, for the tile's title. */
  title?: string;
  /** "Retry transcription", offered only for a recording the recorder still holds. */
  action?: AudioTranscriptionTileAction;
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
  if (endMs <= 0) {
    return null;
  }
  const totalSeconds = Math.round(endMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
        : "transcribing";
    default:
      return "transcribing";
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
  options: { retryable: boolean; retrying: boolean; locked?: boolean } = {
    retryable: false,
    retrying: false,
  },
): AudioTranscriptionTileStatus | null {
  const state = file.audio_transcription;
  if (!state) {
    return null;
  }
  const phase = audioTranscriptionPhase(state);
  const busy =
    phase === "recording" || phase === "uploading" || phase === "transcribing";
  const metaLabel = phaseText(
    phase,
    phase === "failed" || phase === "canceled"
      ? null
      : audioTranscriptionDuration(state.chunks),
  );
  const error = state.error?.trim();
  const { filename } = file;
  return {
    phase,
    busy,
    metaLabel,
    ...(phase === "failed" ? { tone: "error" as const } : {}),
    ...(phase === "failed" && error ? { title: error } : {}),
    ...(phase === "failed" && options.retryable
      ? {
          action: {
            label: options.retrying
              ? t({ id: "chat.audio.retrying", message: "Retrying…" })
              : t({ id: "chat.audio.retry", message: "Retry transcription" }),
            name: t({
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
  return null;
}

export const audioTranscriptionPendingText = () =>
  t({
    id: "chat.audio.preview.pending",
    message: "The transcript appears here once it is ready.",
  });
