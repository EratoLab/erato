import { create } from "zustand";

import { inLocale } from "@/lib/i18n";
import { spokenUtteranceSentences } from "@/lib/toolCallGist/spokenCard";
import {
  spokenCardFlow,
  spokenCardStep,
} from "@/lib/toolCallGist/spokenCardFlow";
import { createSSEConnection } from "@/utils/sse/sseClient";

import { deploymentConfirmationPhrases } from "./confirmationPhrases";
import { createPcmQueue, resumePlaybackContext } from "./pcmPlayback";
import { useSpeechPlayback } from "./speechPlayback";
import { afterWaitLine, waitLinePlaying } from "./waitLines";

import type { VoiceChange, VoiceDecision } from "./approvalChanges";
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
  /** How the card is decided by voice; absent where it is decided on screen. */
  decision?: VoiceDecision;
  /** A notice about a card, not a card: a failure to say it shows nothing. */
  notice?: true;
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
/** The prepared notice being said, whose own request still loads it. */
let playingPrepared: Prepared | null = null;
let closeStream: (() => void) | undefined;
/** Streams of pieces said only on request, each loaded when asked for. */
const askedStreams = new Map<number, () => void>();
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
  playingPrepared = null;
  const close = closeStream;
  closeStream = undefined;
  close?.();
  for (const closeAsked of askedStreams.values()) closeAsked();
  askedStreams.clear();
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

/**
 * One request to the voice for `sentences`, worded in `language`, handing
 * over their audio by index.
 */
const openSpeech = (
  messageId: string,
  language: string | undefined,
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
      body: JSON.stringify(
        language ? { pieces: sentences, language } : { pieces: sentences },
      ),
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

/**
 * A piece's audio far too short for its words was cut on the way (seen once:
 * 0.4 s for a sentence of 73 characters): it is not counted as heard. Speech
 * takes 60 to 90 ms a character; a third of the lowest is the floor.
 */
const MIN_MS_PER_CHARACTER = 20;
/** Short words ("Okay.") may be said faster than that. */
const MIN_CHARACTERS_CHECKED = 12;

export const audioTooShort = (
  text: string,
  chunks: readonly { audio: string; sampleRate: number }[],
) => {
  const characters = Array.from(text.trim()).length;
  if (characters < MIN_CHARACTERS_CHECKED) return false;
  const ms = chunks.reduce(
    (sum, chunk) =>
      sum +
      ((globalThis.atob(chunk.audio).length / 2) * 1000) / chunk.sampleRate,
    0,
  );
  return ms < characters * MIN_MS_PER_CHARACTER;
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
  current.close = openSpeech(card.messageId, card.language, sentences, {
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
    card.language,
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
        // A field said on request loads in its own request.
        if (
          playing !== null &&
          indices.includes(playing) &&
          !loaded[playing].done
        )
          fail();
      },
    },
  );
  closeStream = thisStream;
};

/**
 * Asks for a piece said only on request, in a request of its own: the card's
 * stream may still be loading, and nothing is spoken for it in advance.
 */
const loadAsked = (index: number) => {
  const card = speaking;
  if (!card) return;
  const thisCard = cardRun;
  const buffer = emptyBuffer();
  buffers[index] = buffer;
  const close = openSpeech(card.messageId, card.language, [said[index].text], {
    stale: () => thisCard !== cardRun || buffers[index] !== buffer,
    audio: (_, chunk) => {
      pushChunk(buffer, chunk);
      if (currentPiece() === index) feed();
    },
    done: () => {
      buffer.done = true;
      if (currentPiece() === index) feed();
    },
    ended: () => {
      askedStreams.delete(index);
    },
    failed: () => {
      askedStreams.get(index)?.();
      askedStreams.delete(index);
      if (currentPiece() === index && !buffer.done) fail();
    },
  });
  askedStreams.set(index, close);
};

/** Plays what the card's logic says is being said now. */
const startPlaying = () => {
  const { playing } = flow;
  if (playing === null) return;
  if (playing.type !== "piece") {
    const language = speaking?.language ?? "en";
    const sentences = inLocale(language, () =>
      spokenUtteranceSentences(playing, said, {
        language,
        now: new Date(),
      }),
    );
    if (sentences.length === 0) apply({ type: "finished" });
    else sayExtra(sentences);
    return;
  }
  const current = playing.index;
  if (said[current].onRequest) {
    if (!buffers[current].done && !askedStreams.has(current))
      loadAsked(current);
  } else if (!buffers[current].done && closeStream === undefined) {
    // The card's audio broke off while the voice was quiet: ask again.
    loadPieces(
      buffers.flatMap((buffer, index) =>
        buffer.done || said[index].onRequest ? [] : [index],
      ),
    );
  }
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
  const piece = currentPiece();
  if (piece !== null && audioTooShort(said[piece].text, buffer.chunks)) {
    fail();
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
  // A notice that could not be said is left out: the answer it follows was
  // read, and the composer shows no error for it.
  if (!approvalSpeechAllowed() || card.notice) return;
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
 * Says `notice` about `messageId`, such as what came of a change request. It
 * is not a card: it cannot be asked for again, and the microphone does not
 * listen for it. The voice answers only while an approval of the message
 * waits, so a notice for after the card is gone is prepared beforehand.
 */
export function announceApprovalNotice(
  messageId: string,
  notice: SpokenNotice,
  language: string,
) {
  if (!approvalSpeechAllowed()) return;
  const text = noticeText(notice, language);
  fellBack = true;
  const key = noticeKey(messageId, notice);
  play_(
    { key, messageId, pieces: [], notice: true, language },
    [{ id: key, role: "pointer", text, mustSay: false }],
    false,
  );
}

const noticeText = (notice: SpokenNotice, language: string) =>
  inLocale(language, () =>
    spokenUtteranceSentences({ type: "notice", notice }, [], {
      language,
      now: new Date(),
      confirmationPhrases: deploymentConfirmationPhrases(),
    }),
  ).join(" ");

const noticeKey = (messageId: string, notice: SpokenNotice) =>
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a key and a piece id, not copy
  `${messageId}:notice:${notice.kind}`;

/** A notice asked for while its card still waits, to be said after it is gone. */
export interface PreparedNotice {
  /** Stops loading it; it is not said. */
  close(): void;
}

interface Prepared extends PreparedNotice {
  key: string;
  messageId: string;
  language: string;
  text: string;
  buffer: Buffered;
  failed: boolean;
  closed: boolean;
  stream: () => void;
}

/**
 * Asks the voice for `notice` now, while an approval of `messageId` still
 * waits, and keeps its audio until `sayPreparedNotice`. The voice speaks only
 * the sentences the client asks for while an approval waits; nothing is
 * spoken for a message once its approval is gone.
 */
export function prepareApprovalNotice(
  messageId: string,
  notice: SpokenNotice,
  language: string,
): PreparedNotice | null {
  if (!approvalSpeechAllowed()) return null;
  const buffer = emptyBuffer();
  const prepared: Prepared = {
    key: noticeKey(messageId, notice),
    messageId,
    language,
    text: noticeText(notice, language),
    buffer,
    failed: false,
    closed: false,
    stream: () => {},
    close: () => {
      prepared.closed = true;
      prepared.stream();
    },
  };
  prepared.stream = openSpeech(messageId, language, [prepared.text], {
    stale: () => prepared.closed,
    audio: (_, chunk) => {
      pushChunk(buffer, chunk);
      if (playingPrepared === prepared) feed();
    },
    done: () => {
      buffer.done = true;
      if (playingPrepared === prepared) feed();
    },
    ended: () => {},
    failed: () => {
      prepared.failed = true;
      if (playingPrepared === prepared) fail();
    },
  });
  return prepared;
}

/** Says a prepared notice from what was loaded; a failed one says nothing. */
export function sayPreparedNotice(notice: PreparedNotice) {
  const prepared = notice as Prepared;
  if (prepared.closed || prepared.failed || !approvalSpeechAllowed()) {
    prepared.close();
    return;
  }
  fellBack = true;
  play_(
    {
      key: prepared.key,
      messageId: prepared.messageId,
      pieces: [],
      notice: true,
      language: prepared.language,
    },
    [
      {
        id: prepared.key,
        role: "pointer",
        text: prepared.text,
        mustSay: false,
      },
    ],
    false,
    prepared,
  );
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

function play_(
  card: SpeakableCard,
  pieces: SpokenPiece[],
  offer = true,
  prepared?: Prepared,
) {
  const { key } = card;
  finish();
  speaking = card;
  const current = cardRun;
  buffers = prepared ? [prepared.buffer] : pieces.map(emptyBuffer);
  if (prepared) {
    playingPrepared = prepared;
    // Its own request still loads it; it is not asked for again.
    closeStream = prepared.buffer.done ? undefined : () => prepared.close();
  }
  said = pieces;
  flow = spokenCardFlow(pieces);
  publish({
    key,
    available: offer ? card : null,
    speaking: true,
    failed: false,
  });
  const start = (resumed: AudioContext) => {
    if (current !== cardRun) return;
    if (resumed.state !== "running") {
      fail();
      return;
    }
    context = resumed;
    if (!prepared)
      loadPieces(
        pieces.flatMap((piece, index) => (piece.onRequest ? [] : [index])),
      );
    apply({ type: "start" });
  };
  void resumePlaybackContext().then(
    (resumed) => {
      // A wait line that is being said finishes first.
      if (waitLinePlaying()) void afterWaitLine().then(() => start(resumed));
      else start(resumed);
    },
    () => {
      if (current === cardRun) fail();
    },
  );
}

// Leaving conversational mode, or turning spoken replies or cards off, ends
// the card's voice.
useSpeechPlayback.subscribe((state, previous) => {
  if (
    (previous.conversational && !state.conversational) ||
    (previous.enabled && !state.enabled) ||
    (previous.cards && !state.cards)
  )
    stopApprovalSpeech();
});
