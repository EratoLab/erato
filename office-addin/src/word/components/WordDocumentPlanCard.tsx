import {
  ActionConfirmationCard,
  Button,
  Card,
  Alert,
  CopyErrorButton,
  SpinnerIcon,
  useChatContext,
  useHostArtifact,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useId, useMemo, useState } from "react";

import { WordDocumentPlanReview } from "./WordDocumentPlanReview";
import { WordReviewReceipt } from "./WordReviewReceipt";
import { WordSavedPlanPreview } from "./WordSavedPlanPreview";
import { WordScopedPlanReview } from "./WordScopedPlanReview";
import { useClientActionConfirmFlow } from "../../core/clientActions/useClientActionConfirmFlow";
import { useClientActionDecisions } from "../../core/clientActions/useClientActionDecisions";
import { useWordReviewFocus } from "../hooks/useWordReviewFocus";
import { useWordWrite } from "../providers/WordWriteProvider";
import {
  decisionKey,
  isActionDenied,
  wordClientActionDecisionStore,
} from "../utils/clientActionPolicy";
import {
  renderWordDiagnosticReport,
  renderWordOutcomeReport,
} from "../utils/wordApplyDiagnostics";
import {
  revertWordDocumentPlan,
  wordRevertMechanism,
} from "../utils/wordApplyDocumentPlan";
import {
  wordApplyAdjustmentText,
  wordApplyStageLabel,
  wordAuthoringIssueText,
  wordDocumentDiagnosticText,
  wordPartlyWrittenText,
  wordPlanAdjustedText,
  wordRoutePreviewText,
  wordTrackedApplyText,
  wordUnverifiedPassagesText,
} from "../utils/wordAuthoringMessages";
import { offerableWordClientActionsForFacet } from "../utils/wordClientActions";
import {
  decodeWordDocumentBackup,
  decodeWordInPlaceBackup,
  isWordDocumentBackup,
} from "../utils/wordDocumentPackage";
import {
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "../utils/wordDocumentPlan";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  wordPlanDraftText,
} from "../utils/wordDocumentXml";
import { WORD_VISIBLE_ADJUSTMENTS } from "../utils/wordFullDocumentComparison";
import { wordInPlaceCapabilities } from "../utils/wordInPlaceCapabilities";
import {
  routeWordDocumentPlan,
  wordPlanPassages,
} from "../utils/wordInPlaceRoute";
import { wordInPlaceAvailability } from "../utils/wordInPlaceSwitch";
import {
  showWordParagraphs,
  showWordReviewLocation,
  wordInPlaceMismatchedParagraphs,
  wordInPlaceRegionOf,
  wordInPlaceWrittenRegions,
} from "../utils/wordReviewLocation";
import {
  EMPTY_WORD_REVIEW,
  wordMismatchedPassages,
  wordPlanOutcomeState,
} from "../utils/wordReviewState";
import { resolveWordWriteGate } from "../utils/wordWriteGate";

import type {
  WordClientAction,
  WordClientActionEntry,
} from "../utils/wordClientActions";
import type { WordInPlaceBackup } from "../utils/wordDocumentPackage";
import type { WordDocumentPlan } from "../utils/wordDocumentPlan";

export function WordDocumentPlanCard({
  entry,
  content,
}: {
  entry: WordClientActionEntry;
  content: string;
}) {
  const artifact = useHostArtifact();
  const { messages, currentChatId } = useChatContext();
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
  const scoped = !!(plan && snapshot?.readScopes?.has(plan.readToken));
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
    gate.allowed &&
    snapshot?.ownerMessageId === messageId &&
    offered;
  const availability = wordInPlaceAvailability();
  const unavailable = availability.enabled ? undefined : availability.reason;
  const routePreview = useMemo(() => {
    if (!ready || !plan || !snapshot) return undefined;
    try {
      const compiled = captureWordAuthoringSnapshot(
        compileWordDocumentPlan(plan, snapshot),
        snapshot.identity,
        "Off",
        snapshot.fullDocument,
        "verify",
      );
      if (compiled.issue) return undefined;
      return wordRoutePreviewText(
        routeWordDocumentPlan(
          plan,
          snapshot,
          unavailable
            ? { enabled: false, reason: unavailable }
            : { enabled: true },
          wordInPlaceCapabilities(),
          compiled,
        ),
        wordPlanPassages(plan),
      );
    } catch {
      return undefined;
    }
  }, [ready, plan, snapshot, unavailable]);
  const execute = useCallback(async () => {
    if (!ready || !capture || !host.beginOperation()) return false;
    host.updateReview(key, {
      status: "applying",
      applyStage: "checking",
      capture,
      documentPlanDiagnostic: undefined,
      documentPlanOutcome: undefined,
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
        documentPlanOutcome: result?.outcome,
        detailsExpanded: false,
        automatic:
          artifact?.clientActionPresentation === "auto_prompt" &&
          decisions[decisionKey(facetId, entry.action)] === "always" &&
          !enforcedAskActions.includes(entry.action),
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
  const slotOoxml = recoverySlot?.ooxml;
  const slotAfter = recoverySlot?.afterFingerprint;
  const written = useMemo(() => {
    if (!slotOoxml) return undefined;
    let record: WordInPlaceBackup | undefined;
    try {
      record = isWordDocumentBackup(slotOoxml)
        ? decodeWordInPlaceBackup(slotOoxml).inPlace
        : undefined;
    } catch {
      record = undefined;
    }
    return { mechanism: wordRevertMechanism(slotOoxml, slotAfter), record };
  }, [slotOoxml, slotAfter]);
  const writtenRecord =
    written?.mechanism === "in-place" || written?.mechanism === "tracked"
      ? written.record
      : undefined;
  const writtenRegions = writtenRecord
    ? wordInPlaceWrittenRegions(writtenRecord)
    : [];
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
      // Only a strict match equals the backup; after a content-tier restore it stays downloadable.
      if (result.status === "reverted" && result.outcome?.tier === "strict")
        host.setRevertSlot(null);
      else if (result.status === "reverted")
        host.setRevertSlot({ ...slot, afterFingerprint: undefined });
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
        ...(result.status === "reverted"
          ? { documentPlanOutcome: result.outcome }
          : {}),
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
  const cannotLocate = () =>
    setCopyNote(
      t({
        id: "officeAddin.word.authoring.locationChanged",
        message:
          "This source passage has changed or cannot be located reliably.",
      }),
    );
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
      if (result !== "selected") cannotLocate();
    } finally {
      host.endOperation();
    }
  };
  /** After an in-place write, by the paragraph IDs it recorded; `tracked` selects its first revision. */
  const showWritten = async (ids: readonly string[], tracked = false) => {
    if (!recoverySlot || !host.beginOperation()) return;
    setCopyNote("");
    try {
      const result = await showWordParagraphs(
        ids,
        recoverySlot.identity,
        host.documentIdentity,
        tracked,
      );
      if (result !== "selected") cannotLocate();
    } finally {
      host.endOperation();
    }
  };
  const copyText = (text: string, copied: string, failedText: string) => {
    setCopyNote("");
    const failed = () => setCopyNote(failedText);
    if (!navigator.clipboard) {
      failed();
      return;
    }
    try {
      void navigator.clipboard
        .writeText(text)
        .then(() => setCopyNote(copied), failed);
    } catch {
      failed();
    }
  };
  const completed = ["done", "denied", "reverted"].includes(review.status);
  const collapsed = completed && !review.detailsExpanded;
  const outcomeState = wordPlanOutcomeState(review);
  // Only the Apply's own result: a later Revert attempt replaces the diagnostic.
  const applyStopped =
    review.status === "write-failed" &&
    review.documentPlanStatus === "interrupted";
  const mismatches = applyStopped
    ? wordMismatchedPassages(review.documentPlanDiagnostic)
    : 0;
  const partial = review.documentPlanDiagnostic?.details?.partial;
  const mismatchedParagraphs =
    applyStopped && outcomeState === "unverified" && written?.record
      ? wordInPlaceMismatchedParagraphs(written.record)
      : [];
  const status =
    applyStopped &&
    outcomeState === "unverified" &&
    review.documentPlanDiagnostic?.reason === "output-mismatch" &&
    mismatches
      ? wordUnverifiedPassagesText(mismatches)
      : applyStopped &&
          outcomeState === "partly-written" &&
          partial &&
          partial.applied + partial.untouched > 0
        ? wordPartlyWrittenText(
            partial.applied,
            partial.applied + partial.untouched,
          )
        : review.documentPlanDiagnostic
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
              : review.status === "write-failed" ||
                  review.status === "revert-failed"
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
  const adjustedOutcome =
    ["done", "reverted"].includes(review.status) &&
    review.documentPlanOutcome?.tier === "content"
      ? review.documentPlanOutcome
      : undefined;
  const adjustmentNote = [
    ...(review.status === "done" && review.documentPlanOutcome?.tracked
      ? [wordTrackedApplyText()]
      : []),
    ...(outcomeState === "adjusted" ? [wordPlanAdjustedText()] : []),
    ...(["done", "reverted"].includes(review.status)
      ? (review.documentPlanOutcome?.adjustments ?? [])
          .filter((code) => WORD_VISIBLE_ADJUSTMENTS.includes(code))
          .map(wordApplyAdjustmentText)
          .filter(Boolean)
      : []),
  ].join(" ");
  const reverting =
    review.status === "revert-failed" ||
    review.documentPlanStatus === "revert-stale";
  const errorReport =
    review.documentPlanDiagnostic ||
    ["error", "write-failed", "revert-failed"].includes(review.status)
      ? renderWordDiagnosticReport(
          reverting ? "revert" : "apply",
          review.documentPlanStatus ?? review.status,
          review.documentPlanDiagnostic,
        )
      : undefined;
  if (generating)
    return (
      <Card variant="surface" size="sm">
        <SpinnerIcon
          label={t({
            id: "officeAddin.word.authoring.preparing",
            message: "Preparing document changes…",
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
      footer={
        <div className="word-review__footer">
          {(idle || applying) && offered && (
            <>
              <p className="word-review__hint">
                {scoped
                  ? t({
                      id: "officeAddin.word.scoped.applyScope",
                      message:
                        "Applies the reviewed changes. If the document changed, nothing is applied.",
                    })
                  : t({
                      id: "officeAddin.word.authoring.applyScope",
                      message:
                        "Applies the complete structure and draft. If the source changed, the whole plan stops before writing.",
                    })}
              </p>
              {routePreview && idle && (
                <p className="word-review__hint" data-testid="word-plan-route">
                  {routePreview}
                </p>
              )}
              {!confirmCard && (
                // Busy rather than disabled keeps focus on the button while Word works.
                <Button
                  type="button"
                  variant="primary"
                  busy={applying}
                  aria-disabled={applying || undefined}
                  disabled={
                    !applying &&
                    (!ready || host.operationInProgress || isConfirmPending)
                  }
                  onClick={applying ? undefined : () => void execute()}
                >
                  {applying
                    ? wordApplyStageLabel(review.applyStage)
                    : entry.displayLabel()}
                </Button>
              )}
            </>
          )}
          {confirmCard && (
            <ActionConfirmationCard
              key={confirmCard.requestId}
              title={
                scoped
                  ? t({
                      id: "officeAddin.word.scoped.consent",
                      message: "Apply these changes?",
                    })
                  : t({
                      id: "officeAddin.word.authoring.consent",
                      message: "Apply this document rewrite?",
                    })
              }
              description={
                scoped
                  ? t({
                      id: "officeAddin.word.scoped.consentScope",
                      message: "Apply the selected changes reviewed above.",
                    })
                  : t({
                      id: "officeAddin.word.authoring.consentScope",
                      message:
                        "Apply the entire structure and draft reviewed above.",
                    })
              }
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
              progressLabel={
                applying ? wordApplyStageLabel(review.applyStage) : undefined
              }
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
                onClick={() =>
                  copyText(
                    wordPlanDraftText(plan, snapshot),
                    t({
                      id: "officeAddin.word.authoring.copied",
                      message: "Draft copied.",
                    }),
                    t({
                      id: "officeAddin.word.authoring.copyFailed",
                      message: "The draft could not be copied.",
                    }),
                  )
                }
              >
                {t({
                  id: "officeAddin.word.authoring.copy",
                  message: "Copy draft",
                })}
              </Button>
            )}
            {adjustedOutcome && (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  copyText(
                    renderWordOutcomeReport(
                      review.status === "reverted" ? "revert" : "apply",
                      adjustedOutcome,
                    ),
                    t({
                      id: "officeAddin.word.authoring.detailsCopied",
                      message: "Details copied.",
                    }),
                    t({
                      id: "officeAddin.word.authoring.detailsCopyFailed",
                      message: "The details could not be copied.",
                    }),
                  )
                }
              >
                {t({
                  id: "officeAddin.word.authoring.copyDetails",
                  message: "Copy details",
                })}
              </Button>
            )}
            {review.status === "done" && writtenRegions.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                disabled={host.operationInProgress}
                onClick={() =>
                  void showWritten(
                    writtenRegions[0],
                    written?.mechanism === "tracked",
                  )
                }
              >
                {t({
                  id: "officeAddin.word.authoring.showChanges",
                  message: "Show changes in Word",
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
                {written?.mechanism === "in-place"
                  ? t({
                      id: "officeAddin.word.authoring.undoChanges",
                      message: "Undo these changes",
                    })
                  : written?.mechanism === "tracked"
                    ? t({
                        id: "officeAddin.word.authoring.rejectTracked",
                        message: "Reject these tracked changes",
                      })
                    : written?.mechanism === "import"
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
          {copyNote && (
            <p role="status" className="word-review__hint">
              {copyNote}
            </p>
          )}
        </div>
      }
    >
      {collapsed && <WordReviewReceipt review={review} kind="plan" />}
      <div id={detailsId} hidden={collapsed}>
        {!snapshot && artifact?.submittedCard && (
          <WordSavedPlanPreview plan={plan} />
        )}
        {snapshot && scoped && (
          <WordScopedPlanReview
            plan={plan}
            snapshot={snapshot}
            onLocate={
              host.operationInProgress
                ? undefined
                : idle && gate.allowed
                  ? (ref) => void locate(ref)
                  : review.status === "done" && writtenRecord
                    ? (ref) => {
                        const ids = wordInPlaceRegionOf(writtenRecord, ref);
                        if (ids) void showWritten(ids);
                        else cannotLocate();
                      }
                    : undefined
            }
          />
        )}
        {snapshot && (
          <details open={!scoped}>
            {scoped && (
              <summary>
                {t({
                  id: "officeAddin.word.scoped.details",
                  message: "Complete document preview",
                })}
              </summary>
            )}
            <WordDocumentPlanReview
              plan={plan}
              snapshot={snapshot}
              onLocate={
                idle && gate.allowed && !host.operationInProgress
                  ? (ref) => void locate(ref)
                  : undefined
              }
            />
          </details>
        )}
        {idle &&
          (issue ||
            !gate.allowed ||
            !offered ||
            snapshot?.ownerMessageId !== messageId) && (
            <Alert
              type="info"
              role="status"
              className="m-3 [overflow-wrap:anywhere]"
            >
              {issue
                ? wordAuthoringIssueText(issue, snapshot?.issueDetails)
                : !gate.allowed || snapshot?.ownerMessageId !== messageId
                  ? wordAuthoringIssueText("no-capture")
                  : t({
                      id: "officeAddin.word.authoring.notAllowed",
                      message:
                        "This action is unavailable under the current action settings.",
                    })}
            </Alert>
          )}
      </div>
      {adjustmentNote && (
        <p
          className="word-review__hint m-3"
          data-testid="word-plan-adjustments"
        >
          {adjustmentNote}
        </p>
      )}
      {status && !collapsed && (
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
          {status}
        </Alert>
      )}
      {!collapsed && mismatchedParagraphs.length > 0 && (
        <div className="word-review__actions m-3 mt-0">
          {mismatchedParagraphs.map((id, i) => (
            <Button
              key={id}
              type="button"
              variant="secondary"
              size="sm"
              disabled={host.operationInProgress}
              onClick={() => void showWritten([id])}
            >
              {t({
                id: "officeAddin.word.scoped.locate",
                message: `Locate passage ${i + 1}`,
              })}
            </Button>
          ))}
        </div>
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
      {!collapsed && status && errorReport && (
        <div className="m-3 mt-0">
          <CopyErrorButton
            error={errorReport}
            reportOptions={{ chatId: currentChatId }}
          />
        </div>
      )}
    </Card>
  );
}
