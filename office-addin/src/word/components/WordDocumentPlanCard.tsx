import {
  Button,
  Alert,
  CopyErrorButton,
  extractTextFromContent,
  useChatSession,
  useConversationSelector,
  useHostArtifact,
  useWordMessageLineage,
  WordPartsReview,
  wordPartsReorderingText,
  wordPartsTitleText,
  WordProposalCard,
  WordReviewGenerating,
  WordUndoLine,
  submittedCardsOf,
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
  wordPartsReorders,
  wordPlanNotInProposal,
} from "@erato/frontend/word-review";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  WordDecisionChoices,
  wordPlanStandingLabel,
} from "./WordDecisionChoices";
import { wordPartsLabelText } from "./WordDocumentPartsCard";
import { WordImportConfirm, WordImportRefusal } from "./WordImportConfirm";
import {
  WordPlanCommentConfirm,
  WordPlanCommentRemovals,
} from "./WordPlanCommentRemovals";
import {
  wordBlockedReasonText,
  WordDiagnosticDetails,
  WordStatusAlert,
} from "./WordReviewCardParts";
import { WordReviewReceipt } from "./WordReviewReceipt";
import {
  useWordChainedApply,
  useWordPlanCapture,
} from "../hooks/useWordChainedApply";
import { useWordCopyGone } from "../hooks/useWordCopyGone";
import {
  useWordPlanParts,
  wordPartsChangesByRow,
} from "../hooks/useWordPlanParts";
import { useWordReviewFocus } from "../hooks/useWordReviewFocus";
import { useWordReview, useWordWrite } from "../providers/WordWriteProvider";
import { withoutParagraphMark } from "../utils/buildWordDocumentArgs";
import {
  renderWordDiagnosticReport,
  renderWordOutcomeReport,
} from "../utils/wordApplyDiagnostics";
import {
  revertWordDocumentPlan,
  wordRevertImportRefusal,
  wordRevertMechanism,
} from "../utils/wordApplyDocumentPlan";
import { wordApplyHost } from "../utils/wordApplyPolicy";
import {
  wordApplyAdjustmentText,
  wordApplyStageLabel,
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
import { wordChainedApplyText } from "../utils/wordChainedApply";
import { offerableWordClientActionsForFacet } from "../utils/wordClientActions";
import { readWordCoauthoring } from "../utils/wordCoauthoring";
import {
  decodeWordDocumentBackup,
  decodeWordInPlaceBackup,
  isWordDocumentBackup,
} from "../utils/wordDocumentPackage";
import { wordPlanDraftText } from "../utils/wordDocumentXml";
import { WORD_VISIBLE_ADJUSTMENTS } from "../utils/wordFullDocumentComparison";
import { wordHostPlatform } from "../utils/wordHostPlatform";
import { wordPlanPassages } from "../utils/wordInPlaceRoute";
import {
  wordCoauthorNotice,
  wordPlanChecksCoauthors,
  wordPlanRouting,
  wordPlanRoutingEnvironment,
} from "../utils/wordPlanApply";
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
import {
  capturedWordAnchor,
  showWordParagraphs,
  showWordReviewLocation,
  wordInPlaceMismatchedParagraphs,
  wordInPlaceRegionOf,
  wordInPlaceWrittenRegions,
} from "../utils/wordReviewLocation";
import {
  wordMismatchedPassages,
  wordPlanOutcomeState,
  wordWholeDocumentBlockRoute,
  wordWholeDocumentBlockWrite,
} from "../utils/wordReviewState";
import { resolveWordWriteGate } from "../utils/wordWriteGate";

import type { WordCardDecision } from "./WordDecisionChoices";
import type { WordPlanConfirmation } from "../utils/wordApplyCall";
import type { WordClientActionEntry } from "../utils/wordClientActions";
import type { WordInPlaceBackup } from "../utils/wordDocumentPackage";
import type { WordWholeDocumentWrite } from "../utils/wordInPlaceRoute";
import type { WordPlanCommentThread } from "@erato/frontend/word-review";

export function WordDocumentPlanCard({
  entry,
  content,
  decision,
}: {
  entry: WordClientActionEntry;
  content: string;
  /** Drawn in the decision place: Apply approves the server's call, which writes. */
  decision?: WordCardDecision;
}) {
  const artifact = useHostArtifact();
  const { currentChatId, getTranscript } = useChatSession();
  const host = useWordWrite();
  const [copyNote, setCopyNote] = useState("");
  const facetId = artifact?.facetId ?? "";
  const messageId = artifact?.messageId;
  const streaming = useConversationSelector(
    (messages) =>
      messageId !== undefined && messages[messageId]?.status === "sending",
    Object.is,
  );
  const chainedState = useWordChainedApply(
    decision ? undefined : messageId,
    submittedCardsOf(artifact).find(
      (card) =>
        card.language === entry.fenceLanguage && card.content === content,
    )?.toolCallId,
  );
  // The server applies this change: the card in the answer shows where it stands, never Apply.
  const chained = chainedState !== undefined;
  // The decision place shows a parked call, and an answer goes on after a change it applied.
  const generating = streaming && !decision && !chained;
  const key = `${messageId ?? ""}:${entry.action}:${content}`;
  const review = useWordReview(key);
  const cardRef = useWordReviewFocus(
    `${review.status}:${review.documentPlanStatus ?? ""}:${!!review.detailsExpanded}`,
  );
  const parsed = useMemo(() => parseWordDocumentPlan(content), [content]);
  const capture = useWordPlanCapture(
    messageId ? host.capturesByAssistantMessageId.get(messageId) : undefined,
    parsed?.snapshot,
    review.capture,
  );
  const snapshot = capture?.authoring;
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
  const notInProposal = useMemo(
    () => wordPlanNotInProposal(lineage.at(-1)?.content),
    [lineage],
  );
  const shown = liveMatches ? snapshot : (history?.snapshot ?? snapshot);
  const plan = useMemo(
    () =>
      history?.snapshot
        ? history.plan
        : parsed && normalizeWordDocumentPlan(parsed, shown),
    [history, parsed, shown],
  );
  const parts = useWordPlanParts({
    messageContent: lineage.at(-1)?.content,
    snapshot: shown,
  });
  const planReview = useMemo(
    () => plan && buildWordPlanReview(plan, shown),
    [plan, shown],
  );
  // Rows and Check first both read the review of the plan, so a jump finds its row.
  const partsChanges = useMemo(
    () => wordPartsChangesByRow(planReview, parts?.sectionRowOf),
    [planReview, parts?.sectionRowOf],
  );
  const gate = resolveWordWriteGate({
    capture,
    // A parked answer's artifact may not name its document yet; its live copy does.
    expectedIdentity:
      artifact?.itemIdentity ?? (decision ? capture?.identity : undefined),
    currentIdentity: host.documentIdentity,
  });
  const idle = review.status === "idle";
  const applying = review.status === "applying";
  const issue = plan ? validateWordDocumentPlan(plan, snapshot) : "invalid";
  const ownsCapture = !!snapshot && snapshot.ownerMessageId === messageId;
  // Gone after a pane reload, or once a later request took a new copy: the card then folds and
  // offers no Apply, like every card but the newest proposal.
  const copyGone = useWordCopyGone({
    generating,
    hasCopy: !!snapshot,
    revoked: !ownsCapture || issue === "expired",
  });
  const offered = offerableWordClientActionsForFacet(
    facetId,
    artifact?.allowedClientActions,
  ).includes(entry.action);
  // Only the card in the decision place approves; the server's call then writes.
  const ready =
    !!decision &&
    idle &&
    !generating &&
    !issue &&
    !planReview?.noChange &&
    gate.allowed &&
    ownsCapture &&
    offered;
  // Kept while applying, so a confirmed Apply keeps its busy button in place.
  const routable = ready || applying;
  const environment = wordPlanRoutingEnvironment();
  const routing = useMemo(
    () =>
      routable && plan && snapshot && environment
        ? wordPlanRouting(plan, snapshot, content)
        : undefined,
    [routable, plan, snapshot, content, environment],
  );
  const routePreview = routing?.text;
  const commentPlan = routing?.comments;
  const removals = commentPlan?.removals ?? [];
  const needsCommentTick = offered && removals.length > 0;
  // The tick holds for the compiled plan it was given for, so a changed plan asks again.
  const [commentsTicked, setCommentsTicked] = useState<string>();
  const commentsConfirmed =
    !!commentPlan && commentsTicked === commentPlan.fingerprint;
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
  // A change in parts that moves sections says once what replacing the whole document means.
  const reorderingText =
    parts && replaces && wordPartsReorders(parts.progress)
      ? wordPartsReorderingText()
      : undefined;
  // Word for Mac reports Word.Coauthoring too, but its P-D-COAUTH run has not completed.
  const checkCoauthors = wordPlanChecksCoauthors(
    replaces ? { route: replaces } : undefined,
  );
  const coauthorsRead = useRef(false);
  const [coauthors, setCoauthors] = useState<"editing" | "pending">();
  useEffect(() => {
    if (!checkCoauthors || coauthorsRead.current) return;
    coauthorsRead.current = true;
    void readWordCoauthoring().then((state) =>
      setCoauthors(wordCoauthorNotice(state)),
    );
  }, [checkCoauthors]);
  const approve = useCallback(
    (importConfirmed: boolean, commentRemovalsConfirmed?: string) => {
      // Only the card's own ticks confirm.
      if (
        !decision ||
        !ready ||
        refusal ||
        (confirmImport && !importConfirmed) ||
        (needsCommentTick &&
          commentRemovalsConfirmed !== commentPlan?.fingerprint)
      )
        return;
      const confirmation: WordPlanConfirmation = {
        ...(importConfirmed ? { importConfirmed } : {}),
        ...(commentRemovalsConfirmed ? { commentRemovalsConfirmed } : {}),
        ...(coauthors ? { coauthors } : {}),
      };
      decision.onDecide("approve", { clientConfirmation: confirmation });
    },
    [
      decision,
      ready,
      refusal,
      confirmImport,
      needsCommentTick,
      commentPlan,
      coauthors,
    ],
  );
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
  const deny = () => decision?.onDecide("reject");
  const completed = ["done", "reverted"].includes(review.status);
  // Nothing is decided in the answer, so a card there folds until a change ran; a parked change
  // stays open, as its answer waits for a decision.
  const folds =
    completed ||
    (idle && !generating && !decision) ||
    (review.status === "error" && !!snapshot?.revoked);
  const collapsed = folds && !review.detailsExpanded;
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
  if (chainedState && idle)
    return (
      <p className="word-review__hint" data-testid="word-chained-status">
        {wordChainedApplyText(chainedState)}
      </p>
    );
  // A change in parts keeps its rows while the turn winds down; Apply waits for its end.
  if (generating && !parts)
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
      : !ownsCapture
        ? wordAuthoringIssueText("no-capture")
        : !offered
          ? t({
              id: "officeAddin.word.authoring.notAllowed",
              message:
                "This action is unavailable under the current action settings.",
            })
          : undefined;
  const locateSource: ((ref: string) => void) | undefined =
    host.operationInProgress
      ? undefined
      : shown === snapshot && idle && gate.allowed
        ? (ref) => void locate(ref)
        : review.status === "done" && writtenRecord
          ? (ref) => {
              const ids = wordInPlaceRegionOf(writtenRecord, ref);
              if (ids) void showWritten(ids);
              else cannotLocate();
            }
          : undefined;
  // A change in parts says its route only when Apply replaces the whole document.
  const routeText =
    reorderingText ??
    (parts && !replaces
      ? undefined
      : block
        ? wordRoutePreviewText(
            wordWholeDocumentBlockRoute(block),
            wordPlanPassages(plan),
          )
        : routePreview);
  const consentTitle = t({
    id: "officeAddin.word.planReview.consent",
    message: "Apply the changes reviewed above?",
  });
  // A parked change this card cannot make is still declined here: the answer waits for it.
  const declineOnly = decision && idle && (
    <WordDecisionChoices
      decision={decision}
      title={consentTitle}
      applyLabel={applyLabel}
      canApply={false}
      standingLabel={wordPlanStandingLabel()}
    />
  );
  const applyControl = !decision ? (
    applying && (
      <p className="word-review__hint" role="status">
        {wordApplyStageLabel(review.applyStage)}
      </p>
    )
  ) : refusal ? (
    idle && (
      <>
        <WordImportRefusal reason={refusal} onAskAgain={askAgainInPlace} />
        {declineOnly}
      </>
    )
  ) : copyGone && idle ? (
    declineOnly || null
  ) : confirmImport && (idle || applying) ? (
    <WordImportConfirm
      key={key}
      routeText={routeText}
      web={web}
      notice={coauthorsNotice}
      comments={
        needsCommentTick && (
          <WordPlanCommentRemovals
            removals={removals}
            confirmed={commentsConfirmed}
            disabled={applying}
            onConfirmedChange={(checked) =>
              setCommentsTicked(checked ? commentPlan?.fingerprint : undefined)
            }
            onKeepPassages={keepCommentedPassages}
            onCopyThreads={
              web ? undefined : () => copyThreads(removals.map((r) => r.thread))
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
        approve(true, needsCommentTick ? commentsTicked : undefined)
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
      routeText={routeText}
      notice={coauthorsNotice}
      applyLabel={applyLabel}
      canApply={ready && !host.operationInProgress}
      applying={applying}
      applyStage={review.applyStage}
      onApply={() => approve(false, commentsTicked)}
      onKeepPassages={keepCommentedPassages}
      onCopyThreads={() => copyThreads(removals.map((r) => r.thread))}
      onCancel={deny}
    />
  ) : (
    <>
      {routeText && idle && offered && (
        <p className="word-review__hint" data-testid="word-plan-route">
          {routeText}
        </p>
      )}
      {(idle || applying) && offered && coauthorsNotice}
      {decision && idle && offered && (
        <WordDecisionChoices
          decision={decision}
          title={consentTitle}
          applyLabel={applyLabel}
          canApply={ready}
          standingLabel={wordPlanStandingLabel()}
          confirmation={coauthors ? { coauthors } : undefined}
        />
      )}
      {!offered && declineOnly}
    </>
  );
  const statusAlert = status ? (
    <WordStatusAlert status={review.status}>{status}</WordStatusAlert>
  ) : (
    commentWarning && (
      <Alert
        type="warning"
        className="word-review__aside my-3 [overflow-wrap:anywhere]"
      >
        {commentWarning}
      </Alert>
    )
  );
  const statusTrailing = (
    <>
      {mismatchedParagraphs.length > 0 && (
        <div className="word-review__actions word-review__aside mb-3">
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
      <WordDiagnosticDetails diagnostic={review.documentPlanDiagnostic} />
      {status && errorReport && (
        <div className="word-review__aside mb-3">
          <CopyErrorButton
            error={errorReport}
            reportOptions={{ chatId: currentChatId }}
          />
        </div>
      )}
    </>
  );
  return (
    <WordProposalCard
      cardRef={cardRef}
      label={entry.displayLabel()}
      testId="word-document-plan-card"
      plan={plan}
      snapshot={shown}
      review={planReview}
      showSavedPlan={!!artifact?.submittedCard}
      notInProposal={parts ? undefined : notInProposal}
      body={
        parts && (
          <WordPartsReview
            progress={parts.progress}
            title={wordPartsTitleText(parts.progress) ?? wordPartsLabelText()}
            top={
              <>
                {statusAlert}
                {statusTrailing}
                {applyControl}
              </>
            }
            changes={partsChanges}
            risks={planReview.risks}
            snapshot={shown}
            onLocate={shown ? locateSource : undefined}
            locatable={planReview.locatable}
            notChanged={notInProposal}
          />
        )
      }
      adapter={{
        locate: locateSource,
        apply: applyControl,
        // A change in parts offers only Apply and Undo, and Copy draft where a refusal points at it.
        actions: (
          <>
            {snapshot &&
              (!parts || !!refusal || !!review.documentPlanDiagnostic) && (
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
            {adjustedOutcome && !parts && (
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
            {review.status === "done" &&
              writtenRegions.length > 0 &&
              !parts && (
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
          onToggleDetails: folds
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
          // A change in parts shows them beside its Apply on top instead.
          alert: parts ? undefined : statusAlert,
          trailing: parts ? undefined : statusTrailing,
          notice: idle && blockedText && !refusal && (
            <Alert
              type="info"
              role="status"
              className="word-review__aside my-3 [overflow-wrap:anywhere]"
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
