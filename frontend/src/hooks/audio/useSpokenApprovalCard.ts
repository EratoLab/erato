import { i18n } from "@lingui/core";
import { useEffect } from "react";

import {
  sameSpokenKind,
  spokenApprovalPieces,
  voiceApprovalOffered,
} from "@/lib/toolCallGist/spokenCard";
import { spokenDifference } from "@/lib/toolCallGist/spokenCardDifference";
import { spokenWordsFor } from "@/lib/toolCallGist/spokenCardWords";

import { takeWithdrawnCard } from "./approvalChanges";
import {
  approvalSpoken,
  forgetApprovalCards,
  offerApprovalCard,
  speakApprovalCard,
} from "./approvalSpeech";
import {
  deploymentConfirmationPhrase,
  deploymentConfirmationPhrases,
} from "./confirmationPhrases";
import { useSpeechPlayback } from "./speechPlayback";
import {
  deploymentNumberWords,
  deploymentSentences,
  deploymentSpokenCardLanguages,
  useSpokenStyle,
} from "./spokenStyle";

import type { VoiceChange, VoiceDecision } from "./approvalChanges";
import type { SpokenApproval } from "@/lib/toolCallGist/spokenCard";
import type { UserTurn } from "@/lib/toolCallGist/spokenDictation";

/**
 * Speaks the approval a card shows when conversational mode reads back and
 * the turn that stopped on it was a spoken one, once the model's own words
 * of that turn have played. Several approvals are spoken one at a time, as
 * the screen shows them. After a stop the card waits to be asked for. A card
 * that corrects one the user asked to change by voice is said as the
 * difference to that one. A long text the user dictated is named as theirs.
 *
 * Returns the key the card on screen is spoken under, and whether its
 * request names the phrase that approves it by voice.
 */
export function useSpokenApprovalCard({
  chatId,
  messageId,
  approvals,
  keys,
  items = [],
  change,
  decide,
  index,
  active,
  responding,
  userTurns,
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
  /** How an approval is decided by voice, where it can be. */
  decide?: (approvalId: string) => Omit<VoiceDecision, "approves"> | undefined;
  /** The one on screen now. */
  index: number;
  /** The card asks for a decision and none is on its way. */
  active: boolean;
  /** The chat is still receiving the turn. */
  responding: boolean;
  /** The user's messages before this card, the latest first, with what of them was dictated. */
  userTurns?: readonly UserTurn[];
}): { key: string; approves: boolean } {
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
  // A reply paused by the user talking over it may still go on.
  const modelSpeaking = useSpeechPlayback(
    (state) => state.playing || state.paused,
  );
  const approval = approvals[index] as SpokenApproval | undefined;
  const key = `${messageId}:${keys[index] ?? index}`;
  const style = useSpokenStyle(spokenTurn);
  const approvalId = items.at(index)?.approvalId;
  // Only a card said in full, in a language with a phrase of its own, names
  // the phrase; any other is approved on screen.
  const approves =
    deploymentConfirmationPhrase(i18n.locale) !== undefined &&
    approvalId !== undefined &&
    decide?.(approvalId) !== undefined &&
    approval !== undefined &&
    spokenWordsFor(i18n.locale, {
      now: new Date(),
      spokenCardLanguages: deploymentSpokenCardLanguages(),
    }).full &&
    voiceApprovalOffered(approval);

  useEffect(() => {
    if (!active || !spokenTurn || modelSpeaking || responding || !approval)
      return;
    if (approvalSpoken(key)) return;
    const total = approvals.length;
    const item = items.at(index);
    const decision = item ? decide?.(item.approvalId) : undefined;
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
      userTurns,
      numberWords: deploymentNumberWords(i18n.locale),
      spokenCardLanguages: deploymentSpokenCardLanguages(),
      voiceApproval: approves,
      confirmationPhrases: deploymentConfirmationPhrases(),
    };
    const withdrawn =
      item?.replaces != null
        ? takeWithdrawnCard(item.replaces, item.approvalId)
        : undefined;
    // The style changes which pieces are held back and the words of
    // details and the opening, never the pieces themselves; the difference
    // reading after a change request stays as it is.
    const styled = {
      ...options,
      ...style,
      sentences: deploymentSentences(options.language),
    };
    const card = {
      key,
      messageId,
      language: options.language,
      pieces: withdrawn
        ? spokenDifference(withdrawn, approval, options).pieces
        : spokenApprovalPieces(approval, styled),
      fallback: spokenApprovalPieces({ type: "pointer" }, options),
      approval,
      change: item ? change?.(item.approvalId) : undefined,
      decision: decision ? { ...decision, approves } : undefined,
    };
    // A stop during the turn's own words means quiet: the card waits to be
    // asked for.
    if (quiet) offerApprovalCard(card);
    else speakApprovalCard(card);
  }, [
    active,
    approval,
    approvals,
    approves,
    change,
    decide,
    index,
    items,
    key,
    messageId,
    modelSpeaking,
    quiet,
    responding,
    spokenTurn,
    style,
    userTurns,
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

  return { key, approves };
}
