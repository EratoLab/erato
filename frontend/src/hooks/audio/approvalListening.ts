/* eslint-disable lingui/no-unlocalized-strings -- meanings, events and notice kinds of the card's logic; the spoken words are in spokenCardWords */
import { create } from "zustand";

import { fetchInterpretApprovalVoiceCommand } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { spokenPieceField } from "@/lib/toolCallGist/spokenCard";
import {
  currentPiece,
  heardStates,
  longTexts,
  namesLongText,
  voiceDecisionGate,
} from "@/lib/toolCallGist/spokenCardFlow";
import { spokenWordsFor } from "@/lib/toolCallGist/spokenCardWords";

import {
  dropChange,
  nextChangeRound,
  noteChangeSending,
  noteChangeSent,
  SEVERAL_CHANGE_ROUNDS,
} from "./approvalChanges";
import {
  announceApprovalNotice,
  prepareApprovalNotice,
  approvalSpeechAllowed,
  spokenApprovalCardNow,
  steerApprovalCard,
  stopApprovalSpeech,
  useApprovalSpeech,
} from "./approvalSpeech";

import type { SpeakableCard } from "./approvalSpeech";
import type { RecordingSignals } from "./recordingSignals";
import type {
  ApprovalCardPiece,
  ApprovalVoiceDecision,
  ApprovalVoiceMeaning,
  ApprovalVoiceSignals,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SpokenPiece } from "@/lib/toolCallGist/spokenCard";
import type {
  SpokenCardEvent,
  SpokenCardFlow,
  SpokenNotice,
  SpokenUtterance,
} from "@/lib/toolCallGist/spokenCardFlow";

/**
 * Listening while a spoken approval card waits: what the user says is
 * matched by the voice command endpoint to one meaning of a closed list, and
 * the meaning steers what the voice says about the card. A change is sent as
 * a change request for that card, with the user's words. With deciding by
 * voice on, the endpoint also says whether the words decide the card: only
 * the phrase approves, with a receipt the decision carries; "nein" refuses.
 * Nothing here sends a chat message.
 */

/** The endpoint waits for its model up to 2.5 s by default; this leaves room for the way. */
export const VOICE_COMMAND_TIMEOUT_MS = 8_000;
/** What the endpoint takes of the user's words. */
const MAX_TRANSCRIPT_CHARS = 300;
/** What a change request takes of them: `max_chars` of `[approval_change_requests]` by default. */
const MAX_CHANGE_CHARS = 1_000;
/** The confirmation is short; past this the change goes out anyway. */
export const CONFIRMATION_WAIT_MS = 5_000;

interface ApprovalListeningState {
  /** The card whose words are being understood; it does not listen meanwhile. */
  pending: string | null;
  /**
   * The card that stopped listening: told to stop, silent until the
   * recording ended, or its words could not be understood. Saying the card
   * again, by the control that reads it, listens again.
   */
  quiet: string | null;
  /**
   * What the user just said to a card, shown from the end of their words
   * until the card listens again: first only that something was heard, then
   * the words, then what they were understood as.
   */
  heard: HeardWords | null;
  /**
   * The card whose voice just asked which of its texts to read: the next
   * words to it may answer that by naming one.
   */
  askedWhichText: string | null;
  /**
   * The card the user told to stop. It keeps listening, but acts only on
   * words that resume the card ("weiter", "nochmal", "was noch", "lies …
   * vor"); to anything else, a yes, a no or a change included, it says
   * nothing and sends nothing: the user may be talking to someone else.
   * Ends when the voice says something of the card again.
   */
  stopped: string | null;
  /** The card the microphone is open for. */
  listening: string | null;
  /** Approvals by voice that missed the phrase, by card. */
  misses: Record<string, number>;
}

export interface HeardWords {
  key: string;
  words: string | null;
  meaning: ApprovalVoiceMeaning | null;
}

export const useApprovalListening = create<ApprovalListeningState>(() => ({
  pending: null,
  quiet: null,
  heard: null,
  askedWhichText: null,
  stopped: null,
  listening: null,
  misses: {},
}));

/** The microphone opened for the card under `key`, or closed (`null`). */
export const noteApprovalListening = (key: string | null) => {
  if (useApprovalListening.getState().listening !== key)
    useApprovalListening.setState({ listening: key });
};

/** When the voice last stopped speaking, on the device's clock. */
let voiceStoppedAt = 0;
/** When each card's request was last heard in full. */
const requestHeardAt = new Map<string, number>();

/** The user's words to the card under `key` ended; they are being transcribed. */
export const noteApprovalWordsEnded = (key: string) =>
  useApprovalListening.setState({
    heard: { key, words: null, meaning: null },
  });

/** The card under `key` listens again: what was heard before is no longer shown. */
export const clearApprovalWordsHeard = (key: string) => {
  if (useApprovalListening.getState().heard?.key === key)
    useApprovalListening.setState({ heard: null });
};

const noteHeard = (key: string, heard: Partial<HeardWords>) => {
  const current = useApprovalListening.getState().heard;
  useApprovalListening.setState({
    heard: {
      key,
      words: current?.key === key ? current.words : null,
      meaning: current?.key === key ? current.meaning : null,
      ...heard,
    },
  });
};

/** What a meaning does to the card, and whether the card listens after it. */
export interface MeaningStep {
  event: SpokenCardEvent | null;
  listen: boolean;
  /** The words ask for the card to be changed. */
  change?: true;
  /** The voice asks which text to read; the next words may answer it. */
  asksWhichText?: true;
  /** The voice was told to stop: it listens on, silent to what it cannot use. */
  stops?: true;
  /** The words decide the card: the decision goes out with this receipt. */
  decide?: { decision: "approve" | "reject"; receipt: string | undefined };
  /** An approval that missed the phrase. */
  missed?: true;
}

/** What the card was in when the words came. */
export interface MeaningContext {
  /** The voice had just asked which text to read. */
  askedWhichText?: boolean;
  /** The voice had been told to stop. */
  stopped?: boolean;
  /**
   * Deciding by voice is on for this card: `approves` when its request
   * names the phrase. Absent, decisions are made on screen.
   */
  byVoice?: { approves: boolean };
  /** The endpoint's answer on whether the words decide the card. */
  decision?: ApprovalVoiceDecision;
  /** Approvals on this card that missed the phrase so far. */
  misses?: number;
}

const indexOf = (
  pieces: readonly SpokenPiece[],
  id: string | null | undefined,
): number | undefined => {
  if (!id) return undefined;
  const index = pieces.findIndex((piece) => piece.id === id);
  return index === -1 ? undefined : index;
};

/**
 * What the voice does for a meaning. Approving, rejecting and a new request
 * are answered with a sentence and change nothing: the card keeps waiting
 * for a decision on screen. A change is sent by `heardApprovalWords`.
 * `voiceDecisionGate` is what a decision by voice will have to pass once it
 * exists.
 */
export const stepForMeaning = (
  meaning: ApprovalVoiceMeaning,
  pieceId: string | null | undefined,
  pieces: readonly SpokenPiece[],
  context: MeaningContext = {},
): MeaningStep => {
  const listen = (event: SpokenCardEvent | null): MeaningStep => ({
    event,
    listen: true,
  });
  const index = indexOf(pieces, pieceId);
  const named = index !== undefined && namesLongText(pieces[index]);
  switch (meaning) {
    case "skip":
      return listen({ type: "skip" });
    case "rest":
      return listen({ type: "rest" });
    case "repeat":
      // A text named in answer to "which text" is read, not its piece again.
      if (context.askedWhichText && named)
        return listen({ type: "read", index });
      // No piece to repeat: the card again, from its start.
      return listen(
        index === undefined ? { type: "start" } : { type: "repeat", index },
      );
    case "read_text": {
      const texts = longTexts(pieces);
      if (texts.length === 0)
        return listen({ type: "notice", notice: { kind: "no_text" } });
      if (named) return listen({ type: "read", index });
      if (texts.length === 1) return listen({ type: "read", index: texts[0] });
      // Several texts and none named: ask, never guess by their order.
      return {
        ...listen({
          type: "notice",
          notice: {
            kind: "which_text",
            fields: texts.map((at) => spokenPieceField(pieces[at]) ?? ""),
          },
        }),
        asksWhichText: true,
      };
    }
    case "stop":
      return { event: { type: "stop" }, listen: true, stops: true };
    case "approve":
    case "reject": {
      if (context.stopped) return listen(null);
      const onScreen = listen({
        type: "notice",
        notice: { kind: "decide_on_screen", decision: meaning },
      });
      const { byVoice, decision } = context;
      if (!byVoice || !decision) return onScreen;
      const approve = meaning === "approve";
      const confirmOnScreen = listen({
        type: "notice",
        notice: { kind: "confirm_on_screen" },
      });
      switch (decision.status) {
        case "accepted":
          // A card whose request did not name the phrase is approved on
          // screen, whatever the words were; an approval needs its receipt.
          if (approve && (!byVoice.approves || !decision.receipt))
            return confirmOnScreen;
          return {
            event: null,
            listen: false,
            decide: { decision: meaning, receipt: decision.receipt },
          };
        case "not_yet":
          // What the card still owes, and the request after it.
          return listen({ type: "rest" });
        case "screen_only":
          return approve
            ? confirmOnScreen
            : listen({ type: "notice", notice: { kind: "decline_on_screen" } });
        case "say_again":
          // The words were right; the recording could not carry them.
          if (!approve)
            return listen({ type: "notice", notice: { kind: "say_again" } });
          if (!byVoice.approves) return confirmOnScreen;
          return listen({
            type: "notice",
            notice: { kind: "say_phrase_again" },
          });
        case "phrase_needed": {
          if (!approve) return onScreen;
          if (!byVoice.approves) return confirmOnScreen;
          const second = (context.misses ?? 0) >= 1;
          return {
            ...listen({
              type: "notice",
              notice: { kind: second ? "phrase_on_screen" : "say_phrase" },
            }),
            missed: true,
          };
        }
      }
      return onScreen;
    }
    case "change":
      // After a stop, words that sound like a change may be for someone else.
      return context.stopped
        ? listen(null)
        : { event: null, listen: false, change: true };
    case "new_request":
      // After a stop, words to someone else are let be.
      return listen(
        context.stopped
          ? null
          : { type: "notice", notice: { kind: "new_request_on_screen" } },
      );
    case "noise":
      return listen(null);
    case "unclear":
      return listen(
        context.stopped
          ? null
          : {
              type: "notice",
              notice: { kind: "unclear", hasText: pieces.some(namesLongText) },
            },
      );
  }
};

/**
 * A piece as the endpoint takes it. The generated schema types the optional
 * strings of the request and answer as null only, so they are typed here.
 */
export type CommandPiece = Omit<ApprovalCardPiece, "field"> & {
  field?: string;
};

/** The card as the endpoint takes it: ids, roles, fields and what was heard. */
export const commandPieces = (
  pieces: readonly SpokenPiece[],
  flow: SpokenCardFlow,
): CommandPiece[] => {
  const states = heardStates(flow);
  return pieces.map((piece, index) => {
    const field = spokenPieceField(piece);
    return {
      id: piece.id,
      role: piece.role,
      ...(field ? { field: Array.from(field).slice(0, 100).join("") } : {}),
      state: states[index],
      ...(piece.mustSay ? { must_say: true } : {}),
    };
  });
};

/** Whether the card's language has the sentences the listener answers with. */
export const listensIn = (language: string | undefined): boolean =>
  language !== undefined && spokenWordsFor(language, { now: new Date() }).full;

const statusOf = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null || !("status" in error))
    return undefined;
  return typeof error.status === "number" ? error.status : undefined;
};

/**
 * Whether the answer still belongs to what the user heard: the same card, in
 * the same reading and quiet, as when the words were sent. A reading the user
 * restarted meanwhile, by the control that reads the card, is not steered by
 * words said about the earlier one.
 */
const stillWaiting = (key: string, asked: SpokenCardFlow): boolean => {
  const now = spokenApprovalCardNow();
  return (
    now?.card.key === key &&
    now.flow === asked &&
    !now.flow.closed &&
    !useApprovalSpeech.getState().speaking &&
    approvalSpeechAllowed()
  );
};

/** What the voice was saying about a card when the user talked over it. */
let talkedOver: {
  key: string;
  flow: SpokenCardFlow;
  cut: SpokenUtterance;
} | null = null;

/**
 * The user talks over the voice reading the card under `key`: what it was
 * saying is cut short, and its words go the way words said in silence go.
 */
export function talkOverApprovalCard(key: string) {
  const before = spokenApprovalCardNow();
  if (before?.card.key !== key || before.flow.closed) return;
  const cut = before.flow.playing;
  stopApprovalSpeech();
  const after = spokenApprovalCardNow();
  talkedOver = cut && after ? { key, flow: after.flow, cut } : null;
}

/** Says again, from its start, what the user talked over. */
export const resumeEvent = (cut: SpokenUtterance): SpokenCardEvent => {
  switch (cut.type) {
    case "piece":
      return { type: "repeat", index: cut.index };
    case "text":
      return { type: "read", index: cut.index };
    case "held":
      return { type: "held" };
    case "count":
    case "nothing_left":
      return { type: "rest" };
    case "notice":
      return { type: "notice", notice: cut.notice };
  }
};

/** "Again" over how much the voice holds back is that sentence again. */
export const againOverVoice = (
  cut: SpokenUtterance,
  event: SpokenCardEvent,
): SpokenCardEvent =>
  cut.type === "held" && event.type === "repeat" && event.index === undefined
    ? { type: "held" }
    : event;

/** The voice was talked over under `key`, and nothing happened since. */
const takeTalkedOver = (key: string, flow: SpokenCardFlow) => {
  const record = talkedOver;
  talkedOver = null;
  return record?.key === key && record.flow === flow ? record : null;
};

/**
 * Talking over the voice brought no words (a cough, a breath): the voice
 * goes on with what it was cut off in, from its start.
 */
export function resumeTalkedOverCard(key: string) {
  const now = spokenApprovalCardNow();
  if (!now) return;
  const record = takeTalkedOver(key, now.flow);
  if (!record || !stillWaiting(key, now.flow)) return;
  steerApprovalCard(key, resumeEvent(record.cut));
}

/**
 * Acts on what the user said while the card under `key` waited. Words for a
 * card that has since been decided, replaced or left are dropped.
 */
export async function heardApprovalWords(
  key: string,
  transcript: string,
  recording?: RecordingSignals,
): Promise<void> {
  const words = Array.from(transcript.trim())
    .slice(0, MAX_TRANSCRIPT_CHARS)
    .join("");
  const now = spokenApprovalCardNow();
  if (words.length === 0 || now?.card.key !== key || now.flow.closed) return;
  const { card, pieces, flow } = now;
  const overVoice = takeTalkedOver(key, flow);
  const current = currentPiece(flow);
  const listening = useApprovalListening.getState();
  const context: MeaningContext = {
    askedWhichText: listening.askedWhichText === key,
    stopped: listening.stopped === key,
    ...(card.decision ? { byVoice: { approves: card.decision.approves } } : {}),
    misses: listening.misses[key] ?? 0,
  };
  const signals = card.decision ? voiceSignals(key, recording) : undefined;
  // A question is answered by the next words only.
  useApprovalListening.setState({ pending: key, askedWhichText: null });
  noteHeard(key, { words, meaning: null });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), VOICE_COMMAND_TIMEOUT_MS);
  let step: MeaningStep;
  try {
    const answer = await fetchInterpretApprovalVoiceCommand(
      {
        pathParams: { messageId: card.messageId },
        body: {
          transcript: words,
          ...(card.language ? { language: card.language } : {}),
          pieces: commandPieces(pieces, flow) as ApprovalCardPiece[],
          ...(current !== null ? { current_piece_id: pieces[current].id } : {}),
          ...(context.askedWhichText ? { question: "which_text" } : {}),
          ...(card.decision ? { approval_id: card.decision.approvalId } : {}),
          ...(signals ? { signals } : {}),
        },
      },
      abort.signal,
    );
    const pieceId = (answer as { piece_id?: string | null }).piece_id;
    const decision = (answer as { decision?: ApprovalVoiceDecision }).decision;
    noteHeard(key, { meaning: answer.meaning });
    step = stepForMeaning(answer.meaning, pieceId, pieces, {
      ...context,
      ...(decision ? { decision } : {}),
    });
  } catch (error) {
    // 409: the card was decided meanwhile; it says nothing more.
    step =
      statusOf(error) === 409
        ? { event: null, listen: false }
        : {
            event: { type: "notice", notice: { kind: "unavailable" } },
            listen: false,
          };
  } finally {
    clearTimeout(timer);
    if (useApprovalListening.getState().pending === key)
      useApprovalListening.setState({ pending: null });
  }
  if (!stillWaiting(key, flow)) return;
  // Only a sound ("mhm") over the voice: it goes on where it was cut.
  if (overVoice && step.listen && step.event === null && !step.change)
    step = { ...step, event: resumeEvent(overVoice.cut) };
  if (overVoice && step.event)
    step = { ...step, event: againOverVoice(overVoice.cut, step.event) };
  if (step.missed)
    useApprovalListening.setState(({ misses }) => ({
      misses: { ...misses, [key]: (misses[key] ?? 0) + 1 },
    }));
  if (step.decide) {
    await decideByVoice(key, step.decide);
    return;
  }
  if (step.change) {
    await changeByVoice(key, transcript);
    return;
  }
  if (step.event) steerApprovalCard(key, step.event);
  if (step.asksWhichText)
    useApprovalListening.setState({ askedWhichText: key });
  if (step.stops) useApprovalListening.setState({ stopped: key });
  if (!step.listen) useApprovalListening.setState({ quiet: key });
}

/**
 * The recording's measurements as the endpoint takes them, with when the
 * voice stopped and when the card's request was heard. Without the
 * recorder's measurements an approval cannot count, but a refusal still can.
 */
const voiceSignals = (
  key: string,
  recording: RecordingSignals | undefined,
): ApprovalVoiceSignals | undefined => {
  if (!recording) return undefined;
  const asked = requestHeardAt.get(key);
  const ms = (value: number) => Math.max(0, Math.round(value));
  return {
    voice_stopped_at_ms: ms(voiceStoppedAt),
    ...(asked !== undefined ? { request_heard_at_ms: ms(asked) } : {}),
    recording_started_at_ms: ms(recording.startedAt),
    recording_ended_at_ms: ms(recording.endedAt),
    ...(recording.firstSpeechAt !== null
      ? { first_speech_at_ms: ms(recording.firstSpeechAt) }
      : {}),
    speech_ms: ms(recording.speechMs),
    recorded_ms: ms(recording.recordedMs),
    over_voice: recording.overVoice,
  };
};

/**
 * Sends the decision the user said to the card under `key`, once the card
 * still waits and has asked with nothing owed. A refusal is confirmed first,
 * then sent; an approval goes out at once, and the answer is read back as
 * after a tap. A failure is said once, and the card waits on screen.
 */
async function decideByVoice(
  key: string,
  { decision, receipt }: NonNullable<MeaningStep["decide"]>,
): Promise<void> {
  const now = spokenApprovalCardNow();
  if (now?.card.key !== key || now.flow.closed) return;
  const { card, pieces, flow } = now;
  const notice = cardNotice(key, card);
  const voice = card.decision;
  if (!voice || !voiceDecisionGate(pieces, flow).ready) {
    notice(
      decision === "approve"
        ? { kind: "confirm_on_screen" }
        : { kind: "decline_on_screen" },
    );
    return;
  }
  useApprovalListening.setState({ quiet: key });
  if (decision === "reject") {
    notice({ kind: "declined" });
    await untilSilent(key, CONFIRMATION_WAIT_MS);
    if (!stillOpen(key)) return;
  }
  let outcome: Awaited<ReturnType<typeof voice.send>>;
  try {
    outcome = await voice.send(decision, receipt);
  } catch {
    outcome = "failed";
  }
  if (outcome === "sent") return;
  notice({ kind: "decision_failed" });
  useApprovalListening.setState({ quiet: key });
}

/**
 * Says `notice` about the card under `key`: on the card while it waits, or
 * for its message once it was decided or replaced meanwhile.
 */
const cardNotice =
  (key: string, card: SpeakableCard) => (said: SpokenNotice) => {
    const current = spokenApprovalCardNow();
    if (current?.card.key === key && !current.flow.closed)
      steerApprovalCard(key, { type: "notice", notice: said });
    else announceApprovalNotice(card.messageId, said, card.language ?? "en");
  };

/** The card under `key` still waits, and audio mode still speaks. */
const stillOpen = (key: string): boolean => {
  const still = spokenApprovalCardNow();
  return (
    still?.card.key === key && !still.flow.closed && approvalSpeechAllowed()
  );
};

/** Resolves once the voice is silent about `key`, or after `ms`. */
const untilSilent = (key: string, ms: number): Promise<void> =>
  new Promise((resolve) => {
    let stop = () => {};
    const timer = setTimeout(() => {
      stop();
      resolve();
    }, ms);
    const check = () => {
      const state = useApprovalSpeech.getState();
      if (state.key === key && state.speaking) return false;
      clearTimeout(timer);
      stop();
      resolve();
      return true;
    };
    if (!check()) stop = useApprovalSpeech.subscribe(check);
  });

/**
 * Sends what the user wants different about the card under `key`, after the
 * voice said briefly that it changes it. Only the card the user listened to
 * is changed, by its own approval id; if it was decided or left meanwhile,
 * nothing goes out. A failure is said once, and the card keeps waiting.
 */
async function changeByVoice(key: string, transcript: string): Promise<void> {
  const now = spokenApprovalCardNow();
  if (now?.card.key !== key) return;
  const { card, pieces, flow } = now;
  const notice = cardNotice(key, card);
  if (!card.change) {
    notice({ kind: "change_on_screen", reason: "card" });
    return;
  }
  if (!card.change.ready()) {
    notice({ kind: "change_on_screen", reason: "others" });
    return;
  }
  const { change } = card;
  const heard = pieces.flatMap((piece, index) =>
    flow.heard[index] ? [piece.id] : [],
  );
  // What is said if no corrected card comes is asked for now, while the
  // card still waits: afterwards the voice speaks nothing for this message.
  const prepared = prepareApprovalNotice(
    card.messageId,
    {
      kind: "change_no_card",
      several: nextChangeRound(change.approvalId) >= SEVERAL_CHANGE_ROUNDS,
    },
    card.language ?? "en",
  );
  notice({ kind: "changing" });
  useApprovalListening.setState({ quiet: key });
  await untilSilent(key, CONFIRMATION_WAIT_MS);
  if (!stillOpen(key)) {
    prepared?.close();
    return;
  }
  noteChangeSending({
    ...(prepared ? { prepared } : {}),
    messageId: card.messageId,
    approvalId: change.approvalId,
    language: card.language,
    approval: card.approval ?? { type: "pointer" },
    heard,
    words: transcript,
  });
  const words = Array.from(transcript.trim())
    .slice(0, MAX_CHANGE_CHARS)
    .join("");
  let outcome: Awaited<ReturnType<typeof change.send>>;
  try {
    outcome = await change.send(words);
  } catch {
    outcome = "failed";
  }
  if (outcome === "sent") {
    noteChangeSent(change.approvalId);
    return;
  }
  dropChange(change.approvalId);
  notice({
    kind: outcome === "conflict" ? "change_conflict" : "change_failed",
  });
  // Said once: the card waits on screen, and is said again only on request.
  useApprovalListening.setState({ quiet: key });
}

/** Ends listening for the card under `key` until it is said again. */
export const quietApprovalListening = (key: string) =>
  useApprovalListening.setState({ quiet: key });

// When the voice stops, and when a card's request was last heard: an
// approval by voice counts only from a recording after both.
useApprovalSpeech.subscribe((state, previous) => {
  if (state.speaking || !previous.speaking) return;
  voiceStoppedAt = Date.now();
  const now = spokenApprovalCardNow();
  if (!now) return;
  const request = now.pieces.findIndex((piece) => piece.role === "request");
  if (request !== -1 && now.flow.last === request)
    requestHeardAt.set(now.card.key, voiceStoppedAt);
});

// Saying a card again, by the control or by a new card, listens again; a
// stop is over once the voice says something of the card, not a notice.
useApprovalSpeech.subscribe((state, previous) => {
  if (!state.speaking || previous.speaking) return;
  const notice = spokenApprovalCardNow()?.flow.playing?.type === "notice";
  useApprovalListening.setState(
    notice ? { quiet: null } : { quiet: null, stopped: null },
  );
});
