/* eslint-disable lingui/no-unlocalized-strings -- meanings, events and notice kinds of the card's logic; the spoken words are in spokenCardWords */
import { create } from "zustand";

import { fetchInterpretApprovalVoiceCommand } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { spokenPieceField } from "@/lib/toolCallGist/spokenCard";
import {
  currentPiece,
  heardStates,
  namesLongText,
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

import type {
  ApprovalCardPiece,
  ApprovalVoiceMeaning,
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
 * a change request for that card, with the user's words; nothing here
 * approves or rejects a card or sends a chat message. Deciding by voice is a
 * later step, which replaces the sentence `stepForMeaning` says for it now.
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
}

export const useApprovalListening = create<ApprovalListeningState>(() => ({
  pending: null,
  quiet: null,
}));

/** What a meaning does to the card, and whether the card listens after it. */
export interface MeaningStep {
  event: SpokenCardEvent | null;
  listen: boolean;
  /** The words ask for the card to be changed. */
  change?: true;
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
): MeaningStep => {
  const listen = (event: SpokenCardEvent | null): MeaningStep => ({
    event,
    listen: true,
  });
  switch (meaning) {
    case "skip":
      return listen({ type: "skip" });
    case "rest":
      return listen({ type: "rest" });
    case "repeat": {
      const index = indexOf(pieces, pieceId);
      // No piece to repeat: the card again, from its start.
      return listen(
        index === undefined ? { type: "start" } : { type: "repeat", index },
      );
    }
    case "read_text": {
      if (!pieces.some(namesLongText))
        return listen({ type: "notice", notice: { kind: "no_text" } });
      const index = indexOf(pieces, pieceId);
      return listen({
        type: "read",
        ...(index !== undefined && namesLongText(pieces[index])
          ? { index }
          : {}),
      });
    }
    case "stop":
      return { event: { type: "stop" }, listen: false };
    case "approve":
    case "reject":
      return listen({
        type: "notice",
        notice: { kind: "decide_on_screen", decision: meaning },
      });
    case "change":
      return { event: null, listen: false, change: true };
    case "new_request":
      return listen({
        type: "notice",
        notice: { kind: "new_request_on_screen" },
      });
    case "noise":
      return listen(null);
    case "unclear":
      return listen({
        type: "notice",
        notice: { kind: "unclear", hasText: pieces.some(namesLongText) },
      });
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
): Promise<void> {
  const words = Array.from(transcript.trim())
    .slice(0, MAX_TRANSCRIPT_CHARS)
    .join("");
  const now = spokenApprovalCardNow();
  if (words.length === 0 || now?.card.key !== key || now.flow.closed) return;
  const { card, pieces, flow } = now;
  const overVoice = takeTalkedOver(key, flow);
  const current = currentPiece(flow);
  useApprovalListening.setState({ pending: key });
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
        },
      },
      abort.signal,
    );
    const pieceId = (answer as { piece_id?: string | null }).piece_id;
    step = stepForMeaning(answer.meaning, pieceId, pieces);
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
  if (step.change) {
    await changeByVoice(key, transcript);
    return;
  }
  if (step.event) steerApprovalCard(key, step.event);
  if (!step.listen) useApprovalListening.setState({ quiet: key });
}

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
  // A card that was decided or replaced meanwhile cannot say it any more.
  const notice = (said: SpokenNotice) => {
    const current = spokenApprovalCardNow();
    if (current?.card.key === key && !current.flow.closed)
      steerApprovalCard(key, { type: "notice", notice: said });
    else announceApprovalNotice(card.messageId, said, card.language ?? "en");
  };
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
  const still = spokenApprovalCardNow();
  if (
    still?.card.key !== key ||
    still.flow.closed ||
    !approvalSpeechAllowed()
  ) {
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

// Saying a card again, by the control or by a new card, listens again.
useApprovalSpeech.subscribe((state, previous) => {
  if (state.speaking && !previous.speaking)
    useApprovalListening.setState({ quiet: null });
});
