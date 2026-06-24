import { t } from "@lingui/core/macro";

import {
  createAudioDictationWebSocketUrl,
  sendAudioDictationControlFrame,
  waitForAudioDictationFrame,
  waitForSocketOpen,
} from "./audio-dictation-protocol";
import {
  createCanonicalWavBytesFromPcm,
  resampleMonoFloat32ToPcm16,
} from "./audio-pcm-codec";

/**
 * One-shot, display-only transcription of a captured clip for the mic-check
 * "We heard …" proof (ERMAIN-380). Deliberately NOT the live-capture
 * `useAudioDictationRecorder` hook: this drives the reusable protocol module
 * directly for a single round-trip.
 *
 * Privacy: routed through the **dictation** socket
 * (`/api/v1beta/me/audio-dictation/socket`), which is fully ephemeral — it
 * creates no `file_uploads` row and writes no object storage; the clip lives
 * only in the request buffer. The file-transcription socket is NOT used
 * precisely because its `start` frame persists the clip. The result is shown
 * for the user to judge with their own eyes — no score or verdict is derived
 * from it (the traffic light comes solely from acoustic analysis).
 *
 * Pure-ish module: opens its own socket, no React. Abortable via `signal`.
 */

export type TranscribeClipOnceParams = {
  /** Captured PCM in [-1, 1] at `sampleRate`. */
  samples: Float32Array;
  /** Sample rate of `samples` (the capture AudioContext rate). */
  sampleRate: number;
  signal?: AbortSignal;
};

/**
 * Sends one WAV chunk and resolves the transcript string. Returns "" for an
 * empty/garbled result so the caller can render it neutrally rather than as a
 * mic failure.
 */
export async function transcribeClipOnce({
  samples,
  sampleRate,
  signal,
}: TranscribeClipOnceParams): Promise<string> {
  if (samples.length === 0) {
    return "";
  }

  const pcmBytes = resampleMonoFloat32ToPcm16(samples, sampleRate);
  const wavBytes = createCanonicalWavBytesFromPcm(pcmBytes);
  const clipMs = Math.round((samples.length / sampleRate) * 1000);

  const socket = new WebSocket(createAudioDictationWebSocketUrl());
  socket.binaryType = "arraybuffer";

  const closeSocket = () => {
    if (socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
  };

  const abortDuringClose = () => {
    closeSocket();
  };
  signal?.addEventListener("abort", abortDuringClose, { once: true });

  try {
    await waitForSocketOpen(socket, { signal });

    // mode: dictation → the ephemeral, no-persistence handler.
    sendAudioDictationControlFrame(socket, {
      type: "start",
      mode: "dictation",
    });
    await waitForAudioDictationFrame(
      socket,
      (frame) => frame.type === "session_state",
      { signal },
    );

    sendAudioDictationControlFrame(socket, {
      // Protocol frame identifiers — not user-facing strings.
      // eslint-disable-next-line lingui/no-unlocalized-strings
      type: "chunk_metadata",
      chunk_index: 0,
      start_ms: 0,
      end_ms: clipMs,
      // eslint-disable-next-line lingui/no-unlocalized-strings
      content_type: "audio/wav",
    });
    // Send the raw WAV bytes as the binary payload for chunk 0.
    socket.send(
      wavBytes.buffer.slice(
        wavBytes.byteOffset,
        wavBytes.byteOffset + wavBytes.byteLength,
      ),
    );

    const transcribed = await waitForAudioDictationFrame(
      socket,
      (frame) => frame.type === "chunk_transcribed" && frame.chunk_index === 0,
      { signal },
    );

    if (transcribed.type !== "chunk_transcribed") {
      // Unreachable given the predicate; satisfies the discriminated union.
      throw new Error(t`Could not read the transcription response.`);
    }
    return transcribed.transcript?.trim() ?? "";
  } finally {
    signal?.removeEventListener("abort", abortDuringClose);
    closeSocket();
  }
}
