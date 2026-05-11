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
  timeoutMs = AUDIO_DICTATION_SOCKET_OPEN_TIMEOUT_MS,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
    };

    socket.addEventListener("open", handleOpen, { once: true });
    socket.addEventListener("error", handleError, { once: true });
    socket.addEventListener("close", handleClose, { once: true });
  });
}

export function waitForAudioDictationFrame(
  socket: WebSocket,
  predicate: (frame: AudioDictationSocketFrame) => boolean,
  timeoutMs = AUDIO_DICTATION_SOCKET_FRAME_TIMEOUT_MS,
): Promise<AudioDictationSocketFrame> {
  return new Promise<AudioDictationSocketFrame>((resolve, reject) => {
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

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);
  });
}
