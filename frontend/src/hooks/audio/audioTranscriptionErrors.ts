import { t } from "@lingui/core/macro";

/** Mirrors the backend's `AudioTranscriptionErrorCode` protocol literals. */
export type AudioTranscriptionErrorCode =
  | "provider_content_blocked"
  | "provider_error"
  | "transcription_failed";

export type AudioTranscriptionFailureFrame = {
  error?: string | null;
  error_code?: AudioTranscriptionErrorCode | string | null;
};

function formatPassageStart(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Turns a failure frame into a message the user can act on and quote to their
 * team. Unknown codes fall back to the server text or the caller's default.
 */
export function describeAudioTranscriptionFailure(
  frame: AudioTranscriptionFailureFrame,
  options: { fallback: string; passageStartMs?: number },
): string {
  const passage =
    options.passageStartMs === undefined
      ? null
      : formatPassageStart(options.passageStartMs);
  const code = frame.error_code ?? null;
  let message: string;
  switch (code) {
    case "provider_content_blocked":
      message = passage
        ? t`The passage starting at ${passage} could not be transcribed because the AI provider's content filter blocked it. This also happens with harmless speech. Please say it differently or type it.`
        : t`A passage could not be transcribed because the AI provider's content filter blocked it. This also happens with harmless speech. Please say it differently or type it.`;
      break;
    case "provider_error":
      message = passage
        ? t`The AI provider could not transcribe the passage starting at ${passage}. Please try again.`
        : t`The AI provider could not transcribe a passage. Please try again.`;
      break;
    case "transcription_failed":
      message = passage
        ? t`The passage starting at ${passage} could not be transcribed. Please try again.`
        : t`A passage could not be transcribed. Please try again.`;
      break;
    default: {
      const serverText = frame.error?.trim() ?? "";
      return serverText.length > 0 ? serverText : options.fallback;
    }
  }
  return `${message} ${t`Error code: ${code}`}`;
}
