import { t } from "@lingui/core/macro";

/**
 * WebSocket protocol helpers for the audio-dictation socket. The
 * server-side contract is the dotted-namespace `/api/v1beta/me/
 * audio-dictation/socket` endpoint — see backend `audio_dictation`
 * route. This module owns: URL construction, control-frame encoding,
 * and async helpers that wait for the open handshake or a particular
 * server frame, with timeouts and the same error-mapping used by the
 * recorder hook.
 */

const AUDIO_DICTATION_SOCKET_OPEN_TIMEOUT_MS = 15_000;
const AUDIO_DICTATION_SOCKET_FRAME_TIMEOUT_MS = 5 * 60_000;

function abortRejection(signal: AbortSignal | undefined): unknown {
  if (signal && signal.reason !== undefined) {
    return signal.reason;
  }
  // The DOMException name / message are programmatic identifiers, not
  // user-facing strings — they match what `AbortSignal` and `fetch`
  // throw when aborted.
  // eslint-disable-next-line lingui/no-unlocalized-strings
  return new DOMException("Aborted", "AbortError");
}

export type AudioDictationSocketFrame =
  | {
      type: "session_state";
      next_chunk_index?: number;
      chunk_duration_ms?: number;
    }
  | {
      type: "chunk_ack";
      chunk_index: number;
    }
  | {
      type: "chunk_transcribed";
      chunk_index: number;
      transcript?: string | null;
    }
  | {
      type: "completed";
    }
  | {
      type: "error";
      error?: string | null;
    };

export function createAudioDictationWebSocketUrl(): string {
  const url = new URL(
    // eslint-disable-next-line lingui/no-unlocalized-strings
    "/api/v1beta/me/audio-dictation/socket",
    window.location.href,
  );
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function sendAudioDictationControlFrame(
  socket: WebSocket,
  frame: Record<string, unknown>,
) {
  socket.send(JSON.stringify(frame));
}

export function waitForSocketOpen(
  socket: WebSocket,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? AUDIO_DICTATION_SOCKET_OPEN_TIMEOUT_MS;
  const { signal } = options;
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortRejection(signal));
      return;
    }
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(t`Audio dictation connection timed out.`));
    }, timeoutMs);
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(t`Audio dictation connection failed.`));
    };
    const handleClose = () => {
      cleanup();
      reject(new Error(t`Audio dictation connection closed.`));
    };
    const handleAbort = () => {
      cleanup();
      reject(abortRejection(signal));
    };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
      signal?.removeEventListener("abort", handleAbort);
    };

    socket.addEventListener("open", handleOpen, { once: true });
    socket.addEventListener("error", handleError, { once: true });
    socket.addEventListener("close", handleClose, { once: true });
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

export function waitForAudioDictationFrame(
  socket: WebSocket,
  predicate: (frame: AudioDictationSocketFrame) => boolean,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AudioDictationSocketFrame> {
  const timeoutMs =
    options.timeoutMs ?? AUDIO_DICTATION_SOCKET_FRAME_TIMEOUT_MS;
  const { signal } = options;
  return new Promise<AudioDictationSocketFrame>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortRejection(signal));
      return;
    }
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(t`Audio dictation response timed out.`));
    }, timeoutMs);

    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }

      try {
        const frame = JSON.parse(event.data) as AudioDictationSocketFrame;
        if (frame.type === "error") {
          cleanup();
          reject(new Error(frame.error ?? t`Audio dictation failed.`));
          return;
        }

        if (predicate(frame)) {
          cleanup();
          resolve(frame);
        }
      } catch (error) {
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error(t`Could not read audio dictation response.`),
        );
      }
    };

    const handleError = () => {
      cleanup();
      reject(new Error(t`Audio dictation connection failed.`));
    };

    const handleClose = () => {
      cleanup();
      reject(new Error(t`Audio dictation connection closed.`));
    };

    const handleAbort = () => {
      cleanup();
      reject(abortRejection(signal));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
      signal?.removeEventListener("abort", handleAbort);
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}
