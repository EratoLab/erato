import { create } from "zustand";

import {
  createPcmQueue,
  playbackContext,
  resumePlaybackContext,
} from "./pcmPlayback";

import type { PcmChunk } from "./pcmPlayback";

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
  /**
   * The user talked over the voice: it is silent, and keeps what it has not
   * said yet until it is known whether that was a turn or only a sound.
   */
  paused: boolean;
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
  /**
   * The reply's spoken part has all its audio and the written answer is
   * streaming: once the voice is quiet the microphone may listen, and what
   * the user says waits until the answer is complete.
   */
  spokenPartDone: boolean;
}
export const useSpeechPlayback = create<SpeechState>(() => ({
  conversational: false,
  enabled: readSpeechEnabledPreference(),
  playing: false,
  paused: false,
  blocked: false,
  failed: false,
  spokenPartDone: false,
}));
const sequences = new Map<string, number>();
let activeMessage: string | undefined;
let accepting = false;
let acceptingStream: string | undefined;
/** What a paused voice has not said yet, and what arrives meanwhile. */
let held: PcmChunk[] | null = null;
/** The answer's audio held back while a wait line finishes. */
let gate: PcmChunk[] | null = null;
/**
 * A reply whose voice runs dry before its stream has ended still counts as
 * speaking, so that it does not flicker off and on inside one utterance. If
 * the stream never says it has ended, the voice counts as quiet after this.
 */
const UNDERRUN_HOLD_MS = 1500;
/** The reply's stream has ended: no more audio comes for it. */
let audioEnded = true;
let underrunTimer: ReturnType<typeof setTimeout> | undefined;
/** The current spoken part has sent its last audio. */
let spokenPartEnded = false;
const clearUnderrun = () => {
  clearTimeout(underrunTimer);
  underrunTimer = undefined;
};
const queue = createPcmQueue(() => {
  clearUnderrun();
  if (audioEnded || !accepting) {
    useSpeechPlayback.setState({ playing: false });
    return;
  }
  underrunTimer = setTimeout(() => {
    underrunTimer = undefined;
    if (!queue.active && held === null && gate === null)
      useSpeechPlayback.setState({ playing: false });
  }, UNDERRUN_HOLD_MS);
});
const interruptListeners = new Set<() => void>();

/**
 * Called whenever the voice is stopped or talked over, so that whatever
 * else speaks for the turn (a wait line) falls silent with it.
 */
export function onSpeechInterrupted(listener: () => void): () => void {
  interruptListeners.add(listener);
  return () => interruptListeners.delete(listener);
}

const interrupted = () => {
  for (const listener of interruptListeners) listener();
};

/**
 * A wait line plays: the answer's audio waits for it. Until it is released
 * the voice counts as speaking, so the microphone stays closed, the stop
 * button shows, and a card waits, as for the answer itself.
 */
export function holdReplyAudio() {
  gate ??= [];
  useSpeechPlayback.setState({ playing: true });
}

/** The wait line is over: what the answer sent meanwhile plays now. */
export function releaseReplyAudio() {
  const chunks = gate;
  if (chunks === null) return;
  gate = null;
  const context = playbackContext();
  if (chunks.length === 0 || !accepting || context?.state !== "running") {
    if (!queue.active) useSpeechPlayback.setState({ playing: false });
    return;
  }
  for (const chunk of chunks) {
    if (!queue.enqueue(context, chunk.audio, chunk.sampleRate)) {
      speechFailed();
      return;
    }
  }
  if (audioEnded) queue.flush();
  useSpeechPlayback.setState({ playing: true });
}

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
  held = null;
  gate = null;
  clearUnderrun();
  queue.stop();
  useSpeechPlayback.setState({ playing: false, paused: false });
  interrupted();
}

/**
 * The user talks over the voice: it falls silent at once, but what it has
 * not said yet is kept, and so is what still arrives for the response.
 */
export function pauseSpeechPlayback() {
  const context = playbackContext();
  if (!accepting || held !== null || !context) return;
  clearUnderrun();
  held = queue.pause(context);
  if (gate) held.push(...gate);
  gate = null;
  useSpeechPlayback.setState({ playing: false, paused: true });
  interrupted();
}

/**
 * Talking over the voice was only a sound: it goes on from the start of
 * what it was cut off in.
 */
export function resumeSpeechPlayback() {
  const chunks = held;
  if (chunks === null) return;
  held = null;
  useSpeechPlayback.setState({ paused: false });
  const context = playbackContext();
  if (context?.state !== "running") return;
  for (const chunk of chunks) {
    if (!queue.enqueue(context, chunk.audio, chunk.sampleRate)) {
      speechFailed();
      return;
    }
  }
  // Already there: it goes on at once.
  queue.flush();
  if (chunks.length > 0) useSpeechPlayback.setState({ playing: true });
}
export function beginSpeechResponse(streamKey?: string) {
  acceptingStream = streamKey;
  stopSpeechPlayback();
  activeMessage = undefined;
  accepting =
    useSpeechPlayback.getState().enabled &&
    useSpeechPlayback.getState().conversational;
  audioEnded = !accepting;
  spokenPartEnded = false;
  useSpeechPlayback.setState({
    spokenPartDone: false,
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

/**
 * The reply's stream has sent its last audio. What waits for the start
 * buffer plays now, and the voice counts as quiet once it has played out.
 */
export function endSpeechResponse(streamKey?: string, messageId?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  if (messageId && activeMessage && activeMessage !== messageId) return;
  audioEnded = true;
  // A paused voice or one behind a wait line is finished by its release.
  if (held !== null || gate !== null) return;
  queue.flush();
  if (!queue.active) {
    clearUnderrun();
    useSpeechPlayback.setState({ playing: false });
  }
}

/**
 * The reply speaks a spoken part: its audio is still to come, so a dry spell
 * between its sentences does not count as quiet.
 */
export function spokenPartBegins(streamKey?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  spokenPartEnded = false;
  if (accepting) audioEnded = false;
  if (useSpeechPlayback.getState().spokenPartDone)
    useSpeechPlayback.setState({ spokenPartDone: false });
}

/** The spoken part has sent its last audio; the written answer may follow. */
export function spokenPartEnds(streamKey?: string, messageId?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  spokenPartEnded = true;
  endSpeechResponse(streamKey, messageId);
}

/**
 * Written text arrived. After a spoken part has ended, the voice says no
 * more for this reply: a spoken part only precedes a tool call or the
 * written answer, and the written answer has begun.
 */
export function writtenPartArrives(streamKey?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  if (spokenPartEnded && !useSpeechPlayback.getState().spokenPartDone)
    useSpeechPlayback.setState({ spokenPartDone: true });
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
  if (held !== null) {
    held.push({ audio, sampleRate });
    return;
  }
  if (gate !== null) {
    gate.push({ audio, sampleRate });
    return;
  }
  const context = playbackContext();
  if (context?.state !== "running") {
    useSpeechPlayback.setState({ blocked: true });
    return; // The completed response remains available for explicit replay.
  }
  if (!queue.enqueue(context, audio, sampleRate)) {
    speechFailed();
    return;
  }
  clearUnderrun();
  useSpeechPlayback.setState({ playing: true });
}
