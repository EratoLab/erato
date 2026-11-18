import { create } from "zustand";

import { useSpeechPlayback } from "./speechPlayback";

import type { WithdrawnCard } from "@/lib/toolCallGist/spokenCardDifference";

/**
 * Change requests said to a spoken approval card: the card the user asked to
 * change, kept until the corrected card comes, so the voice can say only
 * what differs; and what the voice still owes when no card comes.
 */

/** What a card's screen offers the voice for changing it. */
export interface VoiceChange {
  approvalId: string;
  /** Whether the change can go out now; another open approval may need deciding first. */
  ready: () => boolean;
  /**
   * Sends the change request for this approval with the user's words. Only
   * `request_change` is ever sent from here.
   */
  send: (words: string) => Promise<VoiceChangeOutcome>;
}

/**
 * `sent`: the server took it. `conflict`: the card was decided or replaced
 * meanwhile. `failed`: anything else; the card keeps waiting.
 */
export type VoiceChangeOutcome = "sent" | "conflict" | "failed";

export interface ChangeRecord extends WithdrawnCard {
  messageId: string;
  approvalId: string;
  language?: string;
  /** Change requests in a row on this card and the cards before it. */
  round: number;
  /**
   * `sending`: the request is on its way. `sent`: the server took it, and the
   * answer is awaited. `answered`: a card came, or the answer was told.
   */
  state: "sending" | "sent" | "answered";
}

interface ApprovalChangesState {
  /** By the approval id of the withdrawn card. */
  records: Record<string, ChangeRecord>;
}

export const useApprovalChanges = create<ApprovalChangesState>(() => ({
  records: {},
}));

/** The round each corrected card was in, by its approval id. */
const rounds = new Map<string, number>();

const update = (
  approvalId: string,
  change: (record: ChangeRecord) => ChangeRecord | undefined,
) =>
  useApprovalChanges.setState(({ records }) => {
    const record = records[approvalId] as ChangeRecord | undefined;
    if (!record) return { records };
    const next = { ...records };
    const changed = change(record);
    if (changed) next[approvalId] = changed;
    else delete next[approvalId];
    return { records: next };
  });

/** The change request for `approvalId` is on its way. */
export const noteChangeSending = (
  record: Omit<ChangeRecord, "round" | "state">,
) =>
  useApprovalChanges.setState(({ records }) => ({
    records: {
      ...records,
      [record.approvalId]: {
        ...record,
        round: (rounds.get(record.approvalId) ?? 0) + 1,
        state: "sending",
      },
    },
  }));

export const noteChangeSent = (approvalId: string) =>
  update(approvalId, (record) =>
    record.state === "sending" ? { ...record, state: "sent" } : record,
  );

export const noteChangeAnswered = (approvalId: string) =>
  update(approvalId, (record) => ({ ...record, state: "answered" }));

export const dropChange = (approvalId: string) =>
  update(approvalId, () => undefined);

/**
 * The card `approvalId` replaced, for the voice to compare with; it is taken
 * once. `next` is the corrected card's own approval id, which counts its
 * round on.
 */
export const takeWithdrawnCard = (
  approvalId: string,
  next: string,
): ChangeRecord | undefined => {
  const record = useApprovalChanges.getState().records[approvalId] as
    | ChangeRecord
    | undefined;
  if (!record) return undefined;
  rounds.set(next, record.round);
  dropChange(approvalId);
  return record;
};

/** The change request whose answer is still awaited, if any. */
export const awaitedChange = (
  records: Record<string, ChangeRecord>,
): ChangeRecord | null =>
  Object.values(records).find(
    (record) => record.state === "sending" || record.state === "sent",
  ) ?? null;

// Leaving conversational mode, or turning read-back off, forgets every
// change: the corrected card is then read on screen.
useSpeechPlayback.subscribe((state, previous) => {
  if (
    (previous.conversational && !state.conversational) ||
    (previous.enabled && !state.enabled)
  ) {
    rounds.clear();
    useApprovalChanges.setState({ records: {} });
  }
});
