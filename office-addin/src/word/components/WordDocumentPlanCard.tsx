import {
  Button,
  Alert,
  useChatContext,
  useHostArtifact,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useId, useMemo, useState } from "react";

import { WordDocumentPlanReview } from "./WordDocumentPlanReview";
import {
  isAutomaticWordRun,
  WordApplyButton,
  wordBlockedReasonText,
  WordDiagnosticDetails,
  WordReviewCard,
  WordReviewConfirm,
  WordReviewDetailsToggle,
  WordReviewGenerating,
  WordUndoLine,
  wordUndoLabel,
} from "./WordReviewCardParts";
import { WordReviewReceipt } from "./WordReviewReceipt";
import { WordSavedPlanPreview } from "./WordSavedPlanPreview";
import { wordPlanApplyLabel, wordPlanTitleText } from "./wordPlanLabels";
import { useClientActionConfirmFlow } from "../../core/clientActions/useClientActionConfirmFlow";
import { useClientActionDecisions } from "../../core/clientActions/useClientActionDecisions";
import { useWordReviewFocus } from "../hooks/useWordReviewFocus";
import { useWordWrite } from "../providers/WordWriteProvider";
import {
  isActionDenied,
  wordClientActionDecisionStore,
} from "../utils/clientActionPolicy";
import { revertWordDocumentPlan } from "../utils/wordApplyDocumentPlan";
import {
  wordAuthoringIssueText,
  wordDocumentDiagnosticText,
} from "../utils/wordAuthoringMessages";
import { offerableWordClientActionsForFacet } from "../utils/wordClientActions";
import {
  decodeWordDocumentBackup,
  isWordDocumentBackup,
} from "../utils/wordDocumentPackage";
import {
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "../utils/wordDocumentPlan";
import { wordPlanDraftText } from "../utils/wordDocumentXml";
import { buildWordPlanReview } from "../utils/wordPlanReview";
import { showWordReviewLocation } from "../utils/wordReviewLocation";
import { EMPTY_WORD_REVIEW } from "../utils/wordReviewState";
import { resolveWordWriteGate } from "../utils/wordWriteGate";

import type {
  WordClientAction,
  WordClientActionEntry,
} from "../utils/wordClientActions";
import type { WordDocumentPlan } from "../utils/wordDocumentPlan";

export function WordDocumentPlanCard({
  entry,
  content,
}: {
  entry: WordClientActionEntry;
  content: string;
}) {
  const artifact = useHostArtifact();
  const { messages } = useChatContext();
  const host = useWordWrite();
  const [decisions, setDecisions] = useClientActionDecisions(
    wordClientActionDecisionStore,
  );
  const [copyNote, setCopyNote] = useState("");
  const detailsId = useId();
  const facetId = artifact?.facetId ?? "";
  const messageId = artifact?.messageId;
  const generating = !!messageId && messages[messageId]?.status === "sending";
  const key = `${messageId ?? ""}:${entry.action}:${content}`;
  const review = host.reviews.get(key) ?? EMPTY_WORD_REVIEW;
  const cardRef = useWordReviewFocus(
    `${review.status}:${review.documentPlanStatus ?? ""}:${!!review.detailsExpanded}`,
  );
  const capture =
    (messageId
      ? host.capturesByAssistantMessageId.get(messageId)
      : undefined) ?? review.capture;
  const snapshot = capture?.authoring;
  const plan = useMemo(() => {
    const parsed = parseWordDocumentPlan(content);
    return parsed && normalizeWordDocumentPlan(parsed, snapshot);
  }, [content, snapshot]);
  const planReview = useMemo(
    () => plan && buildWordPlanReview(plan, snapshot),
    [plan, snapshot],
  );
  const gate = resolveWordWriteGate({
    capture,
    expectedIdentity: artifact?.itemIdentity,
    currentIdentity: host.documentIdentity,
  });
  const idle = review.status === "idle";
  const applying = review.status === "applying";
  const issue = plan ? validateWordDocumentPlan(plan, snapshot) : "invalid";
  const enforcedAskActions = useMemo(
    () => artifact?.alwaysAskClientActions ?? [],
    [artifact],
  );
  const offered =
    offerableWordClientActionsForFacet(
      facetId,
      artifact?.allowedClientActions,
    ).includes(entry.action) &&
    !isActionDenied({
      facetId,
      action: entry.action,
      decisions,
      enforcedAskActions,
    });
  const ready =
    idle &&
    !generating &&
    !issue &&
    !planReview?.noChange &&
    gate.allowed &&
    snapshot?.ownerMessageId === messageId &&
    offered;
  const execute = useCallback(async () => {
    if (!ready || !capture || !host.beginOperation()) return false;
    host.updateReview(key, {
      status: "applying",
      applyStage: "checking",
      capture,
      documentPlanDiagnostic: undefined,
    });
    try {
      const run = await entry.execute({
        fenceContent: content,
        capture,
        messageId,
        onStage: (applyStage) => host.updateReview(key, { applyStage }),
        onBeforeDocumentWrite: (before) => {
          if (messageId)
            host.setRevertSlot({
              messageId,
              batchKey: key,
              identity: capture.identity,
              ooxml: before,
            });
        },
      });
      const result = run.documentPlanResult;
      if (result?.before) {
        host.invalidateLocations();
        host.setRevertSlot(
          messageId
            ? {
                messageId,
                batchKey: key,
                identity: capture.identity,
                ooxml: result.before,
                afterFingerprint: result.afterFingerprint,
              }
            : null,
        );
      }
      host.updateReview(key, {
        applyStage: undefined,
        status: run.ok
          ? "done"
          : result?.status === "interrupted"
            ? "write-failed"
            : "error",
        documentPlanStatus: result?.status,
        documentPlanDiagnostic: result?.diagnostic,
        detailsExpanded: false,
        automatic: isAutomaticWordRun({
          presentation: artifact?.clientActionPresentation,
          decisions,
          facetId,
          action: entry.action,
          enforcedAskActions,
        }),
      });
      return run.ok;
    } catch {
      host.updateReview(key, {
        applyStage: undefined,
        status: "write-failed",
        documentPlanStatus: "interrupted",
        documentPlanDiagnostic: { stage: "write", reason: "host-error" },
      });
      return false;
    } finally {
      host.endOperation();
    }
  }, [
    ready,
    capture,
    host,
    key,
    entry,
    content,
    messageId,
    artifact,
    decisions,
    facetId,
    enforcedAskActions,
  ]);
  const buildSummary = useCallback(() => (ready ? plan : null), [ready, plan]);
  const { confirmCard, isConfirmPending, allowCard, denyCard } =
    useClientActionConfirmFlow<WordDocumentPlan, WordClientAction>({
      promptScope: entry.promptScope,
      facetId,
      decisions,
      enforcedAskActions,
      buildSummary,
      execute,
      itemIdentity: host.documentIdentity,
      presentation: artifact?.clientActionPresentation,
      messageId,
      isFreshCompletion: !!artifact?.isFreshCompletion,
      proposedAction:
        artifact?.proposedClientAction === entry.action
          ? entry.action
          : undefined,
      expectedItemIdentity: artifact?.itemIdentity,
      currentItemIdentity: host.documentIdentity,
    });
  const recoverySlot =
    host.revertSlot?.batchKey === key &&
    host.revertSlot.identity === host.documentIdentity
      ? host.revertSlot
      : null;
  // After a stale revert the slot is kept only for download: retrying would
  // hit the same later edits, so the undo line would promise too much.
  const canRevert =
    ["done", "write-failed", "revert-failed"].includes(review.status) &&
    review.documentPlanStatus !== "revert-stale" &&
    !!recoverySlot?.afterFingerprint;
  const revert = async () => {
    const slot = host.revertSlot;
    if (!canRevert || !slot?.afterFingerprint || !host.beginOperation()) return;
    host.updateReview(key, {
      status: "reverting",
      documentPlanDiagnostic: undefined,
    });
    host.invalidateLocations();
    try {
      const result = await revertWordDocumentPlan(
        slot.ooxml,
        slot.afterFingerprint,
      );
      if (result.status === "reverted") host.setRevertSlot(null);
      else if (result.status === "interrupted")
        host.setRevertSlot({
          ...slot,
          afterFingerprint: result.afterFingerprint,
        });
      host.updateReview(key, {
        status:
          result.status === "reverted"
            ? "reverted"
            : result.status === "stale"
              ? review.status
              : "revert-failed",
        documentPlanStatus:
          result.status === "stale"
            ? "revert-stale"
            : review.documentPlanStatus,
        documentPlanDiagnostic: result.diagnostic,
        detailsExpanded: result.status !== "reverted",
      });
    } catch {
      host.setRevertSlot({ ...slot, afterFingerprint: undefined });
      host.updateReview(key, {
        status: "revert-failed",
        documentPlanDiagnostic: { stage: "restore", reason: "host-error" },
        detailsExpanded: true,
      });
    } finally {
      host.endOperation();
    }
  };
  const locate = async (ref: string) => {
    const source = snapshot?.blocks.find((b) => b.ref === ref);
    const paragraph = source?.paragraphOrdinal
      ? capture?.ordinalMap.get(source.paragraphOrdinal)
      : undefined;
    if (
      !gate.allowed ||
      !source ||
      !paragraph ||
      source.text !== paragraph.text ||
      !host.beginOperation()
    )
      return;
    try {
      const result = await showWordReviewLocation(
        { identity: gate.capture.identity, paragraphs: [paragraph] },
        host.documentIdentity,
      );
      if (result !== "selected")
        setCopyNote(
          t({
            id: "officeAddin.word.authoring.locationChanged",
            message:
              "This source passage has changed or cannot be located reliably.",
          }),
        );
    } finally {
      host.endOperation();
    }
  };
  const completed = ["done", "denied", "reverted"].includes(review.status);
  const collapsed = completed && !review.detailsExpanded;
  const status = review.documentPlanDiagnostic
    ? wordDocumentDiagnosticText(
        review.documentPlanDiagnostic,
        review.status === "revert-failed" ||
          review.documentPlanStatus === "revert-stale",
      )
    : review.status === "write-failed" || review.status === "revert-failed"
      ? t({
          id: "officeAddin.word.authoring.interrupted",
          message:
            "Word stopped during the operation. The document may be partially changed. Inspect it before continuing; this plan will not run again.",
        })
      : review.status === "error"
        ? t({
            id: "officeAddin.word.authoring.failed",
            message:
              "The rewrite could not be applied. No document changes were made.",
          })
        : review.status === "reverting"
          ? t({
              id: "officeAddin.word.authoring.reverting",
              message: "Checking and restoring the document…",
            })
          : undefined;
  if (generating)
    return (
      <WordReviewGenerating
        label={t({
          id: "officeAddin.word.authoring.preparing",
          message: "Preparing a complete document rewrite…",
        })}
      />
    );
  if (!plan || !planReview)
    return <Alert type="error">{wordAuthoringIssueText("invalid")}</Alert>;
  const applyLabel = wordPlanApplyLabel(planReview);
  const planTitle = wordPlanTitleText(planReview.title);
  const blockedText = issue
    ? wordAuthoringIssueText(issue, snapshot?.issueDetails)
    : !gate.allowed
      ? wordBlockedReasonText(gate.reason)
      : snapshot?.ownerMessageId !== messageId
        ? wordAuthoringIssueText("no-capture")
        : !offered
          ? t({
              id: "officeAddin.word.authoring.notAllowed",
              message:
                "This action is unavailable under the current action settings.",
            })
          : undefined;
  return (
    <WordReviewCard
      cardRef={cardRef}
      label={entry.displayLabel()}
      testId="word-document-plan-card"
      collapsed={collapsed}
      detailsId={detailsId}
      status={review.status}
      statusMessage={status}
      receipt={
        <WordReviewReceipt
          review={review}
          kind="plan"
          title={planTitle}
          wholeDocument={planReview.scope.wholeFile}
        />
      }
      trailing={
        <WordDiagnosticDetails diagnostic={review.documentPlanDiagnostic} />
      }
      footer={
        <>
          {(idle || applying) && offered && !confirmCard && (
            <WordApplyButton
              applying={applying}
              applyStage={review.applyStage}
              disabled={!ready || host.operationInProgress || isConfirmPending}
              label={applyLabel}
              onApply={() => void execute()}
            />
          )}
          {confirmCard && (
            <WordReviewConfirm
              key={confirmCard.requestId}
              card={confirmCard}
              title={t({
                id: "officeAddin.word.planReview.consent",
                message: "Apply the changes reviewed above?",
              })}
              allowOnceLabel={applyLabel}
              canApply={ready}
              operationInProgress={host.operationInProgress}
              enforcedAskActions={enforcedAskActions}
              decisions={decisions}
              setDecisions={setDecisions}
              facetId={facetId}
              allowCard={allowCard}
              denyCard={denyCard}
              onDenied={() =>
                host.updateReview(key, { status: "denied", capture })
              }
              applying={applying}
              applyStage={review.applyStage}
            />
          )}
          <div className="word-review__actions">
            {completed && (
              <WordReviewDetailsToggle
                collapsed={collapsed}
                controls={detailsId}
                onToggle={() =>
                  host.updateReview(key, { detailsExpanded: collapsed })
                }
              />
            )}
            {snapshot && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCopyNote("");
                  const failed = () =>
                    setCopyNote(
                      t({
                        id: "officeAddin.word.authoring.copyFailed",
                        message: "The draft could not be copied.",
                      }),
                    );
                  if (!navigator.clipboard) {
                    failed();
                    return;
                  }
                  try {
                    void navigator.clipboard
                      .writeText(wordPlanDraftText(plan, snapshot))
                      .then(
                        () =>
                          setCopyNote(
                            t({
                              id: "officeAddin.word.authoring.copied",
                              message: "Draft copied.",
                            }),
                          ),
                        failed,
                      );
                  } catch {
                    failed();
                  }
                }}
              >
                {t({
                  id: "officeAddin.word.authoring.copy",
                  message: "Copy draft",
                })}
              </Button>
            )}
            {recoverySlot &&
              (review.status !== "done" ||
                review.documentPlanStatus === "revert-stale") && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    try {
                      setCopyNote("");
                      const original = isWordDocumentBackup(recoverySlot.ooxml)
                        ? decodeWordDocumentBackup(recoverySlot.ooxml)
                        : undefined;
                      const url = URL.createObjectURL(
                        new Blob(
                          [
                            original
                              ? new Uint8Array(original.bytes).buffer
                              : recoverySlot.ooxml,
                          ],
                          {
                            type: original
                              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                              : "application/xml;charset=utf-8",
                          },
                        ),
                      );
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = original
                        ? "word-document-before-rewrite.docx"
                        : "word-body-before-rewrite.xml";
                      document.body.append(link);
                      link.click();
                      link.remove();
                      globalThis.setTimeout(
                        () => URL.revokeObjectURL(url),
                        1000,
                      );
                    } catch {
                      setCopyNote(
                        t({
                          id: "officeAddin.word.authoring.backupDownloadFailed",
                          message:
                            "The saved original could not be downloaded. It remains available in this pane.",
                        }),
                      );
                    }
                  }}
                >
                  {isWordDocumentBackup(recoverySlot.ooxml)
                    ? t({
                        id: "officeAddin.word.authoring.downloadDocument",
                        message: "Download original document",
                      })
                    : t({
                        id: "officeAddin.word.authoring.downloadBody",
                        message: "Download original body",
                      })}
                </Button>
              )}
          </div>
          <WordUndoLine
            canRevert={canRevert}
            label={
              review.status === "done"
                ? wordUndoLabel()
                : recoverySlot && isWordDocumentBackup(recoverySlot.ooxml)
                  ? t({
                      id: "officeAddin.word.authoring.restoreDocument",
                      message: "Restore original document",
                    })
                  : t({
                      id: "officeAddin.word.authoring.restoreBody",
                      message: "Restore original body",
                    })
            }
            disabled={host.operationInProgress}
            onUndo={() => void revert()}
          />
          {copyNote && (
            <p role="status" className="word-review__hint">
              {copyNote}
            </p>
          )}
        </>
      }
    >
      {!snapshot && artifact?.submittedCard && (
        <WordSavedPlanPreview plan={plan} />
      )}
      {snapshot && (
        <WordDocumentPlanReview
          plan={plan}
          snapshot={snapshot}
          review={planReview}
          onLocate={
            idle && gate.allowed && !host.operationInProgress
              ? (ref) => void locate(ref)
              : undefined
          }
        />
      )}
      {idle && blockedText && (
        <Alert
          type="info"
          role="status"
          className="m-3 [overflow-wrap:anywhere]"
        >
          {blockedText}
        </Alert>
      )}
    </WordReviewCard>
  );
}
