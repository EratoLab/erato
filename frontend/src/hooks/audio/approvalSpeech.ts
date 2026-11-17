import { create } from "zustand";

import { createSSEConnection } from "@/utils/sse/sseClient";

import { createPcmQueue, resumePlaybackContext } from "./pcmPlayback";
import { useSpeechPlayback } from "./speechPlayback";

import type { ReadAloudStreamEvent } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SpokenPiece } from "@/lib/toolCallGist/spokenCard";

/**
 * Plays a spoken approval card piece by piece, on the read aloud stream and
 * the same PCM queue as every other speech. Each piece remembers whether it
 * was heard, cut short or not yet said, so a listener can skip one and the
 * rest follows; a loss or consequence that was cut short is said once more
 * before the request to decide.
 */

export type SpokenPieceState = "pending" | "playing" | "heard" | "cut";

export interface PlayedPiece extends SpokenPiece {
  state: SpokenPieceState;
}

/** A card the voice can say: on its own, or again when asked. */
interface SpeakableCard {
  key: string;
  messageId: string;
  pieces: SpokenPiece[];
  /** Said instead when the card cannot be: the pointer sentence. */
  fallback?: SpokenPiece[];
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
}

export const useApprovalSpeech = create<ApprovalSpeechState>(() => ({
  key: null,
  available: null,
  pieces: [],
  current: null,
  speaking: false,
  failed: false,
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

/**
 * The piece to say after `after`: the next one not yet said, except that the
 * request waits until every must-say piece that was cut short is said again,
 * once. Returns null when nothing is left.
 */
export const nextPiece = (
  pieces: readonly PlayedPiece[],
  after: number | null,
  repeated: ReadonlySet<number>,
): number | null => {
  const start = after === null ? 0 : after + 1;
  for (let index = start; index < pieces.length; index++) {
    const piece = pieces[index];
    if (piece.state !== "pending") continue;
    if (piece.role === "request") {
      const owed = pieces.findIndex(
        (other, at) =>
          other.mustSay && other.state === "cut" && !repeated.has(at),
      );
      if (owed !== -1) return owed;
    }
    return index;
  }
  return null;
};

/** Cards already started, by key, so a re-render does not start one again. */
const started = new Set<string>();

/** Whether the card under `key` was started; a failed one counts as not. */
export const approvalSpoken = (key: string): boolean => started.has(key);

// Bumped whenever a card starts or stops, so callbacks of an earlier card
// recognise that they are stale.
let run = 0;
let speaking: SpeakableCard | null = null;
let fellBack = false;
let closeStream: (() => void) | undefined;
let buffers: Buffered[] = [];
let repeated = new Set<number>();
let pauseTimer: ReturnType<typeof setTimeout> | undefined;
let context: AudioContext | undefined;

const queue = createPcmQueue(() => settle());

const setPieceState = (index: number, state: SpokenPieceState) => {
  useApprovalSpeech.setState((previous) => ({
    pieces: previous.pieces.map((piece, at) =>
      at === index ? { ...piece, state } : piece,
    ),
  }));
};

const finish = () => {
  run++;
  const close = closeStream;
  closeStream = undefined;
  close?.();
  clearTimeout(pauseTimer);
  pauseTimer = undefined;
  queue.stop();
};

/** Hands the current piece's buffered audio to the queue. */
const feed = () => {
  const { current } = useApprovalSpeech.getState();
  if (current === null || !context || pauseTimer) return;
  const buffer = buffers[current] as Buffered | undefined;
  if (!buffer) return;
  while (buffer.queued < buffer.chunks.length) {
    const chunk = buffer.chunks[buffer.queued];
    buffer.queued++;
    if (!queue.enqueue(context, chunk.audio, chunk.sampleRate)) {
      fail();
      return;
    }
  }
  settle();
};

const play = (index: number | null) => {
  const { pieces } = useApprovalSpeech.getState();
  if (index === null) {
    finish();
    useApprovalSpeech.setState({ current: null, speaking: false });
    return;
  }
  const replay = pieces[index].state === "cut";
  if (replay) {
    repeated.add(index);
    buffers[index].queued = 0;
  }
  setPieceState(index, "playing");
  useApprovalSpeech.setState({ current: index, speaking: true });
  const pause = pieces[index].pauseBeforeMs ?? 0;
  if (pause > 0) {
    const current = run;
    pauseTimer = setTimeout(() => {
      pauseTimer = undefined;
      if (current === run) feed();
    }, pause);
    return;
  }
  feed();
};

/** Moves on once the current piece is complete and has played out. */
function settle() {
  const { current } = useApprovalSpeech.getState();
  if (current === null || pauseTimer || queue.active) return;
  const buffer = buffers[current] as Buffered | undefined;
  // The voice is faster than the network: wait for the rest of the piece.
  if (!buffer?.done || buffer.queued < buffer.chunks.length) return;
  setPieceState(current, "heard");
  play(nextPiece(useApprovalSpeech.getState().pieces, current, repeated));
}

/**
 * The card could not be spoken. Its pointer sentence is tried once; if that
 * fails too, the "audio unavailable" notice shows. Either way the card is not
 * counted as spoken, and the control that reads it stays.
 */
function fail() {
  const { current, pieces } = useApprovalSpeech.getState();
  const card = speaking;
  finish();
  if (current !== null) setPieceState(current, "cut");
  useApprovalSpeech.setState({ current: null, speaking: false, failed: true });
  if (!card) return;
  started.delete(card.key);
  const heard = pieces.some((piece) => piece.state === "heard");
  if (!fellBack && !heard && card.fallback) {
    fellBack = true;
    play_(card, card.fallback);
    return;
  }
  useSpeechPlayback.setState({ failed: true });
}

/** Stops the voice; the card keeps waiting and nothing is decided. */
export function stopApprovalSpeech() {
  const { current, speaking } = useApprovalSpeech.getState();
  if (!speaking && current === null && !closeStream) return;
  finish();
  if (current !== null) setPieceState(current, "cut");
  useApprovalSpeech.setState({ current: null, speaking: false });
}

/** Cuts the piece being said short and goes on with the next. */
export function skipApprovalPiece() {
  const { current } = useApprovalSpeech.getState();
  if (current === null) return;
  queue.stop();
  clearTimeout(pauseTimer);
  pauseTimer = undefined;
  setPieceState(current, "cut");
  play(nextPiece(useApprovalSpeech.getState().pieces, current, repeated));
}

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

/** Forgets the cards of a message that no longer waits. */
export function forgetApprovalCards(messageId: string) {
  const { available, key } = useApprovalSpeech.getState();
  if (key?.startsWith(`${messageId}:`)) stopApprovalSpeech();
  if (available?.messageId === messageId)
    useApprovalSpeech.setState({ available: null });
}

function play_(card: SpeakableCard, pieces: SpokenPiece[]) {
  const { key, messageId } = card;
  finish();
  speaking = card;
  const current = run;
  buffers = pieces.map(() => ({ chunks: [], queued: 0, done: false }));
  repeated = new Set();
  useApprovalSpeech.setState({
    key,
    available: card,
    pieces: pieces.map((piece) => ({ ...piece, state: "pending" })),
    current: null,
    speaking: true,
    failed: false,
  });
  void resumePlaybackContext().then(
    (resumed) => {
      if (current !== run) return;
      if (resumed.state !== "running") {
        fail();
        return;
      }
      context = resumed;
      let lastSequence = -1;
      let ended = false;
      closeStream = createSSEConnection(
        // eslint-disable-next-line lingui/no-unlocalized-strings -- request path
        `/api/v1beta/me/messages/${encodeURIComponent(messageId)}/approval-speech`,
        {
          method: "POST",
          body: JSON.stringify({ pieces: pieces.map((piece) => piece.text) }),
          onMessage: (event) => {
            if (current !== run) return;
            if (event.type === "audio_delta") {
              let chunk: AudioDelta;
              try {
                chunk = JSON.parse(event.data) as AudioDelta;
              } catch {
                fail();
                return;
              }
              const index = chunk.piece ?? 0;
              if (chunk.sequence <= lastSequence || !buffers[index]) return;
              lastSequence = chunk.sequence;
              buffers[index].chunks.push({
                audio: chunk.audio,
                sampleRate: chunk.sample_rate,
              });
              if (useApprovalSpeech.getState().current === index) feed();
            } else if (event.type === "piece_done") {
              let done: { piece: number };
              try {
                done = JSON.parse(event.data) as { piece: number };
              } catch {
                fail();
                return;
              }
              const buffer = buffers[done.piece] as Buffered | undefined;
              if (!buffer) return;
              buffer.done = true;
              if (useApprovalSpeech.getState().current === done.piece) feed();
            } else if (event.type === "done") {
              ended = true;
            } else if (event.type === "error") {
              fail();
            }
          },
          onError: () => {
            if (current === run) fail();
          },
          onClose: () => {
            if (current === run && !ended) fail();
          },
        },
      );
      play(nextPiece(useApprovalSpeech.getState().pieces, null, repeated));
    },
    () => {
      if (current === run) fail();
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
