import { i18n } from "@lingui/core";
import { useEffect, useRef } from "react";

import {
  sameSpokenKind,
  spokenApprovalPieces,
} from "@/lib/toolCallGist/spokenCard";
import { spokenDifference } from "@/lib/toolCallGist/spokenCardDifference";

import { takeWithdrawnCard } from "./approvalChanges";
import {
  NATURAL_WAIT_AT_START_MS,
  forgetNaturalApprovals,
  naturalApprovalPieces,
  useNaturalApprovalSpeech,
} from "./approvalRewording";
import {
  approvalSpoken,
  forgetApprovalCards,
  offerApprovalCard,
  speakApprovalCard,
} from "./approvalSpeech";
import { useSpeechPlayback } from "./speechPlayback";

import type { VoiceChange } from "./approvalChanges";
import type { SpokenApproval } from "@/lib/toolCallGist/spokenCard";

/**
 * Speaks the approval a card shows when conversational mode reads back and
 * the turn that stopped on it was a spoken one, once the model's own words
 * of that turn have played. Several approvals are spoken one at a time, as
 * the screen shows them. After a stop the card waits to be asked for. A card
 * that corrects one the user asked to change by voice is said as the
 * difference to that one. In the natural style the card's wording is asked
 * for as soon as it waits and used when it is checked and back in time; the
 * difference reading stays precise.
 */
export function useSpokenApprovalCard({
  chatId,
  messageId,
  approvals,
  keys,
  items = [],
  change,
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
  /** Each approval's id and the one it replaces after a change request. */
  items?: readonly { approvalId: string; replaces: string | null }[];
  /** How an approval is changed by voice, where it can be. */
  change?: (approvalId: string) => VoiceChange | undefined;
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
  const natural = useNaturalApprovalSpeech();
  const approval = approvals[index] as SpokenApproval | undefined;
  const key = `${messageId}:${keys[index] ?? index}`;
  const replaced = items.at(index)?.replaces != null;
  // Whether the card under a key still waits, for a wording that comes back
  // after it was decided.
  const waiting = useRef<string | null>(null);
  waiting.current = active ? key : null;

  // Ask for the natural wording while the model's own words still play.
  useEffect(() => {
    if (!natural || !active || !spokenTurn || !approval || replaced) return;
    if (approvalSpoken(key)) return;
    const options = { language: i18n.locale, now: new Date() };
    void naturalApprovalPieces(
      key,
      messageId,
      spokenApprovalPieces(approval, options),
      options,
    );
  }, [natural, active, spokenTurn, approval, replaced, key, messageId]);

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
    const item = items.at(index);
    const withdrawn =
      item?.replaces != null
        ? takeWithdrawnCard(item.replaces, item.approvalId)
        : undefined;
    const card = {
      key,
      messageId,
      language: options.language,
      pieces: withdrawn
        ? spokenDifference(withdrawn, approval, options).pieces
        : spokenApprovalPieces(approval, options),
      fallback: spokenApprovalPieces({ type: "pointer" }, options),
      approval,
      change: item ? change?.(item.approvalId) : undefined,
    };
    // A stop during the turn's own words means quiet: the card waits to be
    // asked for.
    const say = (pieces: typeof card.pieces) => {
      if (waiting.current !== key || approvalSpoken(key)) return;
      if (quiet) offerApprovalCard({ ...card, pieces });
      else speakApprovalCard({ ...card, pieces });
    };
    if (natural && !withdrawn) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<typeof card.pieces>((resolve) => {
        timer = setTimeout(
          () => resolve(card.pieces),
          NATURAL_WAIT_AT_START_MS,
        );
      });
      void Promise.race([
        naturalApprovalPieces(key, messageId, card.pieces, options),
        late,
      ]).then((pieces) => {
        clearTimeout(timer);
        say(pieces);
      });
    } else {
      say(card.pieces);
    }
  }, [
    active,
    approval,
    approvals,
    change,
    index,
    items,
    key,
    messageId,
    modelSpeaking,
    natural,
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
    if (!active) {
      forgetApprovalCards(cardKeys.split("\n"));
      forgetNaturalApprovals(cardKeys.split("\n"));
    }
  }, [active, cardKeys]);
  useEffect(
    () => () => {
      forgetApprovalCards(cardKeys.split("\n"));
      forgetNaturalApprovals(cardKeys.split("\n"));
    },
    [cardKeys],
  );
}
