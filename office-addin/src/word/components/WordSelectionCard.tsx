import {
  Button,
  Card,
  extractTextFromContent,
  TextComparison,
  useChatContext,
  useHostArtifact,
  WordReviewCard,
  WordReviewDetailsToggle,
  WordReviewGenerating,
  WordReviewHeader,
  WordUndoLine,
  wordUndoLabel,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useId, useMemo, useState } from "react";

import {
  isAutomaticWordRun,
  WordApplyButton,
  WordReviewConfirm,
  WordStatusAlert,
} from "./WordReviewCardParts";
import { wordDeniedText, WordReviewReceipt } from "./WordReviewReceipt";
import { WordShowInWordButton } from "./WordShowInWordButton";
import { useClientActionConfirmFlow } from "../../core/clientActions/useClientActionConfirmFlow";
import { useClientActionDecisions } from "../../core/clientActions/useClientActionDecisions";
import { useWordReviewFocus } from "../hooks/useWordReviewFocus";
import { wordSelectionStore } from "../hooks/wordSelectionStore";
import { useWordWrite } from "../providers/WordWriteProvider";
import {
  isActionDenied,
  wordClientActionDecisionStore,
} from "../utils/clientActionPolicy";
import { revertWordSelection } from "../utils/wordReplaceSelection";
import { EMPTY_WORD_REVIEW } from "../utils/wordReviewState";
import {
  rewritableWordSelection,
  wordSelectionOf,
} from "../utils/wordSelectionAnchor";
import { splitWordSelectionReplacement } from "../utils/wordSelectionEdit";
import {
  showWordSelection,
  showWrittenWordSelection,
} from "../utils/wordSelectionTarget";
import { resolveWordWriteGate } from "../utils/wordWriteGate";

import type {
  WordClientAction,
  WordClientActionEntry,
} from "../utils/wordClientActions";
import type { WordReplaceSelectionResult } from "../utils/wordReplaceSelection";
import type { WordReviewState } from "../utils/wordReviewState";
import type { WordSelectionReasonCode } from "../utils/wordSelectionAnchor";

/** V2-4: why this selection can only be context, one message per kind of reason. */
export function wordSelectionReasonText(
  code: WordSelectionReasonCode | null,
): string {
  switch (code) {
    case "host_unsupported":
      return t({
        id: "officeAddin.word.selection.reason.host",
        message: "This version of Word cannot replace a selected passage.",
      });
    case "other_story":
      return t({
        id: "officeAddin.word.selection.reason.story",
        message:
          "Text in headers, footers, notes and text boxes is only used as context.",
      });
    case "whole_table":
    case "multi_cell":
    case "nested_table":
    case "cell_multi_paragraph":
      return t({
        id: "officeAddin.word.selection.reason.table",
        message:
          "Select one paragraph outside the table to have it replaced. Tables are only used as context.",
      });
    case "too_many_paragraphs":
    case "too_large":
      return t({
        id: "officeAddin.word.selection.reason.size",
        message:
          "This selection is too long to replace in one go. Select a shorter passage.",
      });
    case "tracked_changes":
      return t({
        id: "officeAddin.word.selection.reason.tracked",
        message:
          "Accept or reject the tracked changes in this passage first, then select it again.",
      });
    case "hyperlink":
    case "field":
    case "content_control":
    case "hidden_text":
    case "note_reference":
    case "comment_mark":
    case "inline_picture":
    case "line_break":
    case "special_character":
      return t({
        id: "officeAddin.word.selection.reason.content",
        message:
          "This passage holds a link, field, comment, note, picture or other content a rewrite would lose.",
      });
    case "unsupported_formatting":
    case "mixed_formatting":
    case "complex_script_format":
    case "style_font_unavailable":
      return t({
        id: "officeAddin.word.selection.reason.formatting",
        message: "This passage has formatting a rewrite could not keep.",
      });
    case "web_picture_offset":
      return t({
        id: "officeAddin.word.selection.reason.webPicture",
        message:
          "In Word for the web, text after a picture in the same paragraph cannot be replaced.",
      });
    case "shape_not_enabled":
      return t({
        id: "officeAddin.word.selection.reason.shape",
        message:
          "Erato can only replace a whole paragraph so far. Select the whole paragraph to have it replaced.",
      });
    default:
      return t({
        id: "officeAddin.word.selection.reason.position",
        message:
          "Erato cannot pinpoint this passage in the document, so it cannot replace it safely.",
      });
  }
}

const notRespondingText = () =>
  t({
    id: "officeAddin.word.selection.notResponding",
    message: "Word is not responding. Reload the add-in pane if this persists.",
  });

const trackedText = () =>
  t({
    id: "officeAddin.word.selection.appliedTracked",
    message:
      "Track Changes is on, so the replacement is a tracked change. Reject it in Word to undo it.",
  });

const staleText = () =>
  t({
    id: "officeAddin.word.selection.stale",
    message: "This passage changed after your request. Nothing was replaced.",
  });

/** The message for a Replace that did not plainly succeed. */
function resultText(
  result: WordReplaceSelectionResult,
  tracking: boolean,
): string | undefined {
  switch (result.status) {
    case "applied":
      return tracking ? trackedText() : undefined;
    case "unchanged":
      return undefined;
    case "failed":
      return result.timedOut
        ? t({
            id: "officeAddin.word.selection.timedOut",
            message: "Word did not answer in time. Nothing was replaced.",
          })
        : t({
            id: "officeAddin.word.selection.failed",
            message: "Word did not accept the change. Nothing was replaced.",
          });
    case "unverified":
      return t({
        id: "officeAddin.word.selection.unverified",
        message:
          "Word may have replaced the passage, but the result could not be checked. Look at the document before continuing; Word's own Undo removes the change.",
      });
    case "refused":
      switch (result.code) {
        case "UNSUPPORTED_CONTENT":
          return t({
            id: "officeAddin.word.selection.unsupported",
            message:
              "The passage now holds content or formatting a rewrite would lose. Nothing was replaced.",
          });
        case "PARAGRAPH_COUNT_MISMATCH":
          return t({
            id: "officeAddin.word.selection.lineCount",
            message:
              "The proposal does not have one line per selected paragraph. Nothing was replaced.",
          });
        case "INVALID_REPLACEMENT":
          return t({
            id: "officeAddin.word.selection.invalid",
            message:
              "The proposal is empty or holds characters Word does not keep as text. Nothing was replaced.",
          });
        default:
          return staleText();
      }
  }
}

function statusOf(
  result: WordReplaceSelectionResult,
): WordReviewState["status"] {
  switch (result.status) {
    case "applied":
    case "unchanged":
      return "done";
    case "unverified":
      return "write-failed";
    default:
      return "error";
  }
}

const isStale = (result: WordReplaceSelectionResult | undefined) =>
  result?.status === "refused" &&
  [
    "TARGET_TEXT_MISMATCH",
    "TARGET_NOT_FOUND",
    "AMBIGUOUS_TARGET",
    "HINT_CONFLICT",
  ].includes(result.code);

/**
 * The review card for a rewrite of the user's selection: the passage as it was when requested
 * against the proposal, and Replace, which writes only onto that passage once it is proven
 * unchanged. Without a rewritable capture (another document, a reloaded pane, a context-only
 * selection) the proposal can still be copied.
 */
export function WordSelectionCard({
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
    holdOperationUntil,
    heldOperationOwner,
    restoreRequest,
  } = useWordWrite();
  const [decisions, setDecisions] = useClientActionDecisions(
    wordClientActionDecisionStore,
  );
  const facetId = artifact?.facetId ?? "";
  const messageId = artifact?.messageId;
  const { messages } = useChatContext();
  const message = messageId ? messages[messageId] : undefined;
  const isGenerating = message?.status === "sending";
  const batchKey = `${messageId ?? ""}:${entry.action}:${content}`;
  const review = reviews.get(batchKey) ?? EMPTY_WORD_REVIEW;
  const result = review.selection;
  const cardRef = useWordReviewFocus(
    `${review.status}:${!!review.detailsExpanded}`,
  );
  const detailsId = useId();
  const [revertConfirmation, setRevertConfirmation] = useState(false);
  const [copyNote, setCopyNote] = useState("");
  const capture =
    (messageId ? capturesByAssistantMessageId.get(messageId) : undefined) ??
    review.capture;
  const selection = wordSelectionOf(capture);
  const rewritable = rewritableWordSelection(capture);
  const enforcedAskActions = useMemo(
    () => artifact?.alwaysAskClientActions ?? [],
    [artifact],
  );
  const gate = resolveWordWriteGate({
    capture,
    expectedIdentity: artifact?.itemIdentity,
    currentIdentity: documentIdentity,
  });
  const replacement = useMemo(
    () =>
      rewritable
        ? splitWordSelectionReplacement(
            content,
            rewritable.shape,
            rewritable.paragraphCount,
          )
        : null,
    [content, rewritable],
  );
  const proposal =
    replacement && "lines" in replacement
      ? replacement.lines.join("\n")
      : content.replace(/\n$/, "");
  const offeredActions = useMemo(
    () =>
      rewritable && replacement && "lines" in replacement
        ? (artifact?.allowedClientActions ?? []).filter(
            (action): action is WordClientAction =>
              action === entry.action &&
              !isActionDenied({
                facetId,
                action,
                decisions,
                enforcedAskActions,
              }),
          )
        : [],
    [
      rewritable,
      replacement,
      artifact,
      entry.action,
      facetId,
      decisions,
      enforcedAskActions,
    ],
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
  const applying = review.status === "applying";

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
      isGenerating ||
      offeredActions.length === 0 ||
      !idle ||
      !beginOperation()
    )
      return false;
    updateReview(batchKey, {
      status: "applying",
      applyStage: "checking",
      capture: live.capture,
    });
    let held = false;
    try {
      const run = await entry.execute({
        fenceContent: content,
        capture: live.capture,
        onStage: (applyStage) => updateReview(batchKey, { applyStage }),
      });
      const outcome = run.selectionResult;
      if (!outcome) {
        updateReview(batchKey, { status: "error", applyStage: undefined });
        return false;
      }
      if (
        (outcome.status === "failed" || outcome.status === "unverified") &&
        outcome.timedOut
      ) {
        held = true;
        holdOperationUntil(outcome.settled, batchKey);
      }
      // An earlier Undo would restore a paragraph as it was before this write, which this card's
      // single slot no longer promises.
      if (
        outcome.status === "unverified" ||
        (outcome.status === "applied" && !outcome.backup)
      )
        setRevertSlot(null);
      if (outcome.status === "applied") {
        if (outcome.backup && messageId)
          setRevertSlot({
            messageId,
            batchKey,
            identity: live.capture.identity,
            ooxml: outcome.backup.ooxml,
            selection: {
              written: outcome.written,
              rangeText: outcome.backup.rangeText,
            },
          });
        wordSelectionStore.requestRefresh();
      }
      updateReview(batchKey, {
        status: statusOf(outcome),
        applyStage: undefined,
        detailsExpanded: false,
        selection: outcome,
        tracking:
          outcome.status === "applied" && outcome.trackingOn ? "on" : "off",
        automatic: isAutomaticWordRun({
          presentation: artifact?.clientActionPresentation,
          decisions,
          facetId,
          action: entry.action,
          enforcedAskActions,
        }),
      });
      return outcome.status === "applied";
    } finally {
      if (!held) endOperation();
    }
  }, [
    capture,
    artifact,
    documentIdentity,
    updateReview,
    batchKey,
    isGenerating,
    offeredActions.length,
    idle,
    beginOperation,
    entry,
    content,
    holdOperationUntil,
    messageId,
    setRevertSlot,
    decisions,
    facetId,
    enforcedAskActions,
    endOperation,
  ]);
  const buildSummary = useCallback(
    () => (idle && !isGenerating ? proposal : null),
    [idle, isGenerating, proposal],
  );
  const { confirmCard, isConfirmPending, allowCard, denyCard } =
    useClientActionConfirmFlow<string, WordClientAction>({
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

  const slot = useMemo(
    () =>
      revertSlot?.selection &&
      revertSlot.messageId === messageId &&
      revertSlot.batchKey === batchKey &&
      revertSlot.identity === documentIdentity
        ? { ...revertSlot, selection: revertSlot.selection }
        : null,
    [revertSlot, messageId, batchKey, documentIdentity],
  );
  const handleRevert = useCallback(async () => {
    if (!slot || !beginOperation()) return;
    setRevertConfirmation(false);
    updateReview(batchKey, { status: "reverting", revertStale: undefined });
    let held = false;
    try {
      const reverted = await revertWordSelection(
        { ooxml: slot.ooxml, rangeText: slot.selection.rangeText },
        slot.selection.written,
      );
      if (reverted.timedOut) {
        held = true;
        holdOperationUntil(reverted.settled, batchKey);
      }
      if (reverted.status === "stale" || reverted.status === "tracking") {
        updateReview(batchKey, {
          status: "done",
          revertStale: reverted.status === "tracking" ? "tracking" : "changed",
          detailsExpanded: true,
        });
        return;
      }
      if (reverted.status === "failed") {
        updateReview(batchKey, { status: "done", detailsExpanded: true });
        return;
      }
      setRevertSlot(null);
      wordSelectionStore.requestRefresh();
      updateReview(batchKey, {
        status: reverted.status === "reverted" ? "reverted" : "revert-failed",
        detailsExpanded: false,
      });
    } finally {
      if (!held) endOperation();
    }
  }, [
    slot,
    beginOperation,
    updateReview,
    batchKey,
    holdOperationUntil,
    setRevertSlot,
    endOperation,
  ]);

  const show = useCallback(
    async (locate: () => ReturnType<typeof showWordSelection>) => {
      if (!beginOperation()) return "unavailable" as const;
      try {
        return await locate();
      } finally {
        endOperation();
      }
    },
    [beginOperation, endOperation],
  );
  const useCurrentSelection = () => {
    const request = message?.previous_message_id
      ? extractTextFromContent(messages[message.previous_message_id]?.content)
      : "";
    restoreRequest(request ?? "");
    wordSelectionStore.requestRefresh({ rearm: true });
  };
  const copyProposal = () => {
    setCopyNote("");
    const failed = () =>
      setCopyNote(
        t({
          id: "officeAddin.word.selection.copyFailed",
          message: "Copying failed. Select the text and copy it instead.",
        }),
      );
    if (!navigator.clipboard) {
      failed();
      return;
    }
    try {
      void navigator.clipboard.writeText(proposal).then(
        () =>
          setCopyNote(
            t({
              id: "officeAddin.word.selection.copied",
              message: "Copied the proposal.",
            }),
          ),
        failed,
      );
    } catch {
      failed();
    }
  };

  if (isGenerating)
    return (
      <WordReviewGenerating
        label={t({
          id: "officeAddin.word.selection.preparing",
          message: "Preparing rewrite…",
        })}
      />
    );

  const applied = result?.status === "applied" ? result : undefined;
  const statusMessage =
    heldOperationOwner === batchKey &&
    (applying || review.status === "error" || review.status === "write-failed")
      ? notRespondingText()
      : review.revertStale && review.status !== "reverting"
        ? review.revertStale === "changed"
          ? t({
              id: "officeAddin.word.selection.revertStale",
              message:
                "The passage changed after it was replaced. Undo was not run because it would remove later edits.",
            })
          : t({
              id: "officeAddin.word.selection.revertTracking",
              message:
                "Undo was not run because Track Changes is on. Reject the change in Word instead.",
            })
        : review.status === "reverting"
          ? t({
              id: "officeAddin.word.selection.reverting",
              message: "Restoring the passage…",
            })
          : review.status === "revert-failed"
            ? t({
                id: "officeAddin.word.selection.revertFailed",
                message:
                  "The passage could not be restored with certainty. Check it in Word; Word's own Undo may still help.",
              })
            : review.status === "denied"
              ? wordDeniedText()
              : result
                ? resultText(result, applied?.trackingOn ?? false)
                : !capture
                  ? t({
                      id: "officeAddin.word.selection.noCapture",
                      message:
                        "This pane no longer holds the passage this answer was written for. Copy the proposal, or select the passage and ask again.",
                    })
                  : !gate.allowed
                    ? t({
                        id: "officeAddin.word.selection.otherDocument",
                        message:
                          "This answer was written for a passage in another document, so it cannot be replaced here.",
                      })
                    : selection && !rewritable
                      ? wordSelectionReasonText(selection.reasonCode)
                      : replacement && "refused" in replacement
                        ? resultText(
                            {
                              status: "refused",
                              code: replacement.refused,
                              settled: Promise.resolve(),
                            },
                            false,
                          )
                        : undefined;
  const completed =
    review.status === "done" ||
    review.status === "denied" ||
    review.status === "reverted";
  const collapsed = completed && !review.detailsExpanded && !review.revertStale;
  const canReplace = gate.allowed && idle && offeredActions.length > 0;
  const showTarget = () =>
    show(() =>
      showWordSelection(rewritable!, capture!.identity, documentIdentity),
    );
  const showWritten = () =>
    show(() =>
      showWrittenWordSelection(
        applied!.written,
        capture!.identity,
        documentIdentity,
      ),
    );
  const title = t({
    id: "officeAddin.word.selection.title",
    message: "Rewrite of the selected passage",
  });

  return (
    <WordReviewCard
      cardRef={cardRef}
      label={entry.displayLabel()}
      testId="word-selection-card"
      collapsed={collapsed}
      detailsId={detailsId}
      status={
        statusMessage && (
          <WordStatusAlert status={review.status}>
            {statusMessage}
          </WordStatusAlert>
        )
      }
      receipt={
        <WordReviewReceipt
          review={review}
          kind="selection"
          title={title}
          note={applied?.trackingOn ? trackedText() : ""}
        />
      }
      footer={
        <>
          {(idle || applying) && offeredActions.length > 0 && (
            <>
              <p className="word-review__hint">
                {t({
                  id: "officeAddin.word.selection.scope",
                  message:
                    "Replace writes only onto the passage you selected, and only if it is unchanged since your request.",
                })}
              </p>
              {!confirmCard && (
                <WordApplyButton
                  applying={applying}
                  applyStage={review.applyStage}
                  disabled={
                    operationInProgress || isConfirmPending || !canReplace
                  }
                  label={t({
                    id: "officeAddin.word.selection.replace",
                    message: "Replace",
                  })}
                  onApply={() => void execute()}
                />
              )}
            </>
          )}
          {confirmCard && (
            <WordReviewConfirm
              key={confirmCard.requestId}
              card={confirmCard}
              title={t({
                id: "officeAddin.word.selection.consent",
                message: "Replace the selected passage?",
              })}
              allowOnceLabel={t({
                id: "officeAddin.word.selection.replace",
                message: "Replace",
              })}
              canApply={canReplace}
              operationInProgress={operationInProgress}
              enforcedAskActions={enforcedAskActions}
              decisions={decisions}
              setDecisions={setDecisions}
              facetId={facetId}
              allowCard={allowCard}
              denyCard={denyCard}
              onDenied={() =>
                updateReview(batchKey, { status: "denied", capture })
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
                  updateReview(batchKey, { detailsExpanded: collapsed })
                }
              />
            )}
            {isStale(result) && (
              <Button
                type="button"
                variant="secondary"
                disabled={operationInProgress}
                onClick={useCurrentSelection}
              >
                {t({
                  id: "officeAddin.word.selection.useCurrent",
                  message: "Use current selection",
                })}
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={copyProposal}>
              {t({
                id: "officeAddin.word.selection.copy",
                message: "Copy proposal",
              })}
            </Button>
          </div>
          {copyNote && (
            <p className="word-review__hint" role="status">
              {copyNote}
            </p>
          )}
          <WordUndoLine
            canRevert={!!slot && review.status === "done"}
            label={wordUndoLabel()}
            disabled={operationInProgress}
            onUndo={() => setRevertConfirmation(true)}
            testId="word-selection-undo"
          />
          {applied && slot && (
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.selection.undoReplaced",
                message: "Applying another change ends this Undo.",
              })}
            </p>
          )}
          {revertConfirmation && (
            <Card
              variant="surface"
              tone="warning"
              size="sm"
              nested
              bodyClassName="word-review__revert"
              role="group"
              aria-label={t({
                id: "officeAddin.word.selection.revertTitle",
                message: "Restore the passage?",
              })}
            >
              <strong>
                {t({
                  id: "officeAddin.word.selection.revertWarning",
                  message:
                    "Restore the passage as it was before this Replace? Nothing is restored if it changed since.",
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
                  disabled={operationInProgress || !slot}
                  onClick={() => void handleRevert()}
                >
                  {t({
                    id: "officeAddin.word.selection.restore",
                    message: "Restore passage",
                  })}
                </Button>
              </div>
            </Card>
          )}
        </>
      }
    >
      <WordReviewHeader title={title}>
        {rewritable && gate.allowed && (idle || applying) && (
          <WordShowInWordButton
            onShow={showTarget}
            disabled={operationInProgress}
          />
        )}
        {applied && gate.allowed && review.status === "done" && (
          <WordShowInWordButton
            onShow={showWritten}
            disabled={operationInProgress}
          />
        )}
        <p className="word-review__comparison-label">
          {t({
            id: "officeAddin.word.selection.comparisonLabel",
            message: "Selection when requested → proposed replacement",
          })}
        </p>
        <TextComparison
          original={selection?.selectedText ?? null}
          proposed={proposal}
        />
      </WordReviewHeader>
    </WordReviewCard>
  );
}
