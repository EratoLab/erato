import { i18n } from "@lingui/core";
import { useEffect } from "react";

import {
  sameSpokenKind,
  spokenApprovalPieces,
} from "@/lib/toolCallGist/spokenCard";

import {
  approvalSpoken,
  forgetApprovalCards,
  offerApprovalCard,
  speakApprovalCard,
} from "./approvalSpeech";
import { useSpeechPlayback } from "./speechPlayback";

import type { SpokenApproval } from "@/lib/toolCallGist/spokenCard";

/**
 * Speaks the approval a card shows when conversational mode reads back and
 * the turn that stopped on it was a spoken one, once the model's own words
 * of that turn have played. Several approvals are spoken one at a time, as
 * the screen shows them. After a stop the card waits to be asked for.
 */
export function useSpokenApprovalCard({
  chatId,
  messageId,
  approvals,
  keys,
  index,
  active,
  responding,
}: {
  chatId: string | null;
  messageId: string;
  /** The open approvals in the order the screen shows them. */
  approvals: readonly SpokenApproval[];
  /**
   * Each approval's own identity. A turn that goes on after a decision stops
   * again in the same message, so neither the message nor the position tells
   * one stop from the next.
   */
  keys: readonly string[];
  /** The one on screen now. */
  index: number;
  /** The card asks for a decision and none is on its way. */
  active: boolean;
  /** The chat is still receiving the turn. */
  responding: boolean;
}) {
  const spokenTurn = useSpeechPlayback(
    (state) =>
      chatId !== null &&
      state.conversational &&
      state.enabled &&
      state.spokenTurn === chatId,
  );
  const quiet = useSpeechPlayback(
    (state) => chatId !== null && state.quietTurn === chatId,
  );
  const modelSpeaking = useSpeechPlayback((state) => state.playing);
  const approval = approvals[index] as SpokenApproval | undefined;
  const key = `${messageId}:${keys[index] ?? index}`;

  useEffect(() => {
    if (!active || !spokenTurn || modelSpeaking || responding || !approval)
      return;
    if (approvalSpoken(key)) return;
    const total = approvals.length;
    const options = {
      language: i18n.locale,
      now: new Date(),
      position:
        total > 1
          ? {
              index,
              total,
              sameAsPrevious:
                index > 0 && sameSpokenKind(approvals[index - 1], approval),
            }
          : undefined,
    };
    const card = {
      key,
      messageId,
      pieces: spokenApprovalPieces(approval, options),
      fallback: spokenApprovalPieces({ type: "pointer" }, options),
    };
    // A stop during the turn's own words means quiet: the card waits to be
    // asked for.
    if (quiet) offerApprovalCard(card);
    else speakApprovalCard(card);
  }, [
    active,
    approval,
    approvals,
    index,
    key,
    messageId,
    modelSpeaking,
    quiet,
    responding,
    spokenTurn,
  ]);

  // A decision, or the card going away, ends the voice of its own approvals
  // only: another card of the message may be speaking.
  const cardKeys = (keys.length > 0 ? keys : [String(index)])
    .map((entry) => `${messageId}:${entry}`)
    .join("\n");
  useEffect(() => {
    if (!active) forgetApprovalCards(cardKeys.split("\n"));
  }, [active, cardKeys]);
  useEffect(() => () => forgetApprovalCards(cardKeys.split("\n")), [cardKeys]);
}
