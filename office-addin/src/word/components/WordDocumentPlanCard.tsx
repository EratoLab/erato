import {
  ActionConfirmationCard,
  Button,
  Card,
  Alert,
  SpinnerIcon,
  useChatContext,
  useHostArtifact,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useId, useMemo, useState } from "react";

import { WordDocumentPlanReview } from "./WordDocumentPlanReview";
import { WordReviewReceipt } from "./WordReviewReceipt";
import { WordSavedPlanPreview } from "./WordSavedPlanPreview";
import { useClientActionConfirmFlow } from "../../core/clientActions/useClientActionConfirmFlow";
import { useClientActionDecisions } from "../../core/clientActions/useClientActionDecisions";
import { useWordReviewFocus } from "../hooks/useWordReviewFocus";
import { useWordWrite } from "../providers/WordWriteProvider";
import {
  decisionKey,
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
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "../utils/wordDocumentPlan";
import { wordPlanDraftText } from "../utils/wordDocumentXml";
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
  const plan = useMemo(() => parseWordDocumentPlan(content), [content]);
  const gate = resolveWordWriteGate({
    capture,
    expectedIdentity: artifact?.itemIdentity,
    currentIdentity: host.documentIdentity,
  });
  const idle = review.status === "idle";
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
    gate.allowed &&
    snapshot?.ownerMessageId === messageId &&
    offered;
  const execute = useCallback(async () => {
    if (!ready || !capture || !host.beginOperation()) return false;
    host.updateReview(key, {
      status: "applying",
      capture,
      documentPlanDiagnostic: undefined,
    });
    try {
      const run = await entry.execute({
        fenceContent: content,
        capture,
        messageId,
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
        status: run.ok
          ? "done"
          : result?.status === "interrupted"
            ? "write-failed"
            : "error",
        documentPlanStatus: result?.status,
        documentPlanDiagnostic: result?.diagnostic,
        detailsExpanded: false,
        automatic:
          artifact?.clientActionPresentation === "auto_prompt" &&
          decisions[decisionKey(facetId, entry.action)] === "always" &&
          !enforcedAskActions.includes(entry.action),
      });
      return run.ok;
    } catch {
      host.updateReview(key, {
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
  const canRevert =
    ["done", "write-failed", "revert-failed"].includes(review.status) &&
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
    : review.documentPlanStatus === "stale"
      ? t({
          id: "officeAddin.word.authoring.stale",
          message:
            "The document changed. Nothing was applied. Send a new request to refresh the plan.",
        })
      : review.documentPlanStatus === "revert-stale"
        ? t({
            id: "officeAddin.word.authoring.revertStale",
            message:
              "The document changed after applying. Revert was not run because it could remove later edits.",
          })
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
            : review.status === "applying"
              ? t({
                  id: "officeAddin.word.authoring.applying",
                  message: "Applying and verifying the document rewrite…",
                })
              : review.status === "reverting"
                ? t({
                    id: "officeAddin.word.authoring.reverting",
                    message: "Checking and restoring the document…",
                  })
                : undefined;
  if (generating)
    return (
      <Card variant="surface" size="sm">
        <SpinnerIcon
          label={t({
            id: "officeAddin.word.authoring.preparing",
            message: "Preparing a complete document rewrite…",
          })}
        />
      </Card>
    );
  if (!plan)
    return <Alert type="error">{wordAuthoringIssueText("invalid")}</Alert>;
  return (
    <Card
      variant="surface"
      size="none"
      ref={cardRef}
      tabIndex={-1}
      role="region"
      aria-label={entry.displayLabel()}
      className="word-review focus-ring"
      data-testid="word-document-plan-card"
    >
      {collapsed && <WordReviewReceipt review={review} kind="plan" />}
      <div id={detailsId} hidden={collapsed}>
        {!snapshot && artifact?.submittedCard && (
          <WordSavedPlanPreview plan={plan} />
        )}
        {snapshot && (
          <WordDocumentPlanReview
            plan={plan}
            snapshot={snapshot}
            onLocate={
              idle && gate.allowed && !host.operationInProgress
                ? (ref) => void locate(ref)
                : undefined
            }
          />
        )}
        {idle &&
          (issue ||
            !gate.allowed ||
            !offered ||
            snapshot?.ownerMessageId !== messageId) && (
            <p className="word-review__notice" role="status">
              {issue
                ? wordAuthoringIssueText(issue, snapshot?.issueDetails)
                : !gate.allowed || snapshot?.ownerMessageId !== messageId
                  ? wordAuthoringIssueText("no-capture")
                  : t({
                      id: "officeAddin.word.authoring.notAllowed",
                      message:
                        "This action is unavailable under the current action settings.",
                    })}
            </p>
          )}
      </div>
      {status && !collapsed && (
        <p
          className="word-review__notice"
          role={
            review.status === "error" ||
            review.status === "write-failed" ||
            review.status === "revert-failed"
              ? "alert"
              : "status"
          }
        >
          {status}
        </p>
      )}
      {!collapsed &&
        (review.documentPlanDiagnostic?.officeCode ||
          review.documentPlanDiagnostic?.officeLocation) && (
          <p className="word-review__hint">
            {t({
              id: "officeAddin.word.authoring.wordDiagnostic",
              message: "Word diagnostic",
            })}
            {": "}
            {[
              review.documentPlanDiagnostic.officeCode,
              review.documentPlanDiagnostic.officeLocation,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      <div className="word-review__footer">
        {idle && offered && (
          <>
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.authoring.applyScope",
                message:
                  "Applies the complete structure and draft. If the source changed, the whole plan stops before writing.",
              })}
            </p>
            {!confirmCard && (
              <Button
                type="button"
                variant="primary"
                disabled={
                  !ready || host.operationInProgress || isConfirmPending
                }
                onClick={() => void execute()}
              >
                {entry.displayLabel()}
              </Button>
            )}
          </>
        )}
        {confirmCard && (
          <ActionConfirmationCard
            key={confirmCard.requestId}
            title={t({
              id: "officeAddin.word.authoring.consent",
              message: "Apply this document rewrite?",
            })}
            description={t({
              id: "officeAddin.word.authoring.consentScope",
              message: "Apply the entire structure and draft reviewed above.",
            })}
            allowOnceLabel={entry.displayLabel()}
            onAllowOnce={() => {
              if (ready && !host.operationInProgress) allowCard(confirmCard);
            }}
            onAlwaysAllow={() => {
              if (
                !ready ||
                host.operationInProgress ||
                enforcedAskActions.includes(entry.action)
              )
                return;
              setDecisions({
                ...decisions,
                [decisionKey(facetId, entry.action)]: "always",
              });
              allowCard(confirmCard);
            }}
            alwaysAllowDisabledReason={
              enforcedAskActions.includes(entry.action)
                ? t({
                    id: "officeAddin.word.card.alwaysAllowLocked",
                    message:
                      "Your organization requires confirmation each time this action runs automatically.",
                  })
                : undefined
            }
            onDeny={() => {
              denyCard(confirmCard);
              host.updateReview(key, { status: "denied", capture });
            }}
            isBusy={host.operationInProgress || !ready}
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
                host.updateReview(key, { detailsExpanded: collapsed })
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
          {canRevert && (
            <Button
              type="button"
              variant="secondary"
              disabled={host.operationInProgress}
              onClick={() => void revert()}
            >
              {review.status === "done"
                ? t({
                    id: "officeAddin.word.review.revertBatch",
                    message: "Revert batch",
                  })
                : recoverySlot && isWordDocumentBackup(recoverySlot.ooxml)
                  ? t({
                      id: "officeAddin.word.authoring.restoreDocument",
                      message: "Restore original document",
                    })
                  : t({
                      id: "officeAddin.word.authoring.restoreBody",
                      message: "Restore original body",
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
                    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        {copyNote && (
          <p role="status" className="word-review__hint">
            {copyNote}
          </p>
        )}
      </div>
    </Card>
  );
}
