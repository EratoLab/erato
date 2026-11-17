import { useEffect, useRef } from "react";

import {
  awaitedChange,
  noteChangeAnswered,
  useApprovalChanges,
} from "./approvalChanges";
import { announceApprovalNotice } from "./approvalSpeech";

/** A card that comes with the answer registers within this. */
export const NO_CARD_GRACE_MS = 400;
/** From this many change requests in a row, the sentence says so. */
const SEVERAL_ROUNDS = 3;

/**
 * What the voice says when a change request was answered without a card:
 * the model asked back or answered in words, or the rounds ran out. The
 * model's own words are read first; then one sentence says that nothing was
 * run and what can be done. A corrected card speaks for itself.
 *
 * Returns `holding` while a change request waits for its answer, so the
 * conversation does not open the microphone for a new message meanwhile.
 */
export function useApprovalChangeOutcome({
  enabled,
  responding,
  decisionWaiting,
  voicePlaying,
}: {
  /** Conversational mode reads back. */
  enabled: boolean;
  /** A response is on its way. */
  responding: boolean;
  /** A card waits for a decision. */
  decisionWaiting: boolean;
  /** The model's answer is being read. */
  voicePlaying: boolean;
}): { holding: boolean } {
  const awaited = useApprovalChanges((state) => awaitedChange(state.records));
  // The approval whose answer has begun: the withdrawn card is gone or the
  // response runs. Before that, a waiting card is still the withdrawn one.
  const answering = useRef<string | null>(null);

  useEffect(() => {
    if (awaited?.state !== "sent" || !enabled) return;
    if (responding || !decisionWaiting) answering.current = awaited.approvalId;
    if (responding || voicePlaying) return;
    if (decisionWaiting) {
      if (answering.current === awaited.approvalId)
        noteChangeAnswered(awaited.approvalId);
      return;
    }
    const timer = setTimeout(() => {
      noteChangeAnswered(awaited.approvalId);
      announceApprovalNotice(
        awaited.messageId,
        // eslint-disable-next-line lingui/no-unlocalized-strings -- notice kind
        { kind: "change_no_card", several: awaited.round >= SEVERAL_ROUNDS },
        awaited.language ?? "en",
      );
    }, NO_CARD_GRACE_MS);
    return () => clearTimeout(timer);
  }, [awaited, decisionWaiting, enabled, responding, voicePlaying]);

  return { holding: enabled && awaited !== null };
}
