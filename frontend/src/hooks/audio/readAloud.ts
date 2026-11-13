import { create } from "zustand";

import { createSSEConnection } from "@/utils/sse/sseClient";

import { createPcmQueue, resumePlaybackContext } from "./pcmPlayback";

import type { ReadAloudStreamEvent } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type ReadAloudStatus = "loading" | "playing" | "failed";

type AudioDelta = Extract<
  ReadAloudStreamEvent,
  { message_type: "audio_delta" }
>;

interface ReadAloudState {
  /** The message being read aloud, or the one whose attempt just failed. */
  messageId: string | null;
  status: ReadAloudStatus | null;
  /**
   * An audio mode (conversational mode, or dictation while it records) owns
   * the microphone and the speakers; read aloud is unavailable meanwhile.
   */
  audioModeActive: boolean;
}

export const useReadAloud = create<ReadAloudState>(() => ({
  messageId: null,
  status: null,
  audioModeActive: false,
}));

const FAILED_NOTICE_MS = 4000;

// Bumped whenever playback starts or ends, so callbacks of an earlier
// playback recognise that they are stale.
let run = 0;
let closeStream: (() => void) | undefined;
let streamDone = false;
let failedTimer: ReturnType<typeof setTimeout> | undefined;

const queue = createPcmQueue(() => {
  if (streamDone) stopReadAloud();
});

function release() {
  run++;
  const close = closeStream;
  closeStream = undefined;
  close?.();
  queue.stop();
  clearTimeout(failedTimer);
  failedTimer = undefined;
}

/** Ends playback and the request behind it, whichever message it is for. */
export function stopReadAloud() {
  release();
  if (useReadAloud.getState().messageId !== null)
    useReadAloud.setState({ messageId: null, status: null });
}

function fail(messageId: string) {
  release();
  useReadAloud.setState({ messageId, status: "failed" });
  failedTimer = setTimeout(() => {
    failedTimer = undefined;
    const state = useReadAloud.getState();
    if (state.messageId === messageId && state.status === "failed")
      useReadAloud.setState({ messageId: null, status: null });
  }, FAILED_NOTICE_MS);
}

/**
 * Reads one finished assistant message aloud, replacing whatever was playing.
 * Has to be called from a click: the browser only lets a user gesture start
 * audio output.
 */
export function startReadAloud(messageId: string) {
  release();
  const current = run;
  streamDone = false;
  useReadAloud.setState({ messageId, status: "loading" });

  void resumePlaybackContext().then(
    (context) => {
      if (current !== run) return;
      if (context.state !== "running") {
        fail(messageId);
        return;
      }
      let lastSequence = -1;
      closeStream = createSSEConnection(
        // eslint-disable-next-line lingui/no-unlocalized-strings -- request path
        `/api/v1beta/me/messages/${encodeURIComponent(messageId)}/speech`,
        {
          method: "POST",
          onMessage: (event) => {
            if (current !== run) return;
            if (event.type === "audio_delta") {
              let chunk: AudioDelta;
              try {
                chunk = JSON.parse(event.data) as AudioDelta;
              } catch {
                fail(messageId);
                return;
              }
              if (chunk.sequence <= lastSequence) return;
              lastSequence = chunk.sequence;
              if (!queue.enqueue(context, chunk.audio, chunk.sample_rate)) {
                fail(messageId);
                return;
              }
              if (useReadAloud.getState().status !== "playing")
                useReadAloud.setState({ status: "playing" });
            } else if (event.type === "done") {
              streamDone = true;
              // Audio that is still queued plays out; the queue ends the
              // playback when its last chunk has ended.
              if (!queue.active) stopReadAloud();
            } else if (event.type === "error") {
              fail(messageId);
            }
          },
          onError: () => {
            if (current === run) fail(messageId);
          },
          onClose: () => {
            if (current === run && !streamDone) fail(messageId);
          },
        },
      );
    },
    () => {
      if (current === run) fail(messageId);
    },
  );
}

/** Starts reading the message, or stops if it is the one being read. */
export function toggleReadAloud(messageId: string) {
  const state = useReadAloud.getState();
  if (
    state.messageId === messageId &&
    (state.status === "loading" || state.status === "playing")
  ) {
    stopReadAloud();
    return;
  }
  startReadAloud(messageId);
}

/**
 * Called by the composer when an audio mode starts or ends. Entering one ends
 * any playback.
 */
export function setReadAloudAudioModeActive(audioModeActive: boolean) {
  if (useReadAloud.getState().audioModeActive === audioModeActive) return;
  useReadAloud.setState({ audioModeActive });
  if (audioModeActive) stopReadAloud();
}
