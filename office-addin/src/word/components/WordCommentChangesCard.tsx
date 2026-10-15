import {
  ActionConfirmationCard,
  Alert,
  Button,
  Card,
  extractTextFromContent,
  useChatContext,
  useHostArtifact,
  useProfile,
  WordReviewCard,
  WordReviewGenerating,
  WordReviewHeader,
  wordShowInWordLabel,
} from "@erato/frontend/library";
import { WORD_COMMENT_OP_META } from "@erato/frontend/word-review";
import { plural, t } from "@lingui/core/macro";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import {
  wordBlockedReasonText,
  wordCommentTaintText,
} from "./WordReviewCardParts";
import { useClientActionConfirmFlow } from "../../core/clientActions/useClientActionConfirmFlow";
import { useClientActionDecisions } from "../../core/clientActions/useClientActionDecisions";
import { useWordReviewFocus } from "../hooks/useWordReviewFocus";
import { useWordWrite } from "../providers/WordWriteProvider";
import {
  decisionKey,
  grantClientActionForSession,
  isActionDenied,
  scopedDecisions,
  wordClientActionDecisionStore,
} from "../utils/clientActionPolicy";
import {
  recordWordCommentOutcome,
  wordCommentAlwaysBlock,
  wordCommentAuthorPlan,
  wordCommentCardMode,
  wordCommentOutcomeRecord,
  wordCommentRowReversible,
} from "../utils/wordCommentCard";
import { wordCommentDeploymentSettings } from "../utils/wordCommentPolicy";
import { wordCommentTaintedMessage } from "../utils/wordCommentReadTool";
import {
  showWordComment,
  showWordCommentTarget,
} from "../utils/wordCommentShow";
import { wordCommentDraft } from "../utils/wordCommentSubmission";
import { revertWordCommentRows } from "../utils/wordCommentWrites";
import { readWordTrackingMode } from "../utils/wordReviewLocation";
import { EMPTY_WORD_REVIEW } from "../utils/wordReviewState";
import { resolveWordWriteGate } from "../utils/wordWriteGate";

import type {
  WordClientAction,
  WordClientActionEntry,
} from "../utils/wordClientActions";
import type {
  WordCommentAlwaysBlock,
  WordCommentUserModeReason,
} from "../utils/wordCommentCard";
import type {
  WordCommentDraft,
  WordCommentDraftRow,
} from "../utils/wordCommentChanges";
import type { WordCommentsCapture } from "../utils/wordCommentSend";
import type { WordCommentRowResult } from "../utils/wordCommentWrites";
import type { WordTrackingMode } from "../utils/wordReviewLocation";
import type { WordCommentCardState } from "../utils/wordReviewState";
import type {
  WordCommentConsentKind,
  WordCommentRowStatus,
} from "@erato/frontend/word-review";

const EXCERPT = 80;

const excerpt = (text: string) =>
  text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text;

function titleOf(draft: WordCommentDraft): string {
  const n = draft.rows.length;
  switch (draft.action) {
    case "word.add_comments":
      return t({
        id: "officeAddin.word.comments.title.add",
        message: plural(n, { one: "Add a comment", other: "Add # comments" }),
      });
    case "word.respond_to_comments":
      return t({
        id: "officeAddin.word.comments.title.respond",
        message: "Reply to, resolve or reopen comments",
      });
    case "word.modify_comments":
      return t({
        id: "officeAddin.word.comments.title.modify",
        message: "Edit or delete comments",
      });
  }
}

function verbOf(row: WordCommentDraftRow): string {
  switch (row.op) {
    case "add":
      return row.add?.kind === "selection"
        ? t({
            id: "officeAddin.word.comments.verb.addSelection",
            message: "Comment on your selection",
          })
        : t({
            id: "officeAddin.word.comments.verb.add",
            message: "Comment on",
          });
    case "reply":
      return row.dependsOn !== undefined
        ? t({
            id: "officeAddin.word.comments.verb.replyAfterReopen",
            message: "Reopen the thread, then reply",
          })
        : t({
            id: "officeAddin.word.comments.verb.reply",
            message: "Reply at the end of the thread",
          });
    case "resolve":
      return t({
        id: "officeAddin.word.comments.verb.resolve",
        message: "Mark the thread as resolved",
      });
    case "reopen":
      return t({
        id: "officeAddin.word.comments.verb.reopen",
        message: "Reopen the thread",
      });
    case "edit":
      return row.entry?.n
        ? t({
            id: "officeAddin.word.comments.verb.editReply",
            message: "Change the text of a reply",
          })
        : t({
            id: "officeAddin.word.comments.verb.editComment",
            message: "Change the text of a comment",
          });
    case "delete":
      return row.entry?.n
        ? t({
            id: "officeAddin.word.comments.verb.deleteReply",
            message: "Delete a reply",
          })
        : t({
            id: "officeAddin.word.comments.verb.deleteThread",
            message: "Delete the whole thread",
          });
  }
}

function userModeText(reason: WordCommentUserModeReason): string {
  switch (reason) {
    case "web":
      return t({
        id: "officeAddin.word.comments.userMode.web",
        message:
          "Posted under your name with the label: Erato as the author is not available in Word for the web yet.",
      });
    case "unavailable":
      return t({
        id: "officeAddin.word.comments.userMode.unavailable",
        message:
          "Posted under your name with the label: Erato as the author is not available right now.",
      });
    case "tracking":
      return t({
        id: "officeAddin.word.comments.userMode.tracking",
        message:
          "Posted under your name with the label, because Track Changes is on.",
      });
    case "anchor":
      return t({
        id: "officeAddin.word.comments.userMode.anchor",
        message:
          "Posted under your name with the label, because the comment spans several paragraphs.",
      });
    case "no-name":
      return t({
        id: "officeAddin.word.comments.userMode.noName",
        message:
          "Posted under your name with the label, because your Erato account has no display name.",
      });
  }
}

function alwaysBlockText(
  block: WordCommentAlwaysBlock | "organization",
): string {
  switch (block) {
    case "tainted":
      return wordCommentTaintText();
    case "empty-label":
      return t({
        id: "officeAddin.word.comments.always.emptyLabel",
        message: "Comments carry no AI label here, so Erato asks each time.",
      });
    case "organization":
      return t({
        id: "officeAddin.word.card.alwaysAllowLocked",
        message:
          "Your organization requires confirmation each time this action runs automatically.",
      });
  }
}

function statusText(row: WordCommentRowResult): string {
  const byStatus: Record<WordCommentRowStatus, string> = {
    applied: t({
      id: "officeAddin.word.comments.status.applied",
      message: "Done",
    }),
    applied_as_user: t({
      id: "officeAddin.word.comments.status.appliedAsUser",
      message: "Posted under your name with the label",
    }),
    unchanged: t({
      id: "officeAddin.word.comments.status.unchanged",
      message: "Already so; nothing changed",
    }),
    refused: t({
      id: "officeAddin.word.comments.status.refused",
      message: "Not written",
    }),
    failed: t({
      id: "officeAddin.word.comments.status.failed",
      message: "Not written: Word did not take it",
    }),
    unverified: t({
      id: "officeAddin.word.comments.status.unverified",
      message:
        "Written, but not confirmed. Check the document before trying again.",
    }),
  };
  const reason = row.code ? codeText(row.code) : null;
  return reason ? `${byStatus[row.status]} — ${reason}` : byStatus[row.status];
}

function codeText(code: string): string | null {
  switch (code) {
    case "DESELECTED":
      return t({
        id: "officeAddin.word.comments.code.deselected",
        message: "you left it out",
      });
    case "THREAD_NOT_FOUND":
    case "REPLY_NOT_FOUND":
      return t({
        id: "officeAddin.word.comments.code.gone",
        message: "it is no longer in the document",
      });
    case "THREAD_AMBIGUOUS":
      return t({
        id: "officeAddin.word.comments.code.ambiguous",
        message: "Word lists it twice",
      });
    case "THREAD_CHANGED":
      return t({
        id: "officeAddin.word.comments.code.changed",
        message: "its text changed since your request",
      });
    case "NEW_ACTIVITY":
      return t({
        id: "officeAddin.word.comments.code.newActivity",
        message: "someone replied since your request",
      });
    case "STATE_CHANGED":
      return t({
        id: "officeAddin.word.comments.code.stateChanged",
        message: "someone resolved or reopened it since your request",
      });
    case "TARGET_TEXT_MISMATCH":
    case "TARGET_NOT_FOUND":
    case "TARGET_RANGE_UNPROVEN":
      return t({
        id: "officeAddin.word.comments.code.passageChanged",
        message: "the passage changed since your request",
      });
    case "AMBIGUOUS_TARGET":
      return t({
        id: "officeAddin.word.comments.code.passageAmbiguous",
        message: "the passage occurs more than once now",
      });
    case "DOCUMENT_READ_ONLY":
      return t({
        id: "officeAddin.word.comments.code.readOnly",
        message: "the document is protected",
      });
    case "HOST_NOT_ALLOWED":
      return t({
        id: "officeAddin.word.comments.code.notAllowed",
        message: "Word does not allow it here",
      });
    case "DEPENDENCY_NOT_MET":
      return t({
        id: "officeAddin.word.comments.code.dependency",
        message: "the step before it was not done",
      });
    case "AUTHOR_MODE_UNAVAILABLE":
      return t({
        id: "officeAddin.word.comments.code.authorMode",
        message: "Erato could not be shown as the author",
      });
    case "HIDDEN_TEXT":
      return t({
        id: "officeAddin.word.comments.code.hiddenText",
        message:
          "Word for the web could reveal hidden text in its paragraph; use Word for Windows or Mac",
      });
    default:
      return null;
  }
}

/** Whom Word shows, and what that means for co-authors (contract §9.4, O-28). */
function attributionOf(
  row: WordCommentDraftRow,
  draft: WordCommentDraft,
  input: {
    userName: string | null;
    principalEmail: string | null;
    authorName: string | null;
    userMode: boolean;
  },
): string {
  const you = input.userName
    ? t({
        id: "officeAddin.word.comments.attribution.youNamed",
        message: `you (${input.userName})`,
      })
    : t({ id: "officeAddin.word.comments.attribution.you", message: "you" });
  if (row.op === "add" && input.authorName && !input.userMode)
    return t({
      id: "officeAddin.word.comments.attribution.assistant",
      message: `Word will show this as written by ${input.authorName}.`,
    });
  if (row.op === "resolve" || row.op === "reopen")
    return t({
      id: "officeAddin.word.comments.attribution.state",
      message: `Word shows this as done by ${you}; co-authors won't see that Erato did it.`,
    });
  if (row.op === "delete")
    return t({
      id: "officeAddin.word.comments.attribution.delete",
      message:
        "Word keeps no trace of who deleted it. Erato cannot undo a delete.",
    });
  if (row.op === "edit") {
    const { author, email } = row.entry!.fingerprint;
    return !isOwn(email, input.principalEmail)
      ? t({
          id: "officeAddin.word.comments.attribution.editOther",
          message: `Changes text Word shows as written by ${author}.`,
        })
      : t({
          id: "officeAddin.word.comments.attribution.editOwn",
          message: "Word keeps showing you as the author.",
        });
  }
  return row.labelled
    ? t({
        id: "officeAddin.word.comments.attribution.userLabelled",
        message: `Word will show this as written by ${you}. It starts with "${draft.label}".`,
      })
    : t({
        id: "officeAddin.word.comments.attribution.user",
        message: `Word will show this as written by ${you}.`,
      });
}

const replyAuthors = (replies: readonly { author: string }[]) =>
  [...new Set(replies.map((reply) => reply.author))].join(", ");

const isOwn = (email: string | null, principal: string | null) =>
  !!email &&
  !!principal &&
  email.trim().toLowerCase() === principal.trim().toLowerCase();

export function WordCommentChangesCard({
  entry,
  content,
}: {
  entry: WordClientActionEntry;
  content: string;
}) {
  const artifact = useHostArtifact();
  const {
    documentIdentity,
    capturesByAssistantMessageId,
    reviews,
    updateReview,
    operationInProgress,
    beginOperation,
    endOperation,
    holdOperationUntil,
    restoreRequest,
  } = useWordWrite();
  const [storedDecisions, setDecisions] = useClientActionDecisions(
    wordClientActionDecisionStore,
  );
  const { profile } = useProfile();
  const { messages } = useChatContext();
  const facetId = artifact?.facetId ?? "";
  const messageId = artifact?.messageId;
  // O-25: a deployment may keep "Always" for adds to this pane session and document.
  const grantScope =
    artifact?.clientActionGrantScopes?.[entry.action] === "session_document"
      ? ("session_document" as const)
      : ("device" as const);
  const decisions = scopedDecisions(storedDecisions, {
    facetId,
    action: entry.action,
    scope: grantScope,
    identity: documentIdentity,
  });
  const message = messageId ? messages[messageId] : undefined;
  const isGenerating = message?.status === "sending";
  const draft = wordCommentDraft(content);
  const batchKey = `${messageId ?? ""}:${entry.action}:${content}`;
  const review = reviews.get(batchKey) ?? EMPTY_WORD_REVIEW;
  const cardRef = useWordReviewFocus(review.status);
  const detailsId = useId();
  const capture: WordCommentsCapture | undefined =
    (messageId ? capturesByAssistantMessageId.get(messageId) : undefined) ??
    review.capture;
  const gate = resolveWordWriteGate({
    capture,
    expectedIdentity: artifact?.itemIdentity,
    currentIdentity: documentIdentity,
  });
  const [tracking, setTracking] = useState<WordTrackingMode>("unknown");
  const [note, setNote] = useState("");
  const [revertConfirmation, setRevertConfirmation] = useState(false);
  useEffect(() => {
    let active = true;
    if (gate.allowed && !isGenerating && draft?.action === "word.add_comments")
      void readWordTrackingMode().then((mode) => {
        if (active) setTracking(mode);
      });
    return () => {
      active = false;
    };
  }, [gate.allowed, isGenerating, draft?.action, documentIdentity]);

  const settings = wordCommentDeploymentSettings();
  const plan = useMemo(
    () =>
      draft
        ? wordCommentAuthorPlan(draft, {
            host: draft.host,
            tracking,
            principalName: profile?.name,
            template: settings.assistantAuthor,
          })
        : { authorName: null, userModeRows: new Map() },
    [draft, tracking, profile?.name, settings.assistantAuthor],
  );
  const tainted =
    !!capture?.commentTaint || wordCommentTaintedMessage(messageId);
  const alwaysBlock = draft ? wordCommentAlwaysBlock(draft, tainted) : null;
  const configuredAsk = useMemo(
    () => artifact?.alwaysAskClientActions ?? [],
    [artifact],
  );
  const enforcedAskActions = useMemo(
    () => (alwaysBlock ? [...configuredAsk, entry.action] : configuredAsk),
    [alwaysBlock, configuredAsk, entry.action],
  );
  const cardState = useMemo<WordCommentCardState>(
    () =>
      review.comments ?? {
        selected: draft?.rows.map((row) => row.i) ?? [],
        rows: [],
      },
    [review.comments, draft],
  );
  const mode = draft ? wordCommentCardMode(draft) : "copy";
  const offered =
    !!draft &&
    mode === "post" &&
    (artifact?.allowedClientActions ?? []).includes(entry.action) &&
    !isActionDenied({
      facetId,
      action: entry.action,
      decisions,
      enforcedAskActions,
    });
  const proposedAction =
    offered && artifact?.proposedClientAction === entry.action
      ? entry.action
      : undefined;
  const idle =
    review.status === "idle" ||
    review.status === "no-capture" ||
    review.status === "identity-mismatch";
  const applying = review.status === "applying";

  const recordOf = useCallback(
    (state: WordCommentCardState) => {
      if (!draft || !state.consent) return;
      recordWordCommentOutcome(
        wordCommentOutcomeRecord({
          draft,
          consent: state.consent,
          consentKind: state.consentKind ?? null,
          rows: state.rows,
          authorModeRequested:
            draft.action === "word.add_comments" ? draft.authorMode : null,
        }),
      );
    },
    [draft],
  );

  const runRows = useCallback(
    async (
      rows: readonly number[],
      consentKind: WordCommentConsentKind,
      userModeOnly = false,
    ): Promise<boolean> => {
      const live = resolveWordWriteGate({
        capture,
        expectedIdentity: artifact?.itemIdentity,
        currentIdentity: documentIdentity,
      });
      if (!draft || !live.allowed) {
        const state = {
          ...cardState,
          consent: "expired" as const,
          consentKind,
        };
        updateReview(batchKey, {
          status: live.allowed ? "no-capture" : live.reason,
          comments: state,
        });
        recordOf(state);
        return false;
      }
      if (isGenerating || !offered || !beginOperation()) return false;
      let held = false;
      updateReview(batchKey, { status: "applying", capture: live.capture });
      try {
        const run = await entry.execute({
          fenceContent: content,
          capture: live.capture,
          comments: {
            selected: new Set(rows),
            assistantAuthor: userModeOnly ? null : plan.authorName,
            userModeRows: new Set(plan.userModeRows.keys()),
          },
        });
        const result = run.commentResult;
        if (result?.timedOut) {
          // Word may still be writing: every card waits until the run has really ended.
          holdOperationUntil(result.settled, batchKey);
          held = true;
        }
        if (!result) {
          const state = {
            ...cardState,
            consent: "expired" as const,
            consentKind,
          };
          updateReview(batchKey, { status: "no-capture", comments: state });
          recordOf(state);
          return false;
        }
        const touched = new Map(
          result.rows
            .filter((row) => rows.includes(row.i))
            .map((row) => [row.i, row]),
        );
        const merged = draft.rows.map(
          (row) =>
            touched.get(row.i) ??
            cardState.rows.find((r) => r.i === row.i) ?? {
              i: row.i,
              op: row.op,
              ...(row.ref ? { ref: row.ref } : {}),
              status: "refused" as const,
              code: "DESELECTED",
            },
        );
        const state: WordCommentCardState = {
          ...cardState,
          rows: merged,
          consent: "approved",
          consentKind: cardState.consentKind ?? consentKind,
        };
        updateReview(batchKey, {
          status: "done",
          comments: state,
          automatic: consentKind === "standing_grant",
        });
        recordOf(state);
        return run.ok;
      } catch {
        updateReview(batchKey, { status: "write-failed" });
        return false;
      } finally {
        if (!held) endOperation();
      }
    },
    [
      capture,
      artifact,
      documentIdentity,
      draft,
      cardState,
      updateReview,
      batchKey,
      recordOf,
      isGenerating,
      offered,
      beginOperation,
      entry,
      content,
      plan,
      holdOperationUntil,
      endOperation,
    ],
  );

  const execute = useCallback(
    (_action: WordClientAction, itemIdentityAtOpen?: string | null) =>
      runRows(
        cardState.selected,
        itemIdentityAtOpen === undefined ? "standing_grant" : "click",
      ),
    [runRows, cardState.selected],
  );
  const buildSummary = useCallback(
    () => (idle && !isGenerating && draft ? draft : null),
    [idle, isGenerating, draft],
  );
  const { confirmCard, isConfirmPending, allowCard, denyCard } =
    useClientActionConfirmFlow<WordCommentDraft, WordClientAction>({
      promptScope: entry.promptScope,
      facetId: artifact?.facetId,
      decisions,
      enforcedAskActions,
      buildSummary,
      execute,
      itemIdentity: documentIdentity,
      presentation: artifact?.clientActionPresentation,
      messageId,
      isFreshCompletion: !!artifact?.isFreshCompletion,
      proposedAction,
      expectedItemIdentity: artifact?.itemIdentity,
      currentItemIdentity: documentIdentity,
    });

  const toggle = (i: number) =>
    updateReview(batchKey, {
      comments: {
        ...cardState,
        selected: cardState.selected.includes(i)
          ? cardState.selected.filter((s) => s !== i)
          : [...cardState.selected, i].sort((a, b) => a - b),
      },
    });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote(
        t({
          id: "officeAddin.word.comments.copied",
          message: "Copied. Paste it into a comment in Word.",
        }),
      );
    } catch {
      setNote(
        t({
          id: "officeAddin.word.comments.copyFailed",
          message: "Copying failed. Select the text and copy it instead.",
        }),
      );
    }
  };
  const show = async (row: WordCommentDraftRow) => {
    if (!gate.allowed || !beginOperation()) return;
    try {
      const result = row.add
        ? await showWordCommentTarget(row.add)
        : await showWordComment(
            row.thread!.commentId,
            row.thread!.fingerprint.anchor?.para ?? null,
          );
      if (result !== "selected")
        setNote(
          t({
            id: "officeAddin.word.comments.showFailed",
            message:
              "Word could not show this place: it changed since your request.",
          }),
        );
    } finally {
      endOperation();
    }
  };
  const askAgain = () => {
    const request = message?.previous_message_id
      ? extractTextFromContent(messages[message.previous_message_id]?.content)
      : "";
    restoreRequest(request ?? "");
    setNote(
      t({
        id: "officeAddin.word.comments.askAgainNote",
        message:
          "Your request is back in the message box: send it again to work with the current comments.",
      }),
    );
  };

  const revertable = cardState.rows.filter(
    (row) =>
      (row.status === "applied" || row.status === "applied_as_user") &&
      wordCommentRowReversible(row),
  );
  const handleRevert = async () => {
    if (!revertable.length || cardState.revert || !beginOperation()) return;
    let held = false;
    setRevertConfirmation(false);
    updateReview(batchKey, { status: "reverting" });
    try {
      const result = await revertWordCommentRows(
        revertable.map((row) => ({ i: row.i, step: row.revert! })),
      );
      if (result.timedOut) {
        holdOperationUntil(result.settled, batchKey);
        held = true;
      }
      updateReview(batchKey, {
        status: result.rows.some((row) => row.status === "reverted")
          ? "reverted"
          : "done",
        comments: { ...cardState, revert: result.rows },
      });
    } finally {
      if (!held) endOperation();
    }
  };

  if (isGenerating)
    return (
      <WordReviewGenerating
        label={t({
          id: "officeAddin.word.comments.preparing",
          message: "Preparing comment changes…",
        })}
      />
    );
  // Only this message's accepted submission is its card; a fence naming another draft is not.
  if (artifact?.submittedCard?.toolCallId !== content) return null;
  if (!draft)
    return (
      <Alert type="info" role="status">
        {t({
          id: "officeAddin.word.comments.expired",
          message:
            "These comment changes belong to an earlier session of this pane, so they can no longer be applied. Ask again to get a new proposal.",
        })}
      </Alert>
    );

  const results = new Map(cardState.rows.map((row) => [row.i, row]));
  const ran = cardState.rows.length > 0;
  const count = cardState.selected.length;
  const blockedReason = gate.allowed
    ? undefined
    : wordBlockedReasonText(gate.reason);
  const applyLabel =
    draft.action === "word.add_comments"
      ? t({
          id: "officeAddin.word.comments.apply.add",
          message: plural(count, {
            one: "Add # comment",
            other: "Add # comments",
          }),
        })
      : t({
          id: "officeAddin.word.comments.apply.change",
          message: plural(count, {
            one: "Apply # change",
            other: "Apply # changes",
          }),
        });
  // A row whose pair ran earlier cannot be tried alone: its pair's state has changed.
  const failedRows = offered
    ? cardState.rows
        .filter(
          (row) =>
            row.status === "failed" &&
            draft.rows.find((r) => r.i === row.i)?.dependsOn === undefined,
        )
        .map((row) => row.i)
    : [];
  const authorRows = (offered ? cardState.rows : [])
    .filter(
      (row) =>
        row.code === "AUTHOR_MODE_UNAVAILABLE" && row.status === "refused",
    )
    .map((row) => row.i);
  const drifted = cardState.rows.some(
    (row) =>
      row.status === "refused" &&
      row.code !== "DESELECTED" &&
      row.code !== "AUTHOR_MODE_UNAVAILABLE",
  );
  const locked = enforcedAskActions.includes(entry.action);
  const lockedReason =
    alwaysBlock ??
    (configuredAsk.includes(entry.action) ? "organization" : null);

  return (
    <WordReviewCard
      cardRef={cardRef}
      label={entry.displayLabel()}
      testId="word-comments-card"
      collapsed={false}
      detailsId={detailsId}
      status={
        note ? (
          <Alert
            type="info"
            role="status"
            className="m-3 [overflow-wrap:anywhere]"
          >
            {note}
          </Alert>
        ) : undefined
      }
      footer={
        <>
          {mode === "copy" && (
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.comments.copyMode",
                message:
                  "Erato cannot change comments in this version of Word right now. Copy each comment and post it in Word yourself.",
              })}
            </p>
          )}
          {tainted && draft.action === "word.add_comments" && (
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.comments.tainted",
                message: "This request included comments by other people.",
              })}
            </p>
          )}
          {!ran && idle && offered && !confirmCard && (
            <Button
              type="button"
              variant="primary"
              busy={applying}
              disabled={
                operationInProgress ||
                isConfirmPending ||
                !gate.allowed ||
                count === 0
              }
              onClick={() => void runRows(cardState.selected, "click")}
            >
              {applyLabel}
            </Button>
          )}
          {confirmCard && (
            <ActionConfirmationCard
              key={confirmCard.requestId}
              title={titleOf(draft)}
              allowOnceLabel={applyLabel}
              description={
                grantScope === "session_document" && !locked
                  ? t({
                      id: "officeAddin.word.comments.always.session",
                      message:
                        "Always allow lasts for this document until the add-in closes.",
                    })
                  : undefined
              }
              denyLabel={t({
                id: "officeAddin.word.review.cancel",
                message: "Cancel",
              })}
              onAllowOnce={() => {
                if (gate.allowed && !operationInProgress && count > 0)
                  allowCard(confirmCard);
              }}
              onAlwaysAllow={() => {
                if (
                  !gate.allowed ||
                  operationInProgress ||
                  locked ||
                  count === 0
                )
                  return;
                if (grantScope === "session_document" && documentIdentity)
                  grantClientActionForSession(
                    facetId,
                    entry.action,
                    documentIdentity,
                  );
                else
                  setDecisions({
                    ...storedDecisions,
                    [decisionKey(facetId, entry.action)]: "always",
                  });
                allowCard(confirmCard);
              }}
              alwaysAllowDisabledReason={
                lockedReason ? alwaysBlockText(lockedReason) : undefined
              }
              onDeny={() => {
                denyCard(confirmCard);
                const state = {
                  ...cardState,
                  consent: "declined" as const,
                  consentKind: "click" as const,
                };
                updateReview(batchKey, {
                  status: "denied",
                  capture,
                  comments: state,
                });
                recordOf(state);
              }}
              isBusy={operationInProgress || !gate.allowed}
              scrollIntoViewOnMount={confirmCard.autoTriggered}
            />
          )}
          {ran && (
            <div className="word-review__actions">
              {failedRows.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={operationInProgress}
                  onClick={() => void runRows(failedRows, "click")}
                >
                  {t({
                    id: "officeAddin.word.comments.retryFailed",
                    message: "Try the rows Word did not take again",
                  })}
                </Button>
              )}
              {authorRows.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={operationInProgress}
                  onClick={() => void runRows(authorRows, "click", true)}
                >
                  {t({
                    id: "officeAddin.word.comments.postAsMe",
                    message: "Post under my name instead",
                  })}
                </Button>
              )}
              {drifted && (
                <Button type="button" variant="secondary" onClick={askAgain}>
                  {t({
                    id: "officeAddin.word.comments.askAgain",
                    message: "Ask again with the current comments",
                  })}
                </Button>
              )}
              {revertable.length > 0 && !cardState.revert && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={operationInProgress}
                  onClick={() => setRevertConfirmation(true)}
                  data-testid="word-comments-revert"
                >
                  {t({
                    id: "officeAddin.word.comments.revert",
                    message: "Revert",
                  })}
                </Button>
              )}
            </div>
          )}
          {revertConfirmation && (
            <Card
              variant="surface"
              tone="warning"
              size="sm"
              nested
              bodyClassName="word-review__revert"
              role="group"
            >
              <strong>
                {t({
                  id: "officeAddin.word.comments.revertWarning",
                  message:
                    "Revert what Erato did here? Comments or replies someone changed since are left alone. Deleted comments cannot be brought back.",
                })}
              </strong>
              <div className="word-review__actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setRevertConfirmation(false)}
                >
                  {t({ id: "officeAddin.word.comments.keep", message: "Keep" })}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={operationInProgress}
                  onClick={() => void handleRevert()}
                >
                  {t({
                    id: "officeAddin.word.comments.revertConfirm",
                    message: "Revert",
                  })}
                </Button>
              </div>
            </Card>
          )}
          {cardState.revert && (
            <p className="word-review__hint" role="status">
              {t({
                id: "officeAddin.word.comments.reverted",
                message: `Reverted ${cardState.revert.filter((r) => r.status === "reverted").length} of ${cardState.revert.length}; Revert is used up.`,
              })}
            </p>
          )}
          {review.status === "denied" && (
            <p className="word-review__hint" role="status">
              {t({
                id: "officeAddin.word.comments.declined",
                message: "Declined. Nothing was written.",
              })}
            </p>
          )}
        </>
      }
    >
      <WordReviewHeader title={titleOf(draft)}>
        {blockedReason && (
          <Alert type="info" role="status" className="[overflow-wrap:anywhere]">
            {blockedReason}
          </Alert>
        )}
        {draft.matchedByContent && (
          <p className="word-review__hint">
            {t({
              id: "officeAddin.word.comments.matchedByContent",
              message:
                "This file names its comments by content only, so Erato matched them by author, time and text.",
            })}
          </p>
        )}
        <ul className="m-0 list-none space-y-3 p-0">
          {draft.rows.map((row) => {
            const result = results.get(row.i);
            const userMode = plan.userModeRows.get(row.i);
            const thread = row.thread?.fingerprint;
            const target = row.entry?.fingerprint ?? thread;
            const replies = thread?.replies ?? [];
            const others =
              row.op === "delete" && row.entry?.n === 0 ? replies : [];
            const authors = replyAuthors(others);
            const notMine =
              !!row.thread &&
              !isOwn(row.thread.fingerprint.email, profile?.email ?? null);
            return (
              <li
                key={row.i}
                className="space-y-1"
                data-testid="word-comments-row"
              >
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--theme-fg-accent)]"
                    checked={cardState.selected.includes(row.i)}
                    disabled={ran || !idle || mode === "copy"}
                    onChange={() => toggle(row.i)}
                  />
                  <span>
                    <strong>{verbOf(row)}</strong>
                    {row.add && (
                      <span className="word-review__text">
                        {" "}
                        {row.add.excerpt.before}
                        <mark>{row.add.excerpt.text}</mark>
                        {row.add.excerpt.after}
                      </span>
                    )}
                  </span>
                </label>
                {target && (
                  <p className="word-review__hint">
                    {t({
                      id: "officeAddin.word.comments.target",
                      message: `${target.author}: "${excerpt(target.content)}"`,
                    })}
                    {thread && row.op !== "edit"
                      ? ` · ${thread.resolved ? t({ id: "officeAddin.word.comments.resolved", message: "resolved" }) : t({ id: "officeAddin.word.comments.open", message: "open" })} · ${t({ id: "officeAddin.word.comments.replyCount", message: plural(replies.length, { one: "# reply", other: "# replies" }) })}`
                      : ""}
                  </p>
                )}
                {others.length > 0 && (
                  <p className="word-review__hint">
                    {t({
                      id: "officeAddin.word.comments.deleteReplies",
                      message: plural(others.length, {
                        one: `Also deletes # reply by ${authors}.`,
                        other: `Also deletes # replies by ${authors}.`,
                      }),
                    })}
                  </p>
                )}
                {row.finalText !== undefined && (
                  <pre className="word-review__text">
                    {row.op === "add" && plan.authorName && !userMode
                      ? row.text
                      : row.finalText}
                  </pre>
                )}
                <p className="word-review__hint">
                  {attributionOf(row, draft, {
                    userName: profile?.name ?? null,
                    principalEmail: profile?.email ?? null,
                    authorName: plan.authorName,
                    userMode: !!userMode,
                  })}
                </p>
                {userMode && (
                  <p className="word-review__hint">{userModeText(userMode)}</p>
                )}
                {row.op === "edit" && (
                  <p className="word-review__hint">
                    {t({
                      id: "officeAddin.word.comments.editFormatting",
                      message:
                        "Word keeps plain text only: bold, links and mentions in this comment are lost.",
                    })}
                  </p>
                )}
                {row.op === "delete" && notMine && row.entry?.n === 0 && (
                  <p className="word-review__hint">
                    {t({
                      id: "officeAddin.word.comments.resolveInstead",
                      message:
                        "This thread is someone else's. Resolving it keeps their words: ask Erato to resolve it instead.",
                    })}
                  </p>
                )}
                {WORD_COMMENT_OP_META[row.op].destructive &&
                  !WORD_COMMENT_OP_META[row.op].reversible && (
                    <p className="word-review__hint">
                      {t({
                        id: "officeAddin.word.comments.irreversible",
                        message: "Erato cannot undo this.",
                      })}
                    </p>
                  )}
                {result && (
                  <p
                    className="word-review__hint"
                    role="status"
                    data-testid="word-comments-row-status"
                  >
                    {statusText(result)}
                  </p>
                )}
                <div className="word-review__actions">
                  {row.finalText !== undefined && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void copy(row.finalText!)}
                    >
                      {t({
                        id: "officeAddin.word.comments.copy",
                        message: "Copy comment",
                      })}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!gate.allowed || operationInProgress}
                    onClick={() => void show(row)}
                  >
                    {row.add
                      ? t({
                          id: "officeAddin.word.comments.showPassage",
                          message: "Show passage",
                        })
                      : wordShowInWordLabel()}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </WordReviewHeader>
    </WordReviewCard>
  );
}
