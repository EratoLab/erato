import {
  ActionConfirmationCard,
  Button,
  Card,
  Alert,
  SpinnerIcon,
  SyntaxHighlightedCode,
  useChatContext,
  useHostArtifact,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import "./wordReview.css";

import { WordDocumentPlanCard } from "./WordDocumentPlanCard";
import { WordEditReport } from "./WordEditReport";
import { WordReviewPanel } from "./WordReviewPanel";
import { WordReviewReceipt } from "./WordReviewReceipt";
import { useClientActionConfirmFlow } from "../../core/clientActions/useClientActionConfirmFlow";
import { useClientActionDecisions } from "../../core/clientActions/useClientActionDecisions";
import { useWordReviewFocus } from "../hooks/useWordReviewFocus";
import { useWordWrite } from "../providers/WordWriteProvider";
import {
  decisionKey,
  isActionDenied,
  wordClientActionDecisionStore,
} from "../utils/clientActionPolicy";
import { revertWordEdits } from "../utils/wordApplyEdits";
import {
  offerableWordClientActionsForFacet,
  wordActionForFence,
  WORD_EDITS_FENCE,
  type WordClientAction,
  type WordClientActionEntry,
} from "../utils/wordClientActions";
import { editExcerpt, parseWordEdits } from "../utils/wordEditPlan";
import {
  originalWordAnchor,
  readWordTrackingMode,
  showWordReviewLocation,
} from "../utils/wordReviewLocation";
import { EMPTY_WORD_REVIEW } from "../utils/wordReviewState";
import { resolveWordWriteGate } from "../utils/wordWriteGate";

import type { WordEdit } from "../utils/wordEditPlan";
import type {
  WordLocationResult,
  WordTrackingMode,
} from "../utils/wordReviewLocation";
import type { WordWriteBlockReason } from "../utils/wordWriteGate";
import type { HostCardCodeBlockProps } from "@erato/frontend/library";

type WordCardPayload =
  | { kind: "edits"; edits: WordEdit[] }
  | { kind: "insert"; text: string };

export function WordHostCardRenderer({
  language,
  content,
}: HostCardCodeBlockProps) {
  const entry = wordActionForFence(language);
  if (!entry) {
    return <RawFence content={content} />;
  }
  if (entry.action === "word.apply_document_plan")
    return (
      <WordDocumentPlanCard
        key={`${entry.action}:${content}`}
        entry={entry}
        content={content}
      />
    );
  // A changed action or payload must not reuse an earlier confirmation.
  return (
    <WordActionCard
      key={`${entry.action}:${content}`}
      entry={entry}
      content={content}
    />
  );
}

function RawFence({ content }: { content: string }) {
  return (
    <div className="my-2 overflow-auto" data-testid="word-card-raw">
      <SyntaxHighlightedCode code={content} language="text" />
    </div>
  );
}

function WordActionCard({
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
    revertSlot,
    setRevertSlot,
    reviews,
    updateReview,
    operationInProgress,
    beginOperation,
    endOperation,
    locationGeneration,
    invalidateLocations,
  } = useWordWrite();
  const [decisions, setDecisions] = useClientActionDecisions(
    wordClientActionDecisionStore,
  );
  const facetId = artifact?.facetId ?? "";
  const messageId = artifact?.messageId;
  const { messages } = useChatContext();
  const isGenerating = !!messageId && messages[messageId]?.status === "sending";
  const batchKey = `${messageId ?? ""}:${entry.action}:${content}`;
  const review = reviews.get(batchKey) ?? EMPTY_WORD_REVIEW;
  const cardRef = useWordReviewFocus(
    `${review.status}:${!!review.detailsExpanded}`,
  );
  const capture =
    (messageId ? capturesByAssistantMessageId.get(messageId) : undefined) ??
    review.capture;
  const enforcedAskActions = useMemo(
    () => artifact?.alwaysAskClientActions ?? [],
    [artifact],
  );
  const gate = resolveWordWriteGate({
    capture,
    expectedIdentity: artifact?.itemIdentity,
    currentIdentity: documentIdentity,
  });
  const [tracking, setTracking] = useState<WordTrackingMode>("unknown");
  const [revertConfirmation, setRevertConfirmation] = useState(false);
  const detailsId = useId();
  useEffect(() => {
    let active = true;
    if (gate.allowed && !isGenerating)
      void readWordTrackingMode().then((mode) => {
        if (active) setTracking(mode);
      });
    return () => {
      active = false;
    };
  }, [gate.allowed, documentIdentity, isGenerating]);
  const payload = useMemo<WordCardPayload | null>(() => {
    if (entry.fenceLanguage === WORD_EDITS_FENCE) {
      const edits = parseWordEdits(content);
      return edits ? { kind: "edits", edits } : null;
    }
    return content.trim().length > 0 ? { kind: "insert", text: content } : null;
  }, [entry.fenceLanguage, content]);
  const offeredActions = useMemo(
    () =>
      payload
        ? offerableWordClientActionsForFacet(
            facetId,
            artifact?.allowedClientActions,
          ).filter(
            (action) =>
              action === entry.action &&
              !isActionDenied({
                facetId,
                action,
                decisions,
                enforcedAskActions,
              }),
          )
        : [],
    [payload, facetId, artifact, entry.action, decisions, enforcedAskActions],
  );
  const proposedAction =
    artifact?.proposedClientAction &&
    (offeredActions as string[]).includes(artifact.proposedClientAction)
      ? (artifact.proposedClientAction as WordClientAction)
      : undefined;
  const idle =
    review.status === "idle" ||
    review.status === "no-capture" ||
    review.status === "identity-mismatch";
  const execute = useCallback(async (): Promise<boolean> => {
    const live = resolveWordWriteGate({
      capture,
      expectedIdentity: artifact?.itemIdentity,
      currentIdentity: documentIdentity,
    });
    if (!live.allowed) {
      updateReview(batchKey, { status: live.reason });
      return false;
    }
    if (
      !payload ||
      isGenerating ||
      offeredActions.length === 0 ||
      !idle ||
      !beginOperation()
    )
      return false;
    updateReview(batchKey, { status: "applying", capture: live.capture });
    try {
      const mode = await readWordTrackingMode();
      setTracking(mode);
      const run = await entry.execute({
        fenceContent: content,
        capture: live.capture,
      });
      if (run.snapshotOoxml && messageId)
        setRevertSlot({
          messageId,
          batchKey,
          identity: live.capture.identity,
          ooxml: run.snapshotOoxml,
        });
      updateReview(batchKey, {
        detailsExpanded: false,
        status:
          run.ok || (payload.kind === "edits" && run.hostFailed === false)
            ? "done"
            : run.snapshotOoxml
              ? "write-failed"
              : "error",
        outcomes: run.outcomes,
        anchors: run.resultAnchors,
        locationGeneration,
        tracking: mode,
        automatic:
          artifact?.clientActionPresentation === "auto_prompt" &&
          decisions[decisionKey(facetId, entry.action)] === "always" &&
          !enforcedAskActions.includes(entry.action),
      });
      return run.ok;
    } catch {
      updateReview(batchKey, {
        status: "write-failed",
        outcomes:
          payload.kind === "edits"
            ? payload.edits.map((edit, index) => ({
                ...edit,
                index,
                status: "failed",
                excerpt: editExcerpt(edit.text),
              }))
            : [],
      });
      return false;
    } finally {
      endOperation();
    }
  }, [
    capture,
    artifact,
    documentIdentity,
    payload,
    isGenerating,
    offeredActions.length,
    idle,
    beginOperation,
    updateReview,
    batchKey,
    entry,
    content,
    messageId,
    setRevertSlot,
    locationGeneration,
    decisions,
    facetId,
    enforcedAskActions,
    endOperation,
  ]);
  const buildSummary = useCallback(
    () => (idle && !isGenerating ? payload : null),
    [payload, idle, isGenerating],
  );
  const { confirmCard, isConfirmPending, allowCard, denyCard } =
    useClientActionConfirmFlow<WordCardPayload, WordClientAction>({
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
  const canRevert =
    revertSlot !== null &&
    revertSlot.messageId === messageId &&
    revertSlot.batchKey === batchKey &&
    revertSlot.identity === documentIdentity;
  const handleRevert = useCallback(async () => {
    if (!canRevert || !revertSlot || !beginOperation()) return;
    const snapshot = revertSlot.ooxml;
    setRevertSlot(null);
    invalidateLocations();
    setRevertConfirmation(false);
    updateReview(batchKey, { status: "reverting" });
    try {
      const ok = await revertWordEdits(snapshot);
      updateReview(batchKey, {
        status: ok ? "reverted" : "revert-failed",
        anchors: undefined,
        detailsExpanded: false,
      });
    } finally {
      endOperation();
    }
  }, [
    canRevert,
    revertSlot,
    beginOperation,
    setRevertSlot,
    invalidateLocations,
    updateReview,
    batchKey,
    endOperation,
  ]);
  if (isGenerating)
    return (
      <Card variant="surface" size="sm">
        <SpinnerIcon
          label={t({
            id: "officeAddin.word.review.preparing",
            message: "Preparing changes…",
          })}
        />
      </Card>
    );
  if (!payload)
    return (
      <Alert type="error">
        {t({
          id: "officeAddin.word.review.invalid",
          message:
            "The proposed changes are incomplete or invalid. Ask for a corrected proposal; nothing was applied.",
        })}
      </Alert>
    );
  const blockedReason = gate.allowed
    ? undefined
    : blockedReasonText(gate.reason);
  const total = payload.kind === "edits" ? payload.edits.length : 0;
  const completed =
    review.status === "done" ||
    review.status === "denied" ||
    review.status === "reverted";
  const collapsed = completed && !review.detailsExpanded;
  const applyLabel =
    payload.kind === "edits"
      ? total === 1
        ? t({ id: "officeAddin.word.review.applyOne", message: "Apply edit" })
        : t({
            id: "officeAddin.word.review.applyAll",
            message: `Apply all ${total} edits`,
          })
      : entry.displayLabel();
  const outcome = (index: number) =>
    review.outcomes.find((item) => item.index === index);
  const anchor = (index: number) => {
    if (payload.kind !== "edits" || !capture) return null;
    if (idle || review.status === "denied")
      return originalWordAnchor(payload.edits[index], capture);
    if (
      review.status === "done" &&
      outcome(index)?.status === "applied" &&
      review.locationGeneration === locationGeneration
    )
      return review.anchors?.get(index) ?? null;
    return null;
  };
  const locationReason = (index: number): string | undefined => {
    if (blockedReason) return blockedReason;
    if (anchor(index)) return undefined;
    return t({
      id: "officeAddin.word.review.noExactLocation",
      message:
        "This passage cannot be located reliably from this batch. The comparison remains available.",
    });
  };
  const onLocate = async (index: number): Promise<WordLocationResult> => {
    const target = anchor(index);
    if (!gate.allowed || !target || !beginOperation()) return "unavailable";
    try {
      return await showWordReviewLocation(target, documentIdentity);
    } finally {
      endOperation();
    }
  };
  const message =
    review.status === "write-failed"
      ? t({
          id: "officeAddin.word.review.writeFailed",
          message:
            "Word stopped while applying. Some changes may already be in the document. Inspect the document before continuing.",
        })
      : review.status === "error"
        ? t({
            id: "officeAddin.word.card.failed",
            message:
              "Word did not accept the change. Nothing was written to the document.",
          })
        : review.status === "revert-failed"
          ? t({
              id: "officeAddin.word.review.revertFailed",
              message:
                "The body could not be fully restored. Some content may already have been restored. The single-use Revert has been consumed.",
            })
          : review.status === "reverted"
            ? t({
                id: "officeAddin.word.review.bodyRestored",
                message:
                  "The document body was restored to just before this batch.",
              })
            : review.status === "reverting"
              ? t({
                  id: "officeAddin.word.review.reverting",
                  message: "Restoring the document body…",
                })
              : review.status === "denied"
                ? t({
                    id: "officeAddin.word.review.denied",
                    message: "Proposal declined. Nothing was written.",
                  })
                : review.status === "done" && payload.kind === "insert"
                  ? t({
                      id: "officeAddin.word.card.inserted",
                      message: "Inserted into the document.",
                    })
                  : undefined;
  return (
    <Card
      variant="surface"
      size="none"
      ref={cardRef}
      tabIndex={-1}
      role="region"
      aria-label={entry.displayLabel()}
      className="word-review focus-ring"
      data-testid={
        payload.kind === "edits" ? "word-edits-card" : "word-insert-card"
      }
      footer={
        <div className="word-review__footer">
          {idle && offeredActions.length > 0 && (
            <>
              <p className="word-review__hint">
                {payload.kind === "edits"
                  ? t({
                      id: "officeAddin.word.review.batchScope",
                      message: `This applies all ${total} proposed edits, including rows hidden by filters. Changed paragraphs will be skipped and listed.`,
                    })
                  : t({
                      id: "officeAddin.word.card.confirmInsert",
                      message:
                        "This inserts the text below into the open document at the cursor. A selected passage is never replaced.",
                    })}
              </p>
              {!confirmCard && (
                <Button
                  type="button"
                  variant="primary"
                  disabled={
                    operationInProgress || isConfirmPending || !gate.allowed
                  }
                  onClick={() => void execute()}
                >
                  {applyLabel}
                </Button>
              )}
            </>
          )}
          {confirmCard && (
            <ActionConfirmationCard
              key={confirmCard.requestId}
              title={
                payload.kind === "edits"
                  ? t({
                      id: "officeAddin.word.review.consent",
                      message: "Apply this batch?",
                    })
                  : t({
                      id: "officeAddin.word.review.insertConsent",
                      message: "Insert this text?",
                    })
              }
              description={
                payload.kind === "edits"
                  ? t({
                      id: "officeAddin.word.review.consentScope",
                      message: `Apply all ${total} edits reviewed above to the open document.`,
                    })
                  : entry.displayLabel()
              }
              allowOnceLabel={applyLabel}
              onAllowOnce={() => {
                if (gate.allowed && idle && !operationInProgress)
                  allowCard(confirmCard);
              }}
              onAlwaysAllow={() => {
                if (
                  !gate.allowed ||
                  !idle ||
                  operationInProgress ||
                  enforcedAskActions.includes(confirmCard.action)
                )
                  return;
                setDecisions({
                  ...decisions,
                  [decisionKey(facetId, confirmCard.action)]: "always",
                });
                allowCard(confirmCard);
              }}
              alwaysAllowDisabledReason={
                enforcedAskActions.includes(confirmCard.action)
                  ? t({
                      id: "officeAddin.word.card.alwaysAllowLocked",
                      message:
                        "Your organization requires confirmation each time this action runs automatically.",
                    })
                  : undefined
              }
              onDeny={() => {
                denyCard(confirmCard);
                updateReview(batchKey, { status: "denied", capture });
              }}
              isBusy={operationInProgress || !gate.allowed || !idle}
              scrollIntoViewOnMount={confirmCard.autoTriggered}
            />
          )}
          <div className="word-review__actions">
            {completed && (
              <Button
                type="button"
                variant="secondary"
                aria-expanded={!collapsed}
                aria-controls={detailsId}
                onClick={() =>
                  updateReview(batchKey, { detailsExpanded: collapsed })
                }
              >
                {collapsed
                  ? t({
                      id: "officeAddin.word.review.showDetails",
                      message: "Show details",
                    })
                  : t({
                      id: "officeAddin.word.review.hideDetails",
                      message: "Hide details",
                    })}
              </Button>
            )}
            <WordEditReport
              outcomes={review.outcomes}
              compact
              note={message}
              reverted={review.status === "reverted"}
            />
            {canRevert && (
              <Button
                type="button"
                variant="secondary"
                data-testid="word-revert-button"
                disabled={operationInProgress}
                onClick={() => {
                  setRevertConfirmation(true);
                }}
              >
                {t({
                  id: "officeAddin.word.review.revertBatch",
                  message: "Revert batch",
                })}
              </Button>
            )}
          </div>
          {revertConfirmation && (
            <Card
              variant="surface"
              tone="warning"
              size="sm"
              nested
              bodyClassName="word-review__revert"
              role="group"
              aria-label={t({
                id: "officeAddin.word.review.revertTitle",
                message: "Restore the document body?",
              })}
            >
              <strong>
                {t({
                  id: "officeAddin.word.review.revertWarning",
                  message:
                    "Restore the document body to just before this batch? This can remove later changes to the body.",
                })}
              </strong>
              <div className="word-review__actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={operationInProgress}
                  onClick={() => setRevertConfirmation(false)}
                >
                  {t({
                    id: "officeAddin.word.review.keepText",
                    message: "Keep current text",
                  })}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={operationInProgress || !canRevert}
                  onClick={() => void handleRevert()}
                >
                  {t({
                    id: "officeAddin.word.review.restoreBody",
                    message: "Restore body",
                  })}
                </Button>
              </div>
              {!canRevert && (
                <p>
                  {t({
                    id: "officeAddin.word.review.revertUnavailable",
                    message:
                      "Revert is unavailable: the snapshot was replaced, consumed, or belongs to another document.",
                  })}
                </p>
              )}
            </Card>
          )}
          {review.outcomes.some(
            (item) => item.status === "applied" || item.status === "failed",
          ) &&
            !collapsed &&
            !canRevert &&
            review.status !== "reverting" && (
              <p className="word-review__hint">
                {t({
                  id: "officeAddin.word.review.revertExpired",
                  message:
                    "Revert is unavailable for this batch. Its single-use snapshot was consumed or replaced.",
                })}
              </p>
            )}
        </div>
      }
    >
      {collapsed && <WordReviewReceipt review={review} kind={payload.kind} />}
      <div id={detailsId} hidden={collapsed}>
        {payload.kind === "edits" ? (
          <WordReviewPanel
            edits={payload.edits}
            capture={capture}
            review={review}
            tracking={review.tracking ?? tracking}
            busy={operationInProgress}
            blockedReason={blockedReason}
            locationReason={locationReason}
            onLocate={onLocate}
          />
        ) : (
          <div className="word-review__header">
            <h3>
              {t({
                id: "officeAddin.word.review.insertTitle",
                message: "Insert text",
              })}
            </h3>
            <pre className="word-review__text">{payload.text}</pre>
            {blockedReason && (
              <Alert
                type="info"
                role="status"
                className="[overflow-wrap:anywhere]"
              >
                {blockedReason}
              </Alert>
            )}
          </div>
        )}
      </div>
      {message && !collapsed && (
        <Alert
          type={
            review.status === "error" ||
            review.status === "write-failed" ||
            review.status === "revert-failed"
              ? "error"
              : "info"
          }
          className="m-3 [overflow-wrap:anywhere]"
          role={
            review.status === "error" ||
            review.status === "write-failed" ||
            review.status === "revert-failed"
              ? "alert"
              : "status"
          }
        >
          {message}
        </Alert>
      )}
    </Card>
  );
}

function blockedReasonText(reason: WordWriteBlockReason): string {
  return reason === "no-capture"
    ? t({
        id: "officeAddin.word.card.blocked.noCapture",
        message:
          "This pane no longer has the document snapshot this answer was written against. Include the document and ask again to apply changes.",
      })
    : t({
        id: "officeAddin.word.card.blocked.identity",
        message:
          "This answer was written about a different document than the one open now, so it cannot be applied here.",
      });
}
