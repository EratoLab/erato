import { useChatContext } from "@erato/frontend/library";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveAutoPromptBehavior } from "../utils/clientActionPolicy";

import type { ClientActionDecisionMap } from "../utils/clientActionPolicy";
import type { OutlookClientAction } from "../utils/outlookClientActions";

/**
 * Auto-prompt fires at most once per assistant message PER SCOPE, across
 * remounts (virtualized lists unmount/remount renderers) and across multiple
 * fences within one message. Module-level by design. Scoped so the email and
 * appointment renderers own independent slots: one renderer consuming its
 * slot (even resolving to "none") must not suppress the other's prompt for
 * the same message.
 */
const firedAutoPrompts = new Set<string>();

export interface ConfirmCardState<
  TSummary,
  TAction extends OutlookClientAction = OutlookClientAction,
> {
  /**
   * Monotonic per-request id: a new confirmation replaces a resolved card
   * and remounts it (fresh scroll/focus), and an async resolution only
   * lands on the card it was started from.
   */
  requestId: number;
  action: TAction;
  /**
   * The renderer-specific payload the user confirms against, snapshotted
   * when the card opened (reply: freshly re-read recipients; appointment:
   * the parsed fence details).
   */
  summary: TSummary;
  /** Surfaced by auto-prompt (scrolls into view) rather than a click. */
  autoTriggered: boolean;
  /**
   * Item identity when the card opened. Executors whose action is bound to
   * the open item re-check it so confirming a card opened on email A can
   * never act on email B; item-independent executors ignore it.
   */
  itemIdentityAtOpen: string | null;
  /**
   * `pending` renders the decision buttons; afterwards the card stays
   * mounted as a visible record of the outcome (allow → `opened` or
   * `failed`, deny → `denied`).
   */
  resolution: "pending" | "opened" | "denied" | "failed";
}

/**
 * The confirm-card state machine + auto-prompt one-shot shared by the client
 * action renderers. The renderer supplies what differs: how to snapshot the
 * confirmation summary, how to execute the action, and the card's copy —
 * everything about WHEN a card may open, replace, resolve, or auto-surface is
 * identical by construction.
 */
export function useClientActionConfirmFlow<
  TSummary,
  TAction extends OutlookClientAction = OutlookClientAction,
>(args: {
  /** Namespaces the once-per-message auto-prompt slot (e.g. `"email"`). */
  promptScope: string;
  facetId: string | undefined;
  decisions: ClientActionDecisionMap;
  enforcedAskActions: readonly string[];
  /**
   * Snapshot the confirmation payload for the card. Returning `null` aborts
   * opening the card (e.g. the read-mode item disappeared).
   */
  buildSummary: (action: TAction) => TSummary | null;
  /**
   * Execute the action; resolves `true` only when the form actually opened.
   * `itemIdentityAtOpen` is the card's snapshot for card-driven executions
   * and `undefined` for direct (card-less) ones.
   */
  execute: (
    action: TAction,
    itemIdentityAtOpen?: string | null,
  ) => Promise<boolean>;
  /** Live item identity, snapshotted onto the card when it opens. */
  itemIdentity: string | null;
  /** The producing facet's presentation (`auto_prompt` enables the one-shot). */
  presentation: string | undefined;
  messageId: string | undefined;
  isFreshCompletion: boolean;
  proposedAction: TAction | undefined;
  /** Send-time item identity stamped on the artifact, if capture succeeded. */
  expectedItemIdentity: string | null | undefined;
  /**
   * Identity of the currently open item AS THE EXECUTOR BINDS IT — the email
   * renderer passes the raw live identity (a reply is item-bound), the
   * appointment renderer normalizes null to its no-item sentinel (creating
   * an appointment is item-independent).
   */
  currentItemIdentity: string | null | undefined;
}) {
  const { buildSummary, execute, itemIdentity } = args;
  const [confirmCard, setConfirmCard] = useState<ConfirmCardState<
    TSummary,
    TAction
  > | null>(null);
  const confirmRequestIdRef = useRef(0);

  // Open the inline confirmation card with a summary snapshotted NOW — the
  // user confirms against fresh data, not against whatever the chat message
  // was generated from. Replaces a resolved card.
  const requestConfirmation = useCallback(
    (action: TAction, autoTriggered = false): boolean => {
      const summary = buildSummary(action);
      if (summary === null) {
        return false;
      }
      confirmRequestIdRef.current += 1;
      setConfirmCard({
        requestId: confirmRequestIdRef.current,
        action,
        summary,
        autoTriggered,
        itemIdentityAtOpen: itemIdentity,
        resolution: "pending",
      });
      return true;
    },
    [buildSummary, itemIdentity],
  );

  // Allow paths: execute, then resolve THIS card into its record state — a
  // newer confirmation may have replaced it while the form was opening.
  const allowCard = useCallback(
    (card: ConfirmCardState<TSummary, TAction>) => {
      void execute(card.action, card.itemIdentityAtOpen).then((opened) => {
        setConfirmCard((current) =>
          current?.requestId === card.requestId
            ? { ...current, resolution: opened ? "opened" : "failed" }
            : current,
        );
      });
    },
    [execute],
  );

  const denyCard = useCallback((card: ConfirmCardState<TSummary, TAction>) => {
    setConfirmCard((current) =>
      current?.requestId === card.requestId
        ? { ...current, resolution: "denied" }
        : current,
    );
  }, []);

  // Auto-prompt: only under the facet's `auto_prompt` presentation, only for
  // a validated proposal on a FRESH completion (stamped by AddinChat — never
  // history reloads) that is still the latest assistant message and whose
  // send-time context still matches, at most once per message and scope, and
  // still through the user's approval preference ("don't ask" opens the
  // form, "ask" surfaces the inline confirmation card). If the summary can't
  // be snapshotted, requestConfirmation returns false and nothing happens —
  // the buttons remain as fallback.
  const { messages, messageOrder } = useChatContext();
  const isLatestAssistantMessage = useMemo(() => {
    if (!args.messageId) {
      return false;
    }
    for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
      const id = messageOrder[index];
      if (messages[id]?.role === "assistant") {
        return id === args.messageId;
      }
    }
    return false;
  }, [args.messageId, messages, messageOrder]);
  const autoPromptBehavior = resolveAutoPromptBehavior({
    presentation: args.presentation,
    facetId: args.facetId,
    proposedAction: args.proposedAction,
    isFreshCompletion: args.isFreshCompletion,
    isLatestAssistantMessage,
    expectedItemIdentity: args.expectedItemIdentity,
    currentItemIdentity: args.currentItemIdentity,
    decisions: args.decisions,
    enforcedAskActions: args.enforcedAskActions,
  });
  const { promptScope, messageId, isFreshCompletion, proposedAction } = args;
  useEffect(() => {
    if (!messageId || !isFreshCompletion) {
      return;
    }
    const promptKey = `${promptScope}:${messageId}`;
    if (firedAutoPrompts.has(promptKey)) {
      return;
    }
    // Consume the once-per-message slot on the FIRST evaluation for a fresh
    // completion, regardless of the resolved behavior: a later settings flip
    // (never → always allow) or a much later scroll-back mount must not
    // resurrect the prompt. The failure direction is always a missed
    // auto-open, never a late one — the buttons remain as fallback.
    firedAutoPrompts.add(promptKey);
    if (autoPromptBehavior === "none" || !proposedAction) {
      return;
    }
    if (autoPromptBehavior === "execute") {
      void execute(proposedAction);
    } else {
      requestConfirmation(proposedAction, true);
    }
  }, [
    autoPromptBehavior,
    promptScope,
    messageId,
    isFreshCompletion,
    proposedAction,
    execute,
    requestConfirmation,
  ]);

  return {
    confirmCard,
    isConfirmPending: confirmCard?.resolution === "pending",
    requestConfirmation,
    allowCard,
    denyCard,
  };
}
