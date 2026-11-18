import { create } from "zustand";

import { spokenUtteranceSentences } from "@/lib/toolCallGist/spokenCard";
import {
  spokenCardFlow,
  spokenCardStep,
} from "@/lib/toolCallGist/spokenCardFlow";
import { createSSEConnection } from "@/utils/sse/sseClient";

import { createPcmQueue, resumePlaybackContext } from "./pcmPlayback";
import { useSpeechPlayback } from "./speechPlayback";

import type { VoiceChange } from "./approvalChanges";
import type { ReadAloudStreamEvent } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
  SpokenApproval,
  SpokenPiece,
} from "@/lib/toolCallGist/spokenCard";
import type {
  SpokenCardEvent,
  SpokenCardFlow,
  SpokenNotice,
  SpokenPieceState,
} from "@/lib/toolCallGist/spokenCardFlow";

/**
 * Plays a spoken approval card piece by piece, on the read aloud stream and
 * the same PCM queue as every other speech. Which piece is said next, and
 * what was heard, is `spokenCardStep`'s: this module only turns its answers
 * into audio and the controls' taps, the listener's words and the audio's
 * ends into its events.
 *
 * The card's pieces come in one request, which keeps loading after a stop
 * so the voice can go on from the buffers. Anything else the voice says (how
 * much is left, a long text, a notice) is asked for when it is said.
 */

export type { SpokenPieceState };

export interface PlayedPiece extends SpokenPiece {
  state: SpokenPieceState;
}

/** A card the voice can say: on its own, or again when asked. */
export interface SpeakableCard {
  key: string;
  messageId: string;
  pieces: SpokenPiece[];
  /** Said instead when the card cannot be: the pointer sentence. */
  fallback?: SpokenPiece[];
  /** The language the pieces are in, for the sentences said about them. */
  language?: string;
  /** What the card shows, kept for comparing it with a card that replaces it. */
  approval?: SpokenApproval;
  /** How the card is changed by voice; absent where it cannot be. */
  change?: VoiceChange;
}

interface ApprovalSpeechState {
  /** The card being spoken: its message and approval. */
  key: string | null;
  /**
   * The waiting card the voice can say on request: after a stop, after a
   * failure, or when it was not started on its own.
   */
  available: SpeakableCard | null;
  pieces: PlayedPiece[];
  /** The piece being said, or null between pieces and when nothing plays. */
  current: number | null;
  speaking: boolean;
  failed: boolean;
  /** The card was decided or replaced; nothing is said about it any more. */
  closed: boolean;
}

export const useApprovalSpeech = create<ApprovalSpeechState>(() => ({
  key: null,
  available: null,
  pieces: [],
  current: null,
  speaking: false,
  failed: false,
  closed: false,
}));

type AudioDelta = Extract<
  ReadAloudStreamEvent,
  { message_type: "audio_delta" }
>;

interface Buffered {
  chunks: { audio: string; sampleRate: number }[];
  /** Chunks of this piece already handed to the queue. */
  queued: number;
  done: boolean;
}

const emptyBuffer = (): Buffered => ({ chunks: [], queued: 0, done: false });

/** Cards already started, by key, so a re-render does not start one again. */
const started = new Set<string>();

/** Whether the card under `key` was started; a failed one counts as not. */
export const approvalSpoken = (key: string): boolean => started.has(key);

// Bumped whenever a card starts or ends, so callbacks of an earlier card's
// stream recognise that they are stale.
let cardRun = 0;
// Bumped whenever what is played changes, for the pause before a piece.
let playRun = 0;
let speaking: SpeakableCard | null = null;
let fellBack = false;
let closeStream: (() => void) | undefined;
let buffers: Buffered[] = [];
let said: SpokenPiece[] = [];
let flow: SpokenCardFlow = spokenCardFlow([]);
let pauseTimer: ReturnType<typeof setTimeout> | undefined;
let context: AudioContext | undefined;
/** What is said besides the pieces, sentence by sentence. */
let extra: { parts: Buffered[]; at: number; close: () => void } | null = null;

const queue = createPcmQueue(() => settle());

const currentPiece = (): number | null =>
  flow.playing?.type === "piece" ? flow.playing.index : null;

const currentBuffer = (): Buffered | undefined => {
  const piece = currentPiece();
  if (piece !== null) return buffers.at(piece);
  return extra?.parts[extra.at];
};

const publish = (extraState: Partial<ApprovalSpeechState> = {}) => {
  useApprovalSpeech.setState({
    pieces: said.map((piece, index) => ({
      ...piece,
      state: flow.states[index],
    })),
    current: currentPiece(),
    speaking: flow.playing !== null,
    closed: flow.closed,
    ...extraState,
  });
};

/** Stops what plays now; the card's own stream goes on loading. */
const silence = () => {
  playRun++;
  clearTimeout(pauseTimer);
  pauseTimer = undefined;
  queue.stop();
  const ending = extra;
  extra = null;
  ending?.close();
};

/** Ends everything of the card: what plays and its stream. */
const finish = () => {
  cardRun++;
  const close = closeStream;
  closeStream = undefined;
  close?.();
  silence();
};

/** Hands the current buffer's audio to the queue. */
const feed = () => {
  const buffer = currentBuffer();
  if (!buffer || !context || pauseTimer) return;
  while (buffer.queued < buffer.chunks.length) {
    const chunk = buffer.chunks[buffer.queued];
    buffer.queued++;
    if (!queue.enqueue(context, chunk.audio, chunk.sampleRate)) {
      fail();
      return;
    }
  }
  // The whole sentence is there: it need not wait for more to start.
  if (buffer.done) queue.flush();
  settle();
};

/** One request to the voice for `sentences`, handing over their audio by index. */
const openSpeech = (
  messageId: string,
  sentences: string[],
  handlers: {
    stale: () => boolean;
    audio: (index: number, chunk: AudioDelta) => void;
    done: (index: number) => void;
    ended: () => void;
    failed: () => void;
  },
): (() => void) => {
  let lastSequence = -1;
  let ended = false;
  const failIfCurrent = () => {
    if (!handlers.stale()) handlers.failed();
  };
  return createSSEConnection(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- request path
    `/api/v1beta/me/messages/${encodeURIComponent(messageId)}/approval-speech`,
    {
      method: "POST",
      body: JSON.stringify({ pieces: sentences }),
      onMessage: (event) => {
        if (handlers.stale()) return;
        if (event.type === "audio_delta") {
          let chunk: AudioDelta;
          try {
            chunk = JSON.parse(event.data) as AudioDelta;
          } catch {
            failIfCurrent();
            return;
          }
          if (chunk.sequence <= lastSequence) return;
          lastSequence = chunk.sequence;
          handlers.audio(chunk.piece ?? 0, chunk);
        } else if (event.type === "piece_done") {
          let done: { piece: number };
          try {
            done = JSON.parse(event.data) as { piece: number };
          } catch {
            failIfCurrent();
            return;
          }
          handlers.done(done.piece);
        } else if (event.type === "done") {
          ended = true;
          handlers.ended();
        } else if (event.type === "error") {
          failIfCurrent();
        }
      },
      onError: failIfCurrent,
      onClose: () => {
        if (!ended) failIfCurrent();
      },
    },
  );
};

const pushChunk = (buffer: Buffered | undefined, chunk: AudioDelta) => {
  buffer?.chunks.push({ audio: chunk.audio, sampleRate: chunk.sample_rate });
};

/** Asks for what the voice says besides the pieces, and plays it. */
const sayExtra = (sentences: string[]) => {
  const card = speaking;
  if (!card) return;
  const thisPlay = playRun;
  const parts = sentences.map(emptyBuffer);
  const current = { parts, at: 0, close: () => {} };
  extra = current;
  current.close = openSpeech(card.messageId, sentences, {
    stale: () => extra !== current || thisPlay !== playRun,
    audio: (index, chunk) => {
      pushChunk(parts[index], chunk);
      if (current.at === index) feed();
    },
    done: (index) => {
      const part = parts[index] as Buffered | undefined;
      if (!part) return;
      part.done = true;
      if (current.at === index) feed();
    },
    ended: () => {},
    failed: fail,
  });
};

/**
 * Asks for the card's pieces at `indices`. A break while the voice is quiet,
 * or plays something already loaded, fails nothing: the pieces that did not
 * load are asked for again when they are said, and fail only then.
 */
const loadPieces = (indices: number[]) => {
  const card = speaking;
  if (!card || indices.length === 0) return;
  const thisCard = cardRun;
  const loaded = buffers;
  for (const index of indices) loaded[index] = emptyBuffer();
  let thisStream: (() => void) | undefined;
  const pieceAt = (part: number) => indices.at(part);
  thisStream = openSpeech(
    card.messageId,
    indices.map((index) => said[index].text),
    {
      stale: () => thisCard !== cardRun || closeStream !== thisStream,
      audio: (part, chunk) => {
        const index = pieceAt(part);
        if (index === undefined) return;
        pushChunk(loaded.at(index), chunk);
        if (currentPiece() === index) feed();
      },
      done: (part) => {
        const index = pieceAt(part);
        const buffer = index === undefined ? undefined : loaded.at(index);
        if (!buffer) return;
        buffer.done = true;
        if (currentPiece() === index) feed();
      },
      ended: () => {
        closeStream = undefined;
      },
      failed: () => {
        const close = closeStream;
        closeStream = undefined;
        close?.();
        const playing = currentPiece();
        if (playing !== null && !loaded[playing].done) fail();
      },
    },
  );
  closeStream = thisStream;
};

/** Plays what the card's logic says is being said now. */
const startPlaying = () => {
  const { playing } = flow;
  if (playing === null) return;
  if (playing.type !== "piece") {
    const sentences = spokenUtteranceSentences(playing, said, {
      language: speaking?.language ?? "en",
      now: new Date(),
    });
    if (sentences.length === 0) apply({ type: "finished" });
    else sayExtra(sentences);
    return;
  }
  const current = playing.index;
  // The card's audio broke off while the voice was quiet: ask again.
  if (!buffers[current].done && closeStream === undefined)
    loadPieces(
      buffers.flatMap((buffer, index) => (buffer.done ? [] : [index])),
    );
  buffers[current].queued = 0;
  const pause = said[current].pauseBeforeMs ?? 0;
  if (pause > 0) {
    const thisPlay = playRun;
    pauseTimer = setTimeout(() => {
      pauseTimer = undefined;
      if (thisPlay === playRun) feed();
    }, pause);
    return;
  }
  feed();
};

/** Moves the card's logic on by `event` and plays what it says. */
function apply(event: SpokenCardEvent) {
  const before = flow;
  flow = spokenCardStep(said, flow, event);
  publish();
  if (flow.started !== before.started) {
    silence();
    startPlaying();
  } else if (flow.playing === null && before.playing !== null) {
    // Everything is said, or the voice was stopped.
    silence();
  }
}

/** Moves on once the current piece or sentence is complete and has played out. */
function settle() {
  if (flow.playing === null || pauseTimer || queue.active) return;
  const buffer = currentBuffer();
  // The voice is faster than the network: wait for the rest of the piece.
  if (!buffer?.done || buffer.queued < buffer.chunks.length) return;
  if (extra && currentPiece() === null && extra.at < extra.parts.length - 1) {
    extra.at++;
    feed();
    return;
  }
  apply({ type: "finished" });
}

/**
 * The card could not be spoken. Its pointer sentence is tried once if
 * nothing of it was heard; otherwise the "audio unavailable" notice shows.
 * Either way the card is not counted as spoken, and the control that reads
 * it stays.
 */
function fail() {
  const card = speaking;
  finish();
  flow = spokenCardStep(said, flow, { type: "failed" });
  publish({ speaking: false, failed: true });
  if (!card) return;
  started.delete(card.key);
  // Audio mode was left or read-back turned off: nothing is said or shown.
  if (!approvalSpeechAllowed()) return;
  if (!fellBack && flow.failed === "fallback" && card.fallback) {
    fellBack = true;
    play_(card, card.fallback);
    return;
  }
  useSpeechPlayback.setState({ failed: true });
}

/** Stops the voice; the card keeps waiting and nothing is decided. */
export function stopApprovalSpeech() {
  const { current, speaking: on } = useApprovalSpeech.getState();
  if (!on && current === null && !extra) return;
  silence();
  flow = spokenCardStep(said, flow, { type: "stop" });
  publish({ speaking: false });
}

/** Cuts the piece being said short and goes on with the next. */
export function skipApprovalPiece() {
  apply({ type: "skip" });
}

/**
 * Moves the card being spoken on by what the listener asked for. Only the
 * card under `key` is steered, so words heard for a card that has since
 * gone do nothing.
 */
export function steerApprovalCard(key: string, event: SpokenCardEvent) {
  if (speaking?.key !== key || flow.closed || flow.failed) return;
  if (event.type === "stop") stopApprovalSpeech();
  else apply(event);
}

/** The card being spoken, its pieces and what was heard of them. */
export const spokenApprovalCardNow = (): {
  card: SpeakableCard;
  pieces: readonly SpokenPiece[];
  flow: SpokenCardFlow;
} | null => (speaking ? { card: speaking, pieces: said, flow } : null);

/** Whether conversational mode reads back, so a card may be spoken. */
export const approvalSpeechAllowed = (): boolean => {
  const speech = useSpeechPlayback.getState();
  return speech.conversational && speech.enabled;
};

/**
 * Speaks one approval of `messageId`, replacing whatever card was spoken.
 * `key` names the approval, so the same one is not started twice.
 */
export function speakApprovalCard(card: SpeakableCard) {
  fellBack = false;
  started.add(card.key);
  play_(card, card.pieces);
}

/**
 * Says `notice` about `messageId` when no card waits, such as what came of
 * a change request. It is not a card: it cannot be asked for again, and the
 * microphone does not listen for it.
 */
export function announceApprovalNotice(
  messageId: string,
  notice: SpokenNotice,
  language: string,
) {
  if (!approvalSpeechAllowed()) return;
  const text = spokenUtteranceSentences({ type: "notice", notice }, [], {
    language,
    now: new Date(),
  }).join(" ");
  fellBack = true;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a key and a piece id, not copy
  const key = `${messageId}:notice:${notice.kind}`;
  play_(
    { key, messageId, pieces: [] },
    [{ id: key, role: "pointer", text, mustSay: false }],
    false,
  );
}

/** Keeps a waiting card ready to be said on request, without saying it. */
export function offerApprovalCard(card: SpeakableCard) {
  started.add(card.key);
  useApprovalSpeech.setState({ available: card });
}

/** Says the waiting card again, from its start: the control a user taps. */
export function replayApprovalCard() {
  const { available } = useApprovalSpeech.getState();
  if (available) speakApprovalCard(available);
}

/**
 * Forgets the approvals under `keys`, which no longer wait: their voice ends,
 * and they can no longer be read again. Another approval of the same message,
 * such as the card that replaces one, keeps its voice.
 */
export function forgetApprovalCards(keys: readonly string[]) {
  const { available, key } = useApprovalSpeech.getState();
  if (key !== null && keys.includes(key)) {
    finish();
    flow = spokenCardStep(said, flow, { type: "closed" });
    publish({ speaking: false });
  }
  if (available && keys.includes(available.key))
    useApprovalSpeech.setState({ available: null });
}

function play_(card: SpeakableCard, pieces: SpokenPiece[], offer = true) {
  const { key } = card;
  finish();
  speaking = card;
  const current = cardRun;
  buffers = pieces.map(emptyBuffer);
  said = pieces;
  flow = spokenCardFlow(pieces);
  publish({
    key,
    available: offer ? card : null,
    speaking: true,
    failed: false,
  });
  void resumePlaybackContext().then(
    (resumed) => {
      if (current !== cardRun) return;
      if (resumed.state !== "running") {
        fail();
        return;
      }
      context = resumed;
      loadPieces(pieces.map((_, index) => index));
      apply({ type: "start" });
    },
    () => {
      if (current === cardRun) fail();
    },
  );
}

// Leaving conversational mode, or turning read-back off, ends the card's voice.
useSpeechPlayback.subscribe((state, previous) => {
  if (
    (previous.conversational && !state.conversational) ||
    (previous.enabled && !state.enabled)
  )
    stopApprovalSpeech();
});
