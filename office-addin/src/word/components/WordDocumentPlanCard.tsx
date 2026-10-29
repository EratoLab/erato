import {
  Button,
  Alert,
  CopyErrorButton,
  extractTextFromContent,
  useChatSession,
  useConversationSelector,
  useHostArtifact,
  useWordMessageLineage,
  WordProposalCard,
  WordReviewGenerating,
  WordUndoLine,
  wordPlanApplyLabel,
  wordPlanTitleText,
  wordUndoLabel,
} from "@erato/frontend/library";
import {
  buildWordPlanReview,
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordHistoryProposal,
} from "@erato/frontend/word-review";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WordImportConfirm, WordImportRefusal } from "./WordImportConfirm";
import {
  WordPlanCommentConfirm,
  WordPlanCommentRemovals,
} from "./WordPlanCommentRemovals";
import {
  isAutomaticWordRun,
  WordApplyButton,
  wordBlockedReasonText,
  WordDiagnosticDetails,
  WordReviewConfirm,
  WordStatusAlert,
} from "./WordReviewCardParts";
import { WordReviewReceipt } from "./WordReviewReceipt";
import { useClientActionConfirmFlow } from "../../core/clientActions/useClientActionConfirmFlow";
import { useWordClientActionDecisions } from "../hooks/useWordClientActionDecisions";
import { useWordReviewFocus } from "../hooks/useWordReviewFocus";
import { useWordWrite } from "../providers/WordWriteProvider";
import { withoutParagraphMark } from "../utils/buildWordDocumentArgs";
import { isActionDenied } from "../utils/clientActionPolicy";
import {
  renderWordDiagnosticReport,
  renderWordOutcomeReport,
} from "../utils/wordApplyDiagnostics";
import {
  revertWordDocumentPlan,
  wordRevertImportRefusal,
  wordRevertMechanism,
} from "../utils/wordApplyDocumentPlan";
import { wordApplyHost, wordApplyPolicy } from "../utils/wordApplyPolicy";
import {
  wordApplyAdjustmentText,
  wordAuthoringIssueText,
  wordCoauthorsEditingText,
  wordDocumentDiagnosticText,
  wordInPlaceRequestText,
  wordPartlyWrittenText,
  wordPlanAdjustedText,
  wordRevertNeedsImportText,
  wordRoutePreviewText,
  wordTrackedApplyText,
  wordUnverifiedPassagesText,
} from "../utils/wordAuthoringMessages";
import { offerableWordClientActionsForFacet } from "../utils/wordClientActions";
import { readWordCoauthoring } from "../utils/wordCoauthoring";
import {
  decodeWordDocumentBackup,
  decodeWordInPlaceBackup,
  isWordDocumentBackup,
} from "../utils/wordDocumentPackage";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  wordPlanDraftText,
} from "../utils/wordDocumentXml";
import { WORD_VISIBLE_ADJUSTMENTS } from "../utils/wordFullDocumentComparison";
import { wordHostPlatform } from "../utils/wordHostPlatform";
import { wordInPlaceCapabilities } from "../utils/wordInPlaceCapabilities";
import {
  routeWordDocumentPlan,
  wordPlanPassages,
  wordWholeDocumentWrite,
} from "../utils/wordInPlaceRoute";
import { wordInPlaceAvailability } from "../utils/wordInPlaceSwitch";
import {
  wordCommentsChangedText,
  wordCommentsDeletedText,
  wordCommentsKeptText,
  wordCommentsUncheckedText,
  wordCommentThreadsCopiedText,
  wordCommentThreadsCopyFailedText,
  wordCommentThreadsCopyText,
  wordKeepCommentedPassagesNote,
  wordKeepCommentedPassagesText,
} from "../utils/wordPlanCommentMessages";
import { wordPlanCommentConsequences } from "../utils/wordPlanComments";
import {
  capturedWordAnchor,
  showWordParagraphs,
  showWordReviewLocation,
  wordInPlaceMismatchedParagraphs,
  wordInPlaceRegionOf,
  wordInPlaceWrittenRegions,
} from "../utils/wordReviewLocation";
import {
  EMPTY_WORD_REVIEW,
  isWordWholeDocumentBlock,
  wordMismatchedPassages,
  wordPlanOutcomeState,
  wordWholeDocumentBlockRoute,
  wordWholeDocumentBlockWrite,
} from "../utils/wordReviewState";
import { resolveWordWriteGate } from "../utils/wordWriteGate";

import type {
  WordClientAction,
  WordClientActionEntry,
} from "../utils/wordClientActions";
import type { WordCoauthoringState } from "../utils/wordCoauthoring";
import type { WordInPlaceBackup } from "../utils/wordDocumentPackage";
import type { WordWholeDocumentWrite } from "../utils/wordInPlaceRoute";
import type {
  WordDocumentPlan,
  WordPlanCommentThread,
} from "@erato/frontend/word-review";

function coauthorNotice(
  state: WordCoauthoringState | undefined,
): "editing" | "pending" | undefined {
  return state?.othersEditing
    ? "editing"
    : state?.pendingUpdates
      ? "pending"
      : undefined;
}

export function WordDocumentPlanCard({
  entry,
  content,
}: {
  entry: WordClientActionEntry;
  content: string;
}) {
  const artifact = useHostArtifact();
  const { currentChatId, getTranscript } = useChatSession();
  const host = useWordWrite();
  const { decisions, setDecisions, grantAlways } = useWordClientActionDecisions(
    entry.action,
  );
  const [copyNote, setCopyNote] = useState("");
  const facetId = artifact?.facetId ?? "";
  const messageId = artifact?.messageId;
  const generating = useConversationSelector(
    (messages) =>
      messageId !== undefined && messages[messageId]?.status === "sending",
    Object.is,
  );
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
  const parsed = useMemo(() => parseWordDocumentPlan(content), [content]);
  const liveMatches = !!parsed && parsed.snapshot === snapshot?.token;
  const lineage = useWordMessageLineage(messageId);
  // Without the live capture, review against what the model read; it never applies.
  const history = useMemo(
    () =>
      parsed && !liveMatches
        ? wordHistoryProposal(lineage, content)
        : undefined,
    [parsed, liveMatches, lineage, content],
  );
  const shown = liveMatches ? snapshot : (history?.snapshot ?? snapshot);
  const plan = useMemo(
    () =>
      history?.snapshot
        ? history.plan
        : parsed && normalizeWordDocumentPlan(parsed, shown),
    [history, parsed, shown],
  );
  const planReview = useMemo(
    () => plan && buildWordPlanReview(plan, shown),
    [plan, shown],
  );
  const gate = resolveWordWriteGate({
    capture,
    expectedIdentity: artifact?.itemIdentity,
    currentIdentity: host.documentIdentity,
  });
  const idle = review.status === "idle";
  const applying = review.status === "applying";
  const issue = plan ? validateWordDocumentPlan(plan, snapshot) : "invalid";
  const configuredAskActions = useMemo(
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
      enforcedAskActions: configuredAskActions,
    });
  const ready =
    idle &&
    !generating &&
    !issue &&
    !planReview?.noChange &&
    gate.allowed &&
    snapshot?.ownerMessageId === messageId &&
    offered;
  const availability = wordInPlaceAvailability();
  const unavailable = availability.enabled ? undefined : availability.reason;
  // Kept while applying, so a confirmed Apply keeps its busy button in place.
  const routable = ready || applying;
  const routing = useMemo(() => {
    if (!routable || !plan || !snapshot) return undefined;
    try {
      const xml = compileWordDocumentPlan(plan, snapshot);
      const compiled = captureWordAuthoringSnapshot(
        xml,
        snapshot.identity,
        "Off",
        snapshot.fullDocument,
        "verify",
      );
      if (compiled.issue) return undefined;
      const route = routeWordDocumentPlan(
        plan,
        snapshot,
        unavailable
          ? { enabled: false, reason: unavailable }
          : { enabled: true },
        wordInPlaceCapabilities(),
        compiled,
      );
      return {
        route: route.route,
        text: wordRoutePreviewText(route, wordPlanPassages(plan)),
        write: wordWholeDocumentWrite(
          route,
          plan,
          snapshot,
          wordApplyPolicy(),
          xml,
        ),
        comments: wordPlanCommentConsequences(snapshot, xml, compiled),
      };
    } catch {
      return undefined;
    }
  }, [routable, plan, snapshot, unavailable]);
  const routePreview = routing?.text;
  const commentPlan = routing?.comments;
  const removals = commentPlan?.removals ?? [];
  const needsCommentTick = offered && removals.length > 0;
  // The tick holds for the compiled plan it was given for, so a changed plan asks again.
  const [commentsTicked, setCommentsTicked] = useState<string>();
  const commentsConfirmed =
    !!commentPlan && commentsTicked === commentPlan.fingerprint;
  const enforcedAskActions = useMemo(
    () =>
      needsCommentTick
        ? [...configuredAskActions, entry.action]
        : configuredAskActions,
    [needsCommentTick, configuredAskActions, entry.action],
  );
  const block = review.wholeDocumentBlock;
  const liveRefusal =
    routing?.write.write === "refuse" ? routing.write.reason : undefined;
  const storedRefusal = review.wholeDocumentRefusal;
  useEffect(() => {
    if (routing && liveRefusal !== storedRefusal)
      host.updateReview(key, { wholeDocumentRefusal: liveRefusal });
  }, [routing, liveRefusal, storedRefusal, host, key]);
  const wholeDocument: WordWholeDocumentWrite | undefined = block
    ? wordWholeDocumentBlockWrite(block)
    : (routing?.write ??
      (storedRefusal && { write: "refuse", reason: storedRefusal }));
  const confirmImport = offered && wholeDocument?.write === "confirm";
  const refusal =
    offered && wholeDocument?.write === "refuse"
      ? wholeDocument.reason
      : undefined;
  const web = wordApplyHost(wordHostPlatform()) === "web";
  const replacedRoute = block
    ? wordWholeDocumentBlockRoute(block).route
    : routing?.route;
  const replaces =
    replacedRoute === "import" || replacedRoute === "body"
      ? replacedRoute
      : undefined;
  // Word for Mac reports Word.Coauthoring too, but its P-D-COAUTH run has not completed.
  const checkCoauthors =
    wordApplyHost(wordHostPlatform()) === "pc" && !!replaces;
  const coauthorsRead = useRef(false);
  const [coauthors, setCoauthors] = useState<"editing" | "pending">();
  useEffect(() => {
    if (!checkCoauthors || coauthorsRead.current) return;
    coauthorsRead.current = true;
    void readWordCoauthoring().then((state) =>
      setCoauthors(coauthorNotice(state)),
    );
  }, [checkCoauthors]);
  const run = useCallback(
    async (importConfirmed: boolean, commentRemovalsConfirmed?: string) => {
      // Always allow and auto-prompt reach this too; only the card's own ticks confirm.
      if (
        !ready ||
        !capture ||
        refusal ||
        (confirmImport && !importConfirmed) ||
        (needsCommentTick &&
          commentRemovalsConfirmed !== commentPlan?.fingerprint)
      )
        return false;
      if (checkCoauthors) {
        // Someone who joined since the card was read is shown before anything is replaced.
        const now = coauthorNotice(await readWordCoauthoring());
        if (now !== coauthors) {
          setCoauthors(now);
          if (now) return false;
        }
      }
      if (!host.beginOperation()) return false;
      host.updateReview(key, {
        status: "applying",
        applyStage: "checking",
        capture,
        documentPlanDiagnostic: undefined,
        documentPlanOutcome: undefined,
      });
      try {
        const outcome = await entry.execute({
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
          importConfirmed,
          commentRemovalsConfirmed,
        });
        const result = outcome.documentPlanResult;
        if (
          result?.status === "blocked" &&
          result.diagnostic?.reason === "comment-removals-need-confirmation"
        ) {
          setCommentsTicked(undefined);
          // Without the card's own rows, the diagnostic is what tells the user why nothing ran.
          host.updateReview(key, {
            applyStage: undefined,
            status: "idle",
            documentPlanDiagnostic: needsCommentTick
              ? undefined
              : result.diagnostic,
          });
          return false;
        }
        if (
          result?.status === "blocked" &&
          isWordWholeDocumentBlock(result.diagnostic)
        ) {
          host.updateReview(key, {
            applyStage: undefined,
            status: "idle",
            wholeDocumentBlock: result.diagnostic,
          });
          return false;
        }
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
          status: outcome.ok
            ? "done"
            : result?.status === "interrupted"
              ? "write-failed"
              : "error",
          documentPlanStatus: result?.status,
          documentPlanDiagnostic: result?.diagnostic,
          documentPlanOutcome: result?.outcome,
          wholeDocumentBlock: undefined,
          detailsExpanded: false,
          automatic:
            !importConfirmed &&
            isAutomaticWordRun({
              presentation: artifact?.clientActionPresentation,
              decisions,
              facetId,
              action: entry.action,
              enforcedAskActions,
            }),
        });
        return outcome.ok;
      } catch {
        host.updateReview(key, {
          applyStage: undefined,
          status: "write-failed",
          documentPlanStatus: "interrupted",
          documentPlanDiagnostic: { stage: "write", reason: "host-error" },
          wholeDocumentBlock: undefined,
        });
        return false;
      } finally {
        host.endOperation();
      }
    },
    [
      ready,
      capture,
      refusal,
      confirmImport,
      needsCommentTick,
      commentPlan,
      checkCoauthors,
      coauthors,
      host,
      key,
      entry,
      content,
      messageId,
      artifact,
      decisions,
      facetId,
      enforcedAskActions,
    ],
  );
  const execute = useCallback(() => run(false), [run]);
  // The refusal offers no Apply, so a consent card behind it could never be answered.
  const buildSummary = useCallback(
    () => (ready && !refusal ? plan : null),
    [ready, refusal, plan],
  );
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
  useEffect(() => {
    if (refusal && confirmCard) denyCard(confirmCard);
  }, [refusal, confirmCard, denyCard]);
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
  // After a stale revert the slot is kept only for download: retrying would
  // hit the same later edits, so the undo line would promise too much.
  const revertable =
    ["done", "write-failed", "revert-failed"].includes(review.status) &&
    review.documentPlanStatus !== "revert-stale" &&
    !!recoverySlot?.afterFingerprint;
  // Decoding the backup is costly, so it is not redone on every render.
  const revertRefused = useMemo(
    () =>
      revertable &&
      !!slotOoxml &&
      !!wordRevertImportRefusal(slotOoxml, slotAfter),
    [revertable, slotOoxml, slotAfter],
  );
  const canRevert = revertable && !revertRefused;
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
    const ordinal = source?.paragraphOrdinal;
    const paragraph = ordinal ? capture?.ordinalMap.get(ordinal) : undefined;
    if (
      !gate.allowed ||
      !source ||
      !ordinal ||
      !paragraph ||
      source.text !== withoutParagraphMark(paragraph.text) ||
      !host.beginOperation()
    )
      return;
    try {
      const anchor = capturedWordAnchor(gate.capture, ordinal);
      const result = anchor
        ? await showWordReviewLocation(anchor, host.documentIdentity)
        : "changed";
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
  const askAgainWith = (instruction: string) => {
    if (confirmCard) denyCard(confirmCard);
    const { messages } = getTranscript();
    const message = messageId ? messages[messageId] : undefined;
    const request = message?.previous_message_id
      ? extractTextFromContent(messages[message.previous_message_id]?.content)
      : "";
    host.restoreRequest([request, instruction].filter(Boolean).join("\n\n"));
  };
  const keepCommentedPassages = () => {
    askAgainWith(wordKeepCommentedPassagesText(removals));
    setCopyNote(wordKeepCommentedPassagesNote());
  };
  const copyThreads = (threads: readonly WordPlanCommentThread[]) =>
    copyText(
      wordCommentThreadsCopyText(threads),
      wordCommentThreadsCopiedText(),
      wordCommentThreadsCopyFailedText(),
    );
  const askAgainInPlace = () => {
    askAgainWith(wordInPlaceRequestText());
    setCopyNote(
      t({
        id: "officeAddin.word.importConfirm.askAgainNote",
        message:
          "Your request is back in the message box, asking for in-place edits only. Review it, then send.",
      }),
    );
  };
  const deny = () => {
    if (confirmCard) denyCard(confirmCard);
    host.updateReview(key, { status: "denied", capture });
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
          partial.untouched > 0
        ? wordPartlyWrittenText(
            partial.applied,
            partial.applied + partial.untouched,
          )
        : review.documentPlanDiagnostic
          ? wordDocumentDiagnosticText(
              review.documentPlanDiagnostic,
              review.status === "revert-failed" ||
                review.documentPlanStatus === "revert-stale",
              snapshot?.proofingPending,
            )
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
  const commentCheck =
    review.status === "done" ? review.documentPlanOutcome?.comments : undefined;
  const commentWarning = commentCheck?.unexpected
    ? wordCommentsChangedText(commentCheck.unexpected, web)
    : commentCheck?.unverified
      ? wordCommentsUncheckedText()
      : "";
  const adjustedOutcome =
    ["done", "reverted"].includes(review.status) &&
    (review.documentPlanOutcome?.tier === "content" || commentWarning)
      ? review.documentPlanOutcome
      : undefined;
  const adjustmentNote = [
    ...(commentCheck?.removed && !commentWarning
      ? [wordCommentsDeletedText(commentCheck.removed)]
      : []),
    ...(commentCheck?.kept ? [wordCommentsKeptText(commentCheck.kept)] : []),
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
      <WordReviewGenerating
        label={t({
          id: "officeAddin.word.authoring.preparingChanges",
          message: "Preparing document changes…",
        })}
      />
    );
  if (!plan || !planReview)
    return <Alert type="error">{wordAuthoringIssueText("invalid")}</Alert>;
  const applyLabel = wordPlanApplyLabel(planReview, replacedRoute === "import");
  const coauthorsNotice = coauthors && replaces && (
    <Alert
      type="warning"
      role="status"
      className="[overflow-wrap:anywhere]"
      data-testid="word-plan-coauthors"
    >
      {wordCoauthorsEditingText(replaces, coauthors)}
    </Alert>
  );
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
    <WordProposalCard
      cardRef={cardRef}
      label={entry.displayLabel()}
      testId="word-document-plan-card"
      plan={plan}
      snapshot={shown}
      review={planReview}
      showSavedPlan={!!artifact?.submittedCard}
      adapter={{
        locate: host.operationInProgress
          ? undefined
          : shown === snapshot && idle && gate.allowed
            ? (ref) => void locate(ref)
            : review.status === "done" && writtenRecord
              ? (ref) => {
                  const ids = wordInPlaceRegionOf(writtenRecord, ref);
                  if (ids) void showWritten(ids);
                  else cannotLocate();
                }
              : undefined,
        apply: refusal ? (
          idle && (
            <WordImportRefusal reason={refusal} onAskAgain={askAgainInPlace} />
          )
        ) : confirmImport && (idle || applying) ? (
          <WordImportConfirm
            key={key}
            routeText={
              block
                ? wordRoutePreviewText(
                    wordWholeDocumentBlockRoute(block),
                    wordPlanPassages(plan),
                  )
                : routePreview
            }
            web={web}
            notice={coauthorsNotice}
            comments={
              needsCommentTick && (
                <WordPlanCommentRemovals
                  removals={removals}
                  confirmed={commentsConfirmed}
                  disabled={applying}
                  onConfirmedChange={(checked) =>
                    setCommentsTicked(
                      checked ? commentPlan?.fingerprint : undefined,
                    )
                  }
                  onKeepPassages={keepCommentedPassages}
                  onCopyThreads={
                    web
                      ? undefined
                      : () => copyThreads(removals.map((r) => r.thread))
                  }
                />
              )
            }
            commentsConfirmed={!needsCommentTick || commentsConfirmed}
            rebuiltThreads={
              web && commentPlan
                ? commentPlan.threads.length - removals.length
                : undefined
            }
            onCopyThreads={
              web && commentPlan?.threads.length
                ? () => copyThreads(commentPlan.threads)
                : undefined
            }
            applyLabel={applyLabel}
            canApply={ready && !host.operationInProgress}
            applying={applying}
            applyStage={review.applyStage}
            onApply={() =>
              void run(
                true,
                needsCommentTick ? commentsTicked : undefined,
              ).then(() => {
                // The tick is this plan's consent, so a pending consent card is settled with it.
                if (confirmCard) denyCard(confirmCard);
              })
            }
            onAskAgain={askAgainInPlace}
            onCancel={deny}
          />
        ) : needsCommentTick && (idle || applying) ? (
          <WordPlanCommentConfirm
            removals={removals}
            confirmed={commentsConfirmed}
            onConfirmedChange={(checked) =>
              setCommentsTicked(checked ? commentPlan?.fingerprint : undefined)
            }
            routeText={routePreview}
            notice={coauthorsNotice}
            applyLabel={applyLabel}
            canApply={ready && !host.operationInProgress}
            applying={applying}
            applyStage={review.applyStage}
            onApply={() =>
              void run(false, commentsTicked).then(() => {
                if (confirmCard) denyCard(confirmCard);
              })
            }
            onKeepPassages={keepCommentedPassages}
            onCopyThreads={() => copyThreads(removals.map((r) => r.thread))}
            onCancel={deny}
          />
        ) : (
          <>
            {routePreview && idle && offered && (
              <p className="word-review__hint" data-testid="word-plan-route">
                {routePreview}
              </p>
            )}
            {(idle || applying) && offered && coauthorsNotice}
            {(idle || applying) && offered && !confirmCard && (
              <WordApplyButton
                applying={applying}
                applyStage={review.applyStage}
                disabled={
                  !ready || host.operationInProgress || isConfirmPending
                }
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
                onGrantAlways={grantAlways}
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
          </>
        ),
        actions: (
          <>
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
          </>
        ),
        revert: revertRefused ? (
          <p
            className="word-review__hint"
            data-testid="word-plan-revert-refused"
          >
            {wordRevertNeedsImportText()}
          </p>
        ) : (
          <WordUndoLine
            canRevert={canRevert}
            label={
              written?.mechanism === "tracked"
                ? t({
                    id: "officeAddin.word.authoring.rejectTracked",
                    message: "Reject these tracked changes",
                  })
                : review.status === "done" || written?.mechanism === "in-place"
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
        ),
        status: {
          collapsed,
          onToggleDetails: completed
            ? () => host.updateReview(key, { detailsExpanded: collapsed })
            : undefined,
          receipt: (
            <WordReviewReceipt
              review={review}
              kind="plan"
              title={planTitle}
              wholeDocument={review.documentPlanOutcome?.route === "import"}
              note={adjustmentNote}
              warning={commentWarning}
            />
          ),
          alert: status ? (
            <WordStatusAlert status={review.status}>{status}</WordStatusAlert>
          ) : (
            commentWarning && (
              <Alert type="warning" className="m-3 [overflow-wrap:anywhere]">
                {commentWarning}
              </Alert>
            )
          ),
          trailing: (
            <>
              {mismatchedParagraphs.length > 0 && (
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
              <WordDiagnosticDetails
                diagnostic={review.documentPlanDiagnostic}
              />
              {status && errorReport && (
                <div className="m-3 mt-0">
                  <CopyErrorButton
                    error={errorReport}
                    reportOptions={{ chatId: currentChatId }}
                  />
                </div>
              )}
            </>
          ),
          notice: idle && blockedText && !refusal && (
            <Alert
              type="info"
              role="status"
              className="m-3 [overflow-wrap:anywhere]"
            >
              {blockedText}
            </Alert>
          ),
          note: copyNote,
        },
      }}
    />
  );
}
