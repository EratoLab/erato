import { create } from "zustand";

import {
  createPcmQueue,
  playbackContext,
  resumePlaybackContext,
} from "./pcmPlayback";

const SPEECH_ENABLED_STORAGE_KEY = "erato.audioConversational.audioBackEnabled";

function readSpeechEnabledPreference(): boolean {
  try {
    return localStorage.getItem(SPEECH_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

interface SpeechState {
  conversational: boolean;
  enabled: boolean;
  playing: boolean;
  blocked: boolean;
  failed: boolean;
  /**
   * The stream of the last response that was asked to be read back: a card
   * it stops on is spoken too. Unlike playback it survives a stop.
   */
  spokenTurn?: string;
  /**
   * The stream whose voice the user stopped: a card it stops on is not
   * spoken on its own then, but waits to be asked for.
   */
  quietTurn?: string;
}
export const useSpeechPlayback = create<SpeechState>(() => ({
  conversational: false,
  enabled: readSpeechEnabledPreference(),
  playing: false,
  blocked: false,
  failed: false,
}));
const queue = createPcmQueue(() =>
  useSpeechPlayback.setState({ playing: false }),
);
const sequences = new Map<string, number>();
let activeMessage: string | undefined;
let accepting = false;
let acceptingStream: string | undefined;

export async function enableSpeechPlayback(enabled: boolean) {
  try {
    localStorage.setItem(SPEECH_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Playback remains available when storage is unavailable.
  }
  useSpeechPlayback.setState({ enabled, blocked: false, failed: false });
  if (!enabled) {
    stopSpeechPlayback();
    return;
  }
  try {
    const context = await resumePlaybackContext();
    useSpeechPlayback.setState({ blocked: context.state !== "running" });
  } catch {
    useSpeechPlayback.setState({ blocked: true });
  }
}
export function stopSpeechPlayback(streamKey?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  accepting = false;
  queue.stop();
  useSpeechPlayback.setState({ playing: false });
}
export function beginSpeechResponse(streamKey?: string) {
  acceptingStream = streamKey;
  stopSpeechPlayback();
  activeMessage = undefined;
  accepting =
    useSpeechPlayback.getState().enabled &&
    useSpeechPlayback.getState().conversational;
  useSpeechPlayback.setState({
    failed: false,
    spokenTurn: accepting ? streamKey : undefined,
    quietTurn: undefined,
  });
}

/**
 * Whether the answer after a decision in `streamKey` is read back: when the
 * turn that stopped was, and the voice can still play it.
 */
export function readsBackContinuation(streamKey: string): boolean {
  const { spokenTurn, conversational, enabled } = useSpeechPlayback.getState();
  return spokenTurn === streamKey && conversational && enabled;
}

/** The user stopped the voice: quiet for the rest of this turn. */
export function quietSpokenTurn() {
  stopSpeechPlayback();
  useSpeechPlayback.setState((state) => ({ quietTurn: state.spokenTurn }));
}
export function moveSpeechStream(from: string, to: string) {
  if (acceptingStream === from) acceptingStream = to;
  const { spokenTurn, quietTurn } = useSpeechPlayback.getState();
  if (spokenTurn === from) useSpeechPlayback.setState({ spokenTurn: to });
  if (quietTurn === from) useSpeechPlayback.setState({ quietTurn: to });
}
export function speechFailed(streamKey?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  stopSpeechPlayback();
  useSpeechPlayback.setState({ failed: true });
}
export function playSpeechChunk(
  messageId: string,
  sequence: number,
  audio: string,
  sampleRate: number,
  streamKey?: string,
) {
  const state = useSpeechPlayback.getState();
  if (
    (acceptingStream !== undefined && acceptingStream !== streamKey) ||
    !accepting ||
    !state.enabled ||
    !state.conversational ||
    (activeMessage && activeMessage !== messageId)
  )
    return;
  if (sequence <= (sequences.get(messageId) ?? -1)) return;
  sequences.set(messageId, sequence);
  if (sequences.size > 100) {
    const oldest = sequences.keys().next().value;
    if (oldest !== undefined) sequences.delete(oldest);
  }
  activeMessage = messageId;
  const context = playbackContext();
  if (context?.state !== "running") {
    useSpeechPlayback.setState({ blocked: true });
    return; // The completed response remains available for explicit replay.
  }
  if (!queue.enqueue(context, audio, sampleRate)) {
    speechFailed();
    return;
  }
  useSpeechPlayback.setState({ playing: true });
}
