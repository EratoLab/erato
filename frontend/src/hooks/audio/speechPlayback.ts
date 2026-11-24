import { create } from "zustand";

import {
  createPcmQueue,
  playbackContext,
  playbackPlays,
  resumePlaybackContext,
} from "./pcmPlayback";

import type { PcmChunk } from "./pcmPlayback";

interface SpeechState {
  conversational: boolean;
  /**
   * Replies are spoken in conversational mode: the user's setting as the
   * backend resolves it, on until it is known.
   */
  enabled: boolean;
  /**
   * Waiting approval cards are read aloud, where replies are spoken: the
   * user's setting as the backend resolves it, on until it is known.
   */
  cards: boolean;
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
   * The reply's spoken part has all its audio and the written answer is
   * streaming: once the voice is quiet the microphone may listen, and what
   * the user says waits until the answer is complete.
   */
  spokenPartDone: boolean;
  /** A tool call of the response runs, or an approved action has not reported back. */
  actionRunning: boolean;
}
export const useSpeechPlayback = create<SpeechState>(() => ({
  conversational: false,
  enabled: true,
  cards: true,
  playing: false,
  paused: false,
  blocked: false,
  failed: false,
  spokenPartDone: false,
  actionRunning: false,
}));
/**
 * What the voice says, passage by passage (its wait lines included), with
 * the playback time each passage plays from and to: words heard over the
 * voice that only repeat what it was saying then are its echo.
 */
export interface Said {
  text: string;
  startsAt: number;
  /** The end of its audio scheduled so far. */
  endsAt: number;
  /** All its audio is scheduled: the next passage has begun. */
  complete: boolean;
}
let said: Said[] = [];
const MAX_SAID = 40;
/** When the user last talked over the voice, in playback time. */
let pausedAt: number | null = null;
/** Whether the reply's own voice, not a wait line, was sounding then. */
let replySounded = false;
/** A voice's pace while its passage's length in time is not known yet. */
const CHARS_PER_SECOND = 15;
/**
 * Around the estimated spot: what the recording held back before the speech
 * over the voice was confirmed, with room for the estimate's error.
 */
const HEARD_BEFORE_CHARS = 150;
const HEARD_AFTER_CHARS = 40;
/** A passage that ended longer ago than this was not sounding any more. */
const STILL_SOUNDING_S = 1.5;

export function noteVoiceChunk(
  text: string | undefined,
  startsAt: number,
  endsAt: number,
) {
  const last = said.at(-1);
  if (text === undefined) {
    if (last && !last.complete) last.endsAt = endsAt;
    return;
  }
  if (last) last.complete = true;
  said = [
    ...said.slice(-(MAX_SAID - 1)),
    { text, startsAt, endsAt, complete: false },
  ];
}

/** All of the reply's audio is scheduled: its last passage ends where it ends. */
function completeLastPassage() {
  const last = said.at(-1);
  if (last && audioEnded && held === null && gate === null)
    last.complete = true;
}

/**
 * What the voice was saying when the user talked over it: the stretch
 * around the spot reached in the passage then playing, at that passage's
 * own pace. Empty when nothing was sounding.
 */
export function voiceTextAtPause(): string {
  return pausedAt === null ? "" : voiceTextAt(said, pausedAt);
}

/** Whether the user talked over the reply's own voice. */
export const replySoundedAtPause = (): boolean => replySounded;

/** {@link voiceTextAtPause} for passages `log` at playback time `at`. */
export function voiceTextAt(log: readonly Said[], at: number): string {
  const started = log.filter((entry) => entry.startsAt <= at);
  const current = started.at(-1);
  if (!current || at > current.endsAt + STILL_SOUNDING_S) return "";
  const length = current.text.length;
  const duration = current.endsAt - current.startsAt;
  const rate =
    current.complete && duration > 0.5 ? length / duration : CHARS_PER_SECOND;
  const spot = Math.min(length, Math.round((at - current.startsAt) * rate));
  const earlier =
    spot < HEARD_BEFORE_CHARS
      ? (started.at(-2)?.text.slice(-(HEARD_BEFORE_CHARS - spot)) ?? "")
      : "";
  return `${earlier} ${current.text.slice(
    Math.max(0, spot - HEARD_BEFORE_CHARS),
    spot + HEARD_AFTER_CHARS,
  )}`.trim();
}

/**
 * Tool calls of the current response that run, and an approved action whose
 * result has not come: speech over the voice must not stop the turn then,
 * or an action that ran would be shown as stopped.
 */
const runningCalls = new Set<string>();
let approvedAction = false;
const publishAction = () => {
  const actionRunning = runningCalls.size > 0 || approvedAction;
  if (useSpeechPlayback.getState().actionRunning !== actionRunning)
    useSpeechPlayback.setState({ actionRunning });
};

export function noteToolCall(
  streamKey: string | undefined,
  toolCallId: string,
  status: "preparing" | "in_progress" | "success" | "error",
) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  if (status === "success" || status === "error") {
    runningCalls.delete(toolCallId);
    approvedAction = false;
  } else runningCalls.add(toolCallId);
  publishAction();
}

/** The response that follows an approval runs the approved action first. */
export function noteApprovedAction(streamKey?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  approvedAction = true;
  publishAction();
}

/**
 * The last audio chunk played for the current response, so that a resumed
 * stream's replay is not said twice. Every stream numbers its audio from 0,
 * an approval continuation too, though it speaks for the same message.
 */
let lastSequence = -1;
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
/**
 * The spoken parts of the reply so far, counted when their first text and
 * when their last audio arrive. A part's end comes after its audio, so it
 * can arrive after the next model call has begun.
 */
let partsBegun = 0;
let partsEnded = 0;
/** Within the current model call: a spoken part is open, it spoke, it wrote. */
let partOpen = false;
let callSpoke = false;
let callWrote = false;
const resetParts = () => {
  partsBegun = 0;
  partsEnded = 0;
  partOpen = false;
  callSpoke = false;
  callWrote = false;
};
/**
 * Once the current model call's spoken part is said and its written answer
 * streams, the voice says no more for the reply.
 */
const markSpokenPartDone = () => {
  if (
    callSpoke &&
    callWrote &&
    partsEnded >= partsBegun &&
    !useSpeechPlayback.getState().spokenPartDone
  )
    useSpeechPlayback.setState({ spokenPartDone: true });
};
const clearUnderrun = () => {
  clearTimeout(underrunTimer);
  underrunTimer = undefined;
};
let quietWaiters: (() => void)[] = [];
const replyQuiet = () => !queue.active && held === null && gate === null;
const settleQuiet = () => {
  if (!replyQuiet()) return;
  const waiters = quietWaiters;
  quietWaiters = [];
  for (const resolve of waiters) resolve();
};
const queue = createPcmQueue(() => {
  clearUnderrun();
  settleQuiet();
  if (audioEnded || !accepting) {
    useSpeechPlayback.setState({ playing: false });
    return;
  }
  underrunTimer = setTimeout(() => {
    underrunTimer = undefined;
    if (replyQuiet()) useSpeechPlayback.setState({ playing: false });
  }, UNDERRUN_HOLD_MS);
}, noteVoiceChunk);
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
 * Resolves once the reply's voice has played out the audio it has, at once
 * when it has none: a wait line after a spoken part waits for its end.
 */
export function afterReplyAudio(): Promise<void> {
  return new Promise((resolve) => {
    quietWaiters.push(resolve);
    settleQuiet();
  });
}

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
  if (chunks.length === 0 || !accepting || !playbackPlays(context)) {
    if (!queue.active) useSpeechPlayback.setState({ playing: false });
    settleQuiet();
    return;
  }
  for (const chunk of chunks) {
    if (!queue.enqueue(context, chunk.audio, chunk.sampleRate, chunk.text)) {
      speechFailed();
      return;
    }
  }
  if (audioEnded) queue.flush();
  completeLastPassage();
  useSpeechPlayback.setState({ playing: true });
}

/**
 * The user's settings for a spoken conversation, as the backend resolves
 * them. Turning replies off silences what is said now.
 */
export function applySpokenSettings(settings: {
  replies?: boolean;
  cards?: boolean;
}) {
  const { enabled, cards } = useSpeechPlayback.getState();
  const next = {
    enabled: settings.replies ?? enabled,
    cards: settings.cards ?? cards,
  };
  if (next.enabled === enabled && next.cards === cards) return;
  // A notice about a voice that is now off would stay for good.
  useSpeechPlayback.setState(
    next.enabled ? next : { ...next, blocked: false, failed: false },
  );
  if (!next.enabled) stopSpeechPlayback();
}

/**
 * Lets the browser play the voice: called from a user gesture, since
 * autoplay may be blocked until then.
 */
export async function unlockSpeechPlayback() {
  useSpeechPlayback.setState({ blocked: false, failed: false });
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
  settleQuiet();
  interrupted();
}

/**
 * The user talks over the voice: it falls silent at once, but what it has
 * not said yet is kept, and so is what still arrives for the response.
 */
export function pauseSpeechPlayback() {
  const context = playbackContext();
  pausedAt = context?.currentTime ?? null;
  replySounded = queue.active;
  // Passages queued but not begun are said again later, if at all.
  const at = pausedAt;
  if (at !== null) said = said.filter((entry) => entry.startsAt <= at);
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
  if (!playbackPlays(context)) return;
  // The passage it was cut in goes on from about where it was: logged
  // again as begun that long before now, so a later talk-over finds it.
  const cut = pausedAt === null ? undefined : said.at(-1);
  if (cut && pausedAt !== null && chunks.length > 0 && !chunks[0].text) {
    const shift = context.currentTime - pausedAt;
    said = [
      ...said,
      {
        ...cut,
        startsAt: cut.startsAt + shift,
        endsAt: cut.complete ? cut.endsAt + shift : context.currentTime,
      },
    ];
  }
  for (const chunk of chunks) {
    if (!queue.enqueue(context, chunk.audio, chunk.sampleRate, chunk.text)) {
      speechFailed();
      return;
    }
  }
  // Already there: it goes on at once.
  queue.flush();
  completeLastPassage();
  if (chunks.length > 0) useSpeechPlayback.setState({ playing: true });
}
export function beginSpeechResponse(streamKey?: string) {
  acceptingStream = streamKey;
  stopSpeechPlayback();
  activeMessage = undefined;
  lastSequence = -1;
  accepting =
    useSpeechPlayback.getState().enabled &&
    useSpeechPlayback.getState().conversational;
  audioEnded = !accepting;
  resetParts();
  said = [];
  pausedAt = null;
  replySounded = false;
  runningCalls.clear();
  approvedAction = false;
  publishAction();
  useSpeechPlayback.setState({
    spokenPartDone: false,
    failed: false,
    spokenTurn: accepting ? streamKey : undefined,
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
  completeLastPassage();
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
  if (!partOpen) {
    partOpen = true;
    partsBegun += 1;
    callSpoke = true;
    callWrote = false;
  }
  if (accepting) audioEnded = false;
  if (useSpeechPlayback.getState().spokenPartDone)
    useSpeechPlayback.setState({ spokenPartDone: false });
}

/** A spoken part has sent its last audio. */
export function spokenPartEnds(streamKey?: string, messageId?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  partsEnded += 1;
  // The end of an earlier call's part: the current call may still speak.
  if (!callSpoke || partsEnded < partsBegun) return;
  endSpeechResponse(streamKey, messageId);
  markSpokenPartDone();
}

/** Written text arrived: after a spoken part, the written answer has begun. */
export function writtenPartArrives(streamKey?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  partOpen = false;
  callWrote = true;
  markSpokenPartDone();
}

/**
 * The model calls a tool: the next call may speak again, or reply without
 * a spoken part, which the voice then reads as it streams.
 */
export function replyCallsTool(streamKey?: string) {
  if (streamKey !== undefined && acceptingStream !== streamKey) return;
  partOpen = false;
  callSpoke = false;
  callWrote = false;
  if (accepting) audioEnded = false;
  if (useSpeechPlayback.getState().spokenPartDone)
    useSpeechPlayback.setState({ spokenPartDone: false });
}

export function moveSpeechStream(from: string, to: string) {
  if (acceptingStream === from) acceptingStream = to;
  const { spokenTurn } = useSpeechPlayback.getState();
  if (spokenTurn === from) useSpeechPlayback.setState({ spokenTurn: to });
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
  /** On a passage's first chunk, what the voice says from here on. */
  text?: string,
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
  if (sequence <= lastSequence) return;
  lastSequence = sequence;
  activeMessage = messageId;
  if (held !== null) {
    held.push({ audio, sampleRate, text });
    return;
  }
  if (gate !== null) {
    gate.push({ audio, sampleRate, text });
    return;
  }
  const context = playbackContext();
  if (!playbackPlays(context)) {
    useSpeechPlayback.setState({ blocked: true });
    return; // The completed response remains available for explicit replay.
  }
  if (!queue.enqueue(context, audio, sampleRate, text)) {
    speechFailed();
    return;
  }
  clearUnderrun();
  useSpeechPlayback.setState({ playing: true });
}
