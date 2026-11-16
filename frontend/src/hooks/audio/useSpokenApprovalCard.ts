import { i18n } from "@lingui/core";
import { useEffect } from "react";

import {
  sameSpokenKind,
  spokenApprovalPieces,
} from "@/lib/toolCallGist/spokenCard";

import {
  speakApprovalCard,
  stopApprovalSpeech,
  useApprovalSpeech,
} from "./approvalSpeech";
import { useSpeechPlayback } from "./speechPlayback";

import type { SpokenApproval } from "@/lib/toolCallGist/spokenCard";

/** Approvals already spoken, so a remount or a re-render does not repeat one. */
const spoken = new Set<string>();

/**
 * Speaks the approval a card shows when conversational mode reads back and
 * the turn that stopped on it was a spoken one, once the model's own words
 * of that turn have played. Several approvals are spoken one at a time, as
 * the screen shows them.
 */
export function useSpokenApprovalCard({
  chatId,
  messageId,
  approvals,
  index,
  active,
  responding,
}: {
  chatId: string | null;
  messageId: string;
  /** The open approvals in the order the screen shows them. */
  approvals: readonly SpokenApproval[];
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
  const modelSpeaking = useSpeechPlayback((state) => state.playing);
  const approval = approvals[index] as SpokenApproval | undefined;
  const key = `${messageId}:${index}`;

  useEffect(() => {
    if (!active || !spokenTurn || modelSpeaking || responding || !approval)
      return;
    if (spoken.has(key)) return;
    spoken.add(key);
    const total = approvals.length;
    speakApprovalCard(
      key,
      messageId,
      spokenApprovalPieces(approval, {
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
      }),
    );
  }, [
    active,
    approval,
    approvals,
    index,
    key,
    messageId,
    modelSpeaking,
    responding,
    spokenTurn,
  ]);

  // A decision, or the card going away, ends its voice.
  useEffect(() => {
    if (active) return;
    if (useApprovalSpeech.getState().key?.startsWith(`${messageId}:`))
      stopApprovalSpeech();
  }, [active, messageId]);
  useEffect(
    () => () => {
      if (useApprovalSpeech.getState().key?.startsWith(`${messageId}:`))
        stopApprovalSpeech();
    },
    [messageId],
  );
}
