import {
  ActionConfirmationCard,
  copyEmailToClipboard,
  sanitizeHtmlPreview,
  useChatContext,
  useOutlookArtifact,
  usePersistedState,
} from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useComposeSelectionSnapshot } from "../hooks/composeSelectionStore";
import { useOutlookMailItem } from "../providers/OutlookMailItemProvider";
import {
  CLIENT_ACTION_DECISIONS_KEY,
  DEFAULT_CLIENT_ACTION_DECISIONS,
  clientActionDecisionsPersistedOptions,
  decisionKey,
  isActionDenied,
  resolveAutoPromptBehavior,
  resolveClickBehavior,
} from "../utils/clientActionPolicy";
import {
  clientActionDisplayLabel,
  offerableClientActions,
  type OutlookClientAction,
} from "../utils/outlookClientActions";
import { replaceComposeSelection } from "../utils/outlookComposeWrite";
import {
  ReplyBodyTooLargeError,
  getReadModeRecipientSummary,
  isReplyFormHostSupported,
  openReplyForm,
  type ReadModeRecipientSummary,
} from "../utils/outlookReadReply";

import type { EratoEmailCodeBlockProps } from "@erato/frontend/library";

const ACTION_BUTTON_CLASS =
  "rounded-md border border-theme-border bg-theme-bg-primary px-3 py-1 text-xs hover:bg-theme-bg-tertiary disabled:opacity-50";
// Mirrors the library Button "primary" variant tokens (Button.tsx) at the
// compact geometry of the sibling action buttons.
const PRIMARY_ACTION_BUTTON_CLASS =
  "rounded-md px-3 py-1 text-xs font-medium bg-theme-action-primary-bg text-theme-action-primary-fg hover:bg-theme-action-primary-hover theme-transition disabled:opacity-50";

/**
 * Auto-prompt fires at most once per assistant message, across remounts
 * (virtualized lists unmount/remount renderers) and across multiple fences
 * within one message. Module-level by design.
 */
const firedAutoPrompts = new Set<string>();

interface ConfirmCardState {
  /**
   * Monotonic per-request id: a new confirmation replaces a resolved card
   * and remounts it (fresh scroll/focus), and an async resolution only
   * lands on the card it was started from.
   */
  requestId: number;
  action: OutlookClientAction;
  recipients: ReadModeRecipientSummary;
  /** Surfaced by auto-prompt (scrolls into view) rather than a click. */
  autoTriggered: boolean;
  /**
   * Item identity when the card opened — the item the shown recipients
   * were read from. Execution re-checks it so confirming a card opened on
   * email A can never open a reply on email B, independent of whether the
   * artifact carries an identity (history drafts don't).
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
 * Office-aware renderer for erato-email code blocks.
 * Registered via componentRegistry in main.tsx so the shared MessageContent
 * delegates to this component when running inside the Outlook addin.
 *
 * Compose mode: action buttons that write back into the Outlook compose body
 * via Office.js setSelectedDataAsync ("Replace Selection" / "Insert at Cursor").
 *
 * Read mode: when the producing facet allows client actions (reply /
 * reply-all from `GET /me/facets`, intersected with the add-in's fixed
 * registry), buttons that open Outlook's native reply form prefilled with the
 * draft. Per-action local approval preferences apply: "deny" hides an action,
 * "always ask" confirms before opening (reply-all is floored here and shows
 * freshly read recipients), "don't ask" opens directly. Under the facet's
 * `auto_prompt` presentation the proposed action may surface immediately —
 * but only after a FRESH assistant completion, never from history, and still
 * subject to the same preferences. Sending always stays a manual user step
 * in Outlook's own compose window.
 */
export function OutlookEratoEmailRenderer({
  content,
  isHtml,
}: EratoEmailCodeBlockProps) {
  // Subscribe to the shared snapshot instead of running an own poll loop —
  // a second poller would fight the input's over the host's serialized
  // item-API slot and re-learn the ERMAIN-431 coercion switch separately.
  const composeSelection = useComposeSelectionSnapshot();
  const hasSelection = composeSelection.data.length > 0;
  const { mailItem, itemIdentity } = useOutlookMailItem();
  const artifact = useOutlookArtifact();
  const isReadMode = !!mailItem && !mailItem.isComposeMode;
  // Identity of the Outlook item open when the user SENT the request that
  // produced this draft (stamped on fresh completions only). When it no
  // longer matches the currently open item, the draft must not open a reply
  // — the user switched emails since. AddinChat only marks a completion
  // fresh when its send-time identity is KNOWN (identity-unknown
  // completions degrade to history-like drafts instead); a fresh completion
  // WITHOUT an identity would mean that invariant broke, so it still fails
  // closed (stale), never unguarded. History(-like) drafts carry no
  // identity and are guarded at confirmation time instead (see
  // `ConfirmCardState.itemIdentityAtOpen`).
  const expectedItemIdentity = artifact?.itemIdentity;
  const isStaleForCurrentItem = artifact?.isFreshCompletion
    ? !expectedItemIdentity || itemIdentity !== expectedItemIdentity
    : !!expectedItemIdentity && itemIdentity !== expectedItemIdentity;
  const [decisions, setDecisions] = usePersistedState(
    CLIENT_ACTION_DECISIONS_KEY,
    DEFAULT_CLIENT_ACTION_DECISIONS,
    clientActionDecisionsPersistedOptions,
  );
  const facetId = artifact?.facetId ?? "";
  const enforcedAskActions = useMemo(
    () => artifact?.alwaysAskClientActions ?? [],
    [artifact],
  );

  const readActions = useMemo<OutlookClientAction[]>(
    () =>
      // Gate on the REACTIVE read-item signal (`isReadMode`, synced to the live
      // item by OutlookMailItemProvider) plus the host-static capability check
      // — NOT the live `isReadReplySupported()`, which reads Office state
      // outside this dep array and could cache an empty result when the item
      // was momentarily unavailable (e.g. a pinned-pane reload), permanently
      // hiding the reply buttons. Execution re-checks the live item in
      // openReplyForm, so offering optimistically here fails closed on click.
      isReadMode && isReplyFormHostSupported()
        ? offerableClientActions(artifact?.allowedClientActions).filter(
            (action) =>
              !isActionDenied({
                facetId,
                action,
                decisions,
                enforcedAskActions,
              }),
          )
        : [],
    [isReadMode, artifact, facetId, decisions, enforcedAskActions],
  );
  const proposedAction =
    artifact?.proposedClientAction &&
    (readActions as string[]).includes(artifact.proposedClientAction)
      ? (artifact.proposedClientAction as OutlookClientAction)
      : undefined;

  const [status, setStatus] = useState<
    "idle" | "inserting" | "done" | "copied" | "error"
  >("idle");
  const [errorKind, setErrorKind] = useState<
    "insert" | "reply" | "tooLarge" | "staleItem"
  >("insert");
  const [busyAction, setBusyAction] = useState<OutlookClientAction | null>(
    null,
  );
  const [confirmCard, setConfirmCard] = useState<ConfirmCardState | null>(null);
  const confirmRequestIdRef = useRef(0);
  const isBusy = status === "inserting";
  const isConfirmPending = confirmCard?.resolution === "pending";
  const previewHtml = useMemo(
    () => (isHtml ? sanitizeHtmlPreview(content) : null),
    [content, isHtml],
  );

  // Single pending status-reset timer: a new schedule cancels the previous
  // one (a stale 2s success timer must not clear a newer 4s error early),
  // and unmount cancels outright.
  const statusResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleStatusReset = useCallback((delayMs: number) => {
    if (statusResetRef.current) {
      clearTimeout(statusResetRef.current);
    }
    statusResetRef.current = setTimeout(() => setStatus("idle"), delayMs);
  }, []);
  useEffect(
    () => () => {
      if (statusResetRef.current) {
        clearTimeout(statusResetRef.current);
      }
    },
    [],
  );

  const showError = useCallback(
    (kind: "insert" | "reply" | "tooLarge" | "staleItem", delayMs: number) => {
      setErrorKind(kind);
      setStatus("error");
      scheduleStatusReset(delayMs);
    },
    [scheduleStatusReset],
  );

  const handleInsert = useCallback(async () => {
    setStatus("inserting");
    try {
      await replaceComposeSelection(content, isHtml);
      setStatus("done");
      scheduleStatusReset(2000);
    } catch (err) {
      console.warn("Failed to insert into compose body:", err);
      showError("insert", 2000);
    }
  }, [content, isHtml, scheduleStatusReset, showError]);

  /** Resolves `true` only when the reply form actually opened. */
  const executeReply = useCallback(
    async (
      action: OutlookClientAction,
      /**
       * Identity snapshotted when the confirmation card opened. `undefined`
       * for direct (card-less) executions; when provided it must still match
       * the live item — the user may have switched emails while the card
       * was open.
       */
      confirmedItemIdentity?: string | null,
    ): Promise<boolean> => {
      if (isStaleForCurrentItem) {
        showError("staleItem", 4000);
        return false;
      }
      if (
        confirmedItemIdentity !== undefined &&
        confirmedItemIdentity !== itemIdentity
      ) {
        showError("staleItem", 4000);
        return false;
      }
      setBusyAction(action);
      setStatus("inserting");
      try {
        await openReplyForm(action, content, !!isHtml);
        setStatus("done");
        scheduleStatusReset(2000);
        return true;
      } catch (err) {
        console.warn("Failed to open reply form:", err);
        showError(
          err instanceof ReplyBodyTooLargeError ? "tooLarge" : "reply",
          4000,
        );
        return false;
      } finally {
        setBusyAction(null);
      }
    },
    [
      content,
      isHtml,
      isStaleForCurrentItem,
      itemIdentity,
      scheduleStatusReset,
      showError,
    ],
  );

  // Open the inline confirmation card with recipients RE-READ from the
  // current item — the user confirms against fresh data, not against
  // whatever the chat message was generated from. Replaces a resolved card.
  const requestConfirmation = useCallback(
    (action: OutlookClientAction, autoTriggered = false): boolean => {
      const recipients = getReadModeRecipientSummary();
      if (!recipients) {
        return false;
      }
      confirmRequestIdRef.current += 1;
      setConfirmCard({
        requestId: confirmRequestIdRef.current,
        action,
        recipients,
        autoTriggered,
        itemIdentityAtOpen: itemIdentity,
        resolution: "pending",
      });
      return true;
    },
    [itemIdentity],
  );

  // Allow paths: execute, then resolve THIS card into its record state — a
  // newer confirmation may have replaced it while the form was opening.
  const handleCardAllow = useCallback(
    (card: ConfirmCardState) => {
      void executeReply(card.action, card.itemIdentityAtOpen).then((opened) => {
        setConfirmCard((current) =>
          current?.requestId === card.requestId
            ? { ...current, resolution: opened ? "opened" : "failed" }
            : current,
        );
      });
    },
    [executeReply],
  );

  const handleReplyAction = useCallback(
    (action: OutlookClientAction) => {
      if (isStaleForCurrentItem) {
        // Don't open a confirmation that would show the NEW email's
        // recipients for a draft written against the old one.
        showError("staleItem", 4000);
        return;
      }
      if (
        resolveClickBehavior({
          facetId,
          action,
          decisions,
          enforcedAskActions,
        }) === "execute"
      ) {
        void executeReply(action);
        return;
      }
      if (!requestConfirmation(action)) {
        showError("reply", 4000);
      }
    },
    [
      decisions,
      enforcedAskActions,
      executeReply,
      facetId,
      isStaleForCurrentItem,
      requestConfirmation,
      showError,
    ],
  );

  // Auto-prompt: only under the facet's `auto_prompt` presentation, only for
  // a validated proposal on a FRESH completion (stamped by AddinChat — never
  // history reloads) that is still the latest assistant message and whose
  // send-time item is still the open one, at most once per message, and
  // still through the user's approval preference ("don't ask" opens the
  // form, "ask" surfaces the inline confirmation card). If the user
  // meanwhile left read mode, requestConfirmation returns false and nothing
  // happens — the buttons remain as fallback.
  const { messages, messageOrder } = useChatContext();
  const autoPromptMessageId = artifact?.messageId;
  const isFreshCompletion = !!artifact?.isFreshCompletion;
  const isLatestAssistantMessage = useMemo(() => {
    if (!autoPromptMessageId) {
      return false;
    }
    for (let index = messageOrder.length - 1; index >= 0; index -= 1) {
      const id = messageOrder[index];
      if (messages[id]?.role === "assistant") {
        return id === autoPromptMessageId;
      }
    }
    return false;
  }, [autoPromptMessageId, messages, messageOrder]);
  const autoPromptBehavior = resolveAutoPromptBehavior({
    presentation: artifact?.clientActionPresentation,
    facetId: artifact?.facetId,
    proposedAction,
    isFreshCompletion,
    isLatestAssistantMessage,
    expectedItemIdentity,
    currentItemIdentity: itemIdentity,
    decisions,
    enforcedAskActions,
  });
  useEffect(() => {
    if (!autoPromptMessageId || !isFreshCompletion) {
      return;
    }
    if (firedAutoPrompts.has(autoPromptMessageId)) {
      return;
    }
    // Consume the once-per-message slot on the FIRST evaluation for a fresh
    // completion, regardless of the resolved behavior: a later settings flip
    // (never → always allow) or a much later scroll-back mount must not
    // resurrect the prompt. The failure direction is always a missed
    // auto-open, never a late one — the buttons remain as fallback.
    firedAutoPrompts.add(autoPromptMessageId);
    if (autoPromptBehavior === "none" || !proposedAction) {
      return;
    }
    if (autoPromptBehavior === "execute") {
      void executeReply(proposedAction);
    } else {
      requestConfirmation(proposedAction, true);
    }
  }, [
    autoPromptBehavior,
    autoPromptMessageId,
    isFreshCompletion,
    proposedAction,
    executeReply,
    requestConfirmation,
  ]);

  const handleCopy = useCallback(() => {
    void copyEmailToClipboard(content, isHtml ?? false)
      .then(() => {
        setStatus("copied");
        scheduleStatusReset(2000);
      })
      .catch(() => {
        // ignore clipboard errors
      });
  }, [content, isHtml, scheduleStatusReset]);

  const insertLabel = (() => {
    if (status === "done")
      return t({
        id: "officeAddin.emailRenderer.done",
        message: "Done!",
      });
    if (status === "inserting")
      return t({
        id: "officeAddin.emailRenderer.inserting",
        message: "Inserting...",
      });
    return hasSelection
      ? t({
          id: "officeAddin.emailRenderer.replaceSelection",
          message: "Replace Selection",
        })
      : t({
          id: "officeAddin.emailRenderer.insertAtCursor",
          message: "Insert at Cursor",
        });
  })();

  const replyActionLabel = (action: OutlookClientAction) =>
    action === "outlook.reply_all"
      ? t({
          id: "officeAddin.emailRenderer.replyAll",
          message: "Reply All",
        })
      : t({
          id: "officeAddin.emailRenderer.reply",
          message: "Reply",
        });

  const showReadReplyActions = isReadMode && readActions.length > 0;
  // Proposed action first (primary), then the remaining offerable actions.
  const orderedReadActions = proposedAction
    ? [
        proposedAction,
        ...readActions.filter((action) => action !== proposedAction),
      ]
    : readActions;

  const isConfirmingReplyAll = confirmCard?.action === "outlook.reply_all";
  // The confirmation copy's count is BY CONSTRUCTION the number of entries
  // the card lists — never a separately computed number that could drift.
  const confirmListedEntries = confirmCard
    ? [
        ...(confirmCard.recipients.sender
          ? [confirmCard.recipients.sender]
          : []),
        ...(isConfirmingReplyAll ? confirmCard.recipients.recipients : []),
      ]
    : [];
  const confirmRecipientCount = confirmListedEntries.length;

  return (
    <div className="my-2 rounded-lg border border-theme-border bg-theme-bg-secondary p-3">
      {isHtml ? (
        <div
          className="mb-2 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-theme-border [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
          // Sanitized with DOMPurify before rendering.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: previewHtml ?? "" }}
        />
      ) : (
        <div className="mb-2 whitespace-pre-wrap text-sm">{content}</div>
      )}
      <div className="flex gap-2">
        {showReadReplyActions
          ? orderedReadActions.map((action, index) => (
              <button
                key={action}
                type="button"
                onClick={() => handleReplyAction(action)}
                disabled={isBusy || isConfirmPending}
                className={
                  index === 0 && proposedAction
                    ? PRIMARY_ACTION_BUTTON_CLASS
                    : ACTION_BUTTON_CLASS
                }
              >
                {busyAction === action
                  ? t({
                      id: "officeAddin.emailRenderer.opening",
                      message: "Opening...",
                    })
                  : replyActionLabel(action)}
              </button>
            ))
          : !isReadMode && (
              <button
                type="button"
                onClick={() => void handleInsert()}
                disabled={isBusy}
                className={ACTION_BUTTON_CLASS}
              >
                {insertLabel}
              </button>
            )}
        <button
          type="button"
          onClick={handleCopy}
          disabled={isBusy}
          className={ACTION_BUTTON_CLASS}
        >
          {status === "copied"
            ? t({
                id: "officeAddin.emailRenderer.copied",
                message: "Copied!",
              })
            : t({
                id: "officeAddin.emailRenderer.copy",
                message: "Copy",
              })}
        </button>
      </div>
      {status === "error" && (
        <p role="alert" className="mt-1 text-xs text-theme-error-fg">
          {errorKind === "tooLarge"
            ? t({
                id: "officeAddin.emailRenderer.replyTooLarge",
                message:
                  "Draft is too large to prefill a reply. Use Copy and paste it into a reply instead.",
              })
            : errorKind === "staleItem"
              ? t({
                  id: "officeAddin.emailRenderer.replyStaleItem",
                  message:
                    "This draft was written for a different email. Open that email again, or use Copy.",
                })
              : errorKind === "reply"
                ? t({
                    id: "officeAddin.emailRenderer.replyFailed",
                    message:
                      "Failed to open the reply form. Make sure the received email is still open, or use Copy.",
                  })
                : t({
                    id: "officeAddin.emailRenderer.insertFailed",
                    message: "Failed to insert into compose body.",
                  })}
        </p>
      )}
      {confirmCard && (
        <ActionConfirmationCard
          // Keyed per request: a replacement card remounts so the mount-only
          // scroll/focus behavior applies to the new confirmation.
          key={confirmCard.requestId}
          description={
            <div className="space-y-2 text-sm text-theme-fg-secondary">
              <p className="font-medium text-theme-fg-primary">
                {clientActionDisplayLabel(confirmCard.action)}
              </p>
              <p>
                {isConfirmingReplyAll
                  ? t({
                      id: "officeAddin.emailRenderer.replyAllConfirmMessage",
                      message: plural(confirmRecipientCount, {
                        one: "This opens a reply addressed to # person from the email you are reading. Nothing is sent until you press Send in Outlook.",
                        other:
                          "This opens a reply addressed to # people from the email you are reading. Nothing is sent until you press Send in Outlook.",
                      }),
                    })
                  : t({
                      id: "officeAddin.emailRenderer.replyConfirmMessage",
                      message:
                        "This opens a prefilled reply to the sender of the email you are reading. Nothing is sent until you press Send in Outlook.",
                    })}
              </p>
              <p className="break-words text-xs">
                {confirmListedEntries.join(", ")}
              </p>
            </div>
          }
          onAllowOnce={() => handleCardAllow(confirmCard)}
          onAlwaysAllow={() => {
            // Persist the grant for THIS facet + action, then execute. The
            // store is the source the settings page mirrors and revises.
            setDecisions({
              ...decisions,
              [decisionKey(facetId, confirmCard.action)]: "always",
            });
            handleCardAllow(confirmCard);
          }}
          alwaysAllowDisabledReason={
            enforcedAskActions.includes(confirmCard.action)
              ? t({
                  id: "officeAddin.emailRenderer.alwaysAllowLocked",
                  message:
                    "Your organization requires confirmation for this action every time.",
                })
              : undefined
          }
          onDeny={() =>
            setConfirmCard((current) =>
              current?.requestId === confirmCard.requestId
                ? { ...current, resolution: "denied" }
                : current,
            )
          }
          status={
            confirmCard.resolution === "pending"
              ? "pending"
              : confirmCard.resolution === "opened"
                ? "confirmed"
                : "dismissed"
          }
          resolvedLabel={
            confirmCard.resolution === "opened"
              ? confirmCard.action === "outlook.reply_all"
                ? t({
                    id: "officeAddin.emailRenderer.replyAllFormOpened",
                    message: "Reply All form opened",
                  })
                : t({
                    id: "officeAddin.emailRenderer.replyFormOpened",
                    message: "Reply form opened",
                  })
              : confirmCard.resolution === "failed"
                ? t({
                    id: "officeAddin.emailRenderer.replyFormNotOpened",
                    message: "Reply form could not be opened",
                  })
                : undefined
          }
          isBusy={isBusy}
          scrollIntoViewOnMount={confirmCard.autoTriggered}
        />
      )}
    </div>
  );
}
