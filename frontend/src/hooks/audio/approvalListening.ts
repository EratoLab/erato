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
  approvalSpeechAllowed,
  spokenApprovalCardNow,
  steerApprovalCard,
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
} from "@/lib/toolCallGist/spokenCardFlow";

/**
 * Listening while a spoken approval card waits: what the user says is
 * matched by the voice command endpoint to one meaning of a closed list, and
 * the meaning steers what the voice says about the card. Nothing here decides
 * the card or sends a chat message; deciding and changing by voice are later
 * steps, which replace the sentences `stepForMeaning` says for them now.
 */

/** The endpoint waits for its model up to 2.5 s by default; this leaves room for the way. */
export const VOICE_COMMAND_TIMEOUT_MS = 8_000;
/** What the endpoint takes of the user's words. */
const MAX_TRANSCRIPT_CHARS = 300;

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
 * What the voice does for a meaning. Approving, rejecting, changing and a new
 * request are answered with a sentence and change nothing: the card keeps
 * waiting for a decision on screen. `voiceDecisionGate` is what a decision
 * by voice will have to pass once it exists.
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
      return listen({ type: "notice", notice: { kind: "change_on_screen" } });
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

const stillWaiting = (key: string): boolean => {
  const now = spokenApprovalCardNow();
  return (
    now !== null &&
    now.card.key === key &&
    !now.flow.closed &&
    approvalSpeechAllowed()
  );
};

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
  if (!stillWaiting(key)) return;
  if (step.event) steerApprovalCard(key, step.event);
  if (!step.listen) useApprovalListening.setState({ quiet: key });
}

/** Ends listening for the card under `key` until it is said again. */
export const quietApprovalListening = (key: string) =>
  useApprovalListening.setState({ quiet: key });

// Saying a card again, by the control or by a new card, listens again.
useApprovalSpeech.subscribe((state, previous) => {
  if (state.speaking && !previous.speaking)
    useApprovalListening.setState({ quiet: null });
});
