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
import {
  isWordRevertOffered,
  revertWordSelection,
  WORD_WEB_REVERT_MAX_PARAGRAPHS,
} from "../utils/wordReplaceSelection";
import { EMPTY_WORD_REVIEW } from "../utils/wordReviewState";
import {
  emptySelectionCapture,
  isSameWordPassage,
  rewritableWordSelection,
  wordSelectionOf,
} from "../utils/wordSelectionAnchor";
import { captureWordSelection } from "../utils/wordSelectionCapture";
import {
  countWordReplaceFences,
  splitWordSelectionReplacement,
  wordSelectionLinePieces,
} from "../utils/wordSelectionEdit";
import { WORD_MARKER } from "../utils/wordSelectionItems";
import {
  showWordSelection,
  showWrittenWordSelection,
} from "../utils/wordSelectionTarget";
import { resolveWordWriteGate } from "../utils/wordWriteGate";

import type { WordRevertSlot } from "../providers/WordWriteProvider";
import type {
  WordClientAction,
  WordClientActionEntry,
} from "../utils/wordClientActions";
import type { WordReplaceSelectionResult } from "../utils/wordReplaceSelection";
import type { WordReviewState } from "../utils/wordReviewState";
import type {
  WordSelectionCapture,
  WordSelectionReasonCode,
  WordSelectionSnapshot,
} from "../utils/wordSelectionAnchor";
import type { WordKeptItemKind } from "../utils/wordSelectionItems";

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
      return t({
        id: "officeAddin.word.selection.reason.table",
        message:
          "Select text in one table cell to have it replaced. A selection across several cells is only used as context.",
      });
    case "nested_table":
      return t({
        id: "officeAddin.word.selection.reason.nestedTable",
        message:
          "Text in a table inside another table is only used as context.",
      });
    case "cell_multi_paragraph":
      return t({
        id: "officeAddin.word.selection.reason.cellParagraphs",
        message:
          "Select one paragraph in this table cell to have it replaced. Several paragraphs in one cell are only used as context.",
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
    case "bookmark":
      return t({
        id: "officeAddin.word.selection.reason.bookmark",
        message:
          "This passage holds a bookmark, such as one a table of contents or a cross-reference uses, which a rewrite could break.",
      });
    case "mixed_script":
      return t({
        id: "officeAddin.word.selection.reason.script",
        message:
          "This passage has superscript or subscript characters, as in m² or CO₂, which a rewrite would turn into normal text.",
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
    case "item_cut":
      return t({
        id: "officeAddin.word.selection.reason.itemCut",
        message:
          "This selection starts or ends inside a field or another item Word keeps whole. Select the whole item, or the text around it, to have it replaced.",
      });
    case "shape_not_enabled":
      return t({
        id: "officeAddin.word.selection.reason.shape",
        message:
          "Erato cannot replace this kind of selection yet. Select text within one paragraph to have it replaced.",
      });
    default:
      return t({
        id: "officeAddin.word.selection.reason.position",
        message:
          "Erato cannot pinpoint this passage in the document, so it cannot replace it safely.",
      });
  }
}

/** What the card shows for each kept item's marker, so the comparison reads as text. */
function wordKeptMarkersShown(
  text: string,
  selection: WordSelectionSnapshot,
): string {
  const markers = new Map(
    selection.paragraphs.flatMap((p) =>
      (p.kept?.markers ?? []).map((m) => [m.number, m] as const),
    ),
  );
  return text.replace(WORD_MARKER, (marker, close: string, number: string) => {
    const kept = markers.get(Number(number));
    if (!kept) return marker;
    const name = keptItemName(kept.kind);
    if (close) return `[/${name}]`;
    const shows = kept.shows.replace(/[\u0000-\u001F]/g, "");
    return kept.end === "point" && shows ? `[${shows}]` : `[${name}]`;
  });
}

function keptItemName(kind: WordKeptItemKind): string {
  switch (kind) {
    case "field":
      return t({
        id: "officeAddin.word.selection.item.field",
        message: "field",
      });
    case "link":
      return t({ id: "officeAddin.word.selection.item.link", message: "link" });
    case "note":
      return t({ id: "officeAddin.word.selection.item.note", message: "note" });
    case "comment":
      return t({
        id: "officeAddin.word.selection.item.comment",
        message: "comment",
      });
    case "picture":
      return t({
        id: "officeAddin.word.selection.item.picture",
        message: "picture",
      });
    case "break":
      return t({
        id: "officeAddin.word.selection.item.break",
        message: "line break",
      });
    case "control":
      return t({
        id: "officeAddin.word.selection.item.control",
        message: "content control",
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

/** How another version from the same answer leaves the document: its Undo here, or in Word. */
type SiblingRemoval = "undo" | "reject" | "word";

/** Another version from the same answer is, or may be, in the document. */
function siblingHintText(removal: SiblingRemoval): string {
  switch (removal) {
    case "undo":
      return t({
        id: "officeAddin.word.selection.siblingApplied",
        message:
          "Another version from this answer is in the document. Undo it to use this one instead.",
      });
    case "reject":
      return t({
        id: "officeAddin.word.selection.siblingAppliedTracked",
        message:
          "Another version from this answer is in the document. Reject it in Word to use this one instead.",
      });
    case "word":
      return t({
        id: "officeAddin.word.selection.siblingAppliedWord",
        message:
          "Another version from this answer is in the document. Remove it in Word, for example with Word's own Undo, to use this one instead.",
      });
  }
}

function siblingRefusedText(removal: SiblingRemoval): string {
  switch (removal) {
    case "undo":
      return t({
        id: "officeAddin.word.selection.siblingRefused",
        message:
          "Another version from this answer was applied to this passage. Undo it, then choose Replace again. Nothing was replaced.",
      });
    case "reject":
      return t({
        id: "officeAddin.word.selection.siblingRefusedTracked",
        message:
          "Another version from this answer was applied to this passage. Reject it in Word, then choose Replace again. Nothing was replaced.",
      });
    case "word":
      return t({
        id: "officeAddin.word.selection.siblingRefusedWord",
        message:
          "Another version from this answer was applied to this passage. Remove it in Word, for example with Word's own Undo, then choose Replace again. Nothing was replaced.",
      });
  }
}

/** The message for the card's last Undo while it runs or when it did not plainly succeed. */
function revertText(review: WordReviewState): string | undefined {
  if (review.status === "reverting")
    return t({
      id: "officeAddin.word.selection.reverting",
      message: "Restoring the passage…",
    });
  if (review.revertFailed === "timed-out")
    return t({
      id: "officeAddin.word.selection.revertTimedOut",
      message:
        "Word did not answer in time. The passage was not restored; try Undo again.",
    });
  if (review.revertFailed === "failed")
    return t({
      id: "officeAddin.word.selection.revertNotRun",
      message:
        "Word did not accept the change. The passage was not restored; try Undo again.",
    });
  if (review.revertStale === "changed")
    return t({
      id: "officeAddin.word.selection.revertStale",
      message:
        "The passage changed after it was replaced. Undo was not run because it would remove later edits.",
    });
  if (review.revertStale === "tracking")
    return t({
      id: "officeAddin.word.selection.revertTracking",
      message:
        "Undo was not run because Track Changes is on. Reject the change in Word instead.",
    });
  if (review.status === "revert-failed")
    return t({
      id: "officeAddin.word.selection.revertFailed",
      message:
        "The passage could not be restored with certainty. Check it in Word; Word's own Undo may still help.",
    });
  return undefined;
}

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
        case "AMBIGUOUS_TARGET":
          return t({
            id: "officeAddin.word.selection.ambiguous",
            message:
              "This passage now appears more than once, so Erato can't tell which one you meant. Nothing was replaced.",
          });
        case "MARKERS_CHANGED":
          return t({
            id: "officeAddin.word.selection.markersChanged",
            message:
              "The proposal lost or moved a field, link, note or comment of the passage, so it would delete or misplace it. Nothing was replaced.",
          });
        case "TRACKED_ITEMS":
          return t({
            id: "officeAddin.word.selection.trackedItems",
            message:
              "Track Changes is on, and this passage holds fields, links, notes or comments that a tracked rewrite would mark as changed. Turn Track Changes off to replace it. Nothing was replaced.",
          });
        case "TARGET_RANGE_UNPROVEN":
          return t({
            id: "officeAddin.word.selection.rangeUnproven",
            message:
              "Word could not pinpoint the passage inside its paragraph. Nothing was replaced.",
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

/** A Replace whose text is, or may be, in the document. */
const holdsPassage = (review: WordReviewState) =>
  (review.status === "done" && review.selection?.status === "applied") ||
  (review.status === "write-failed" &&
    review.selection?.status === "unverified");

/** Erato's Undo removes a sibling only while it still holds the single revert slot and was not
 * refused; past that, only Word can, and Ask again stays the way forward. */
function siblingRemovalOf(
  key: string,
  review: WordReviewState,
  slot: WordRevertSlot | null,
  identity: string | null,
): SiblingRemoval {
  if (review.selection?.status === "applied" && review.selection.trackingOn)
    return "reject";
  return slot?.selection &&
    slot.batchKey === key &&
    slot.identity === identity &&
    isWordRevertOffered(slot.selection.backups.length) &&
    !review.revertStale &&
    !review.revertFailed
    ? "undo"
    : "word";
}

const isStale = (result: WordReplaceSelectionResult | undefined) =>
  result?.status === "refused" &&
  [
    "TARGET_TEXT_MISMATCH",
    "TARGET_NOT_FOUND",
    "AMBIGUOUS_TARGET",
    "TARGET_RANGE_UNPROVEN",
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
  // Identical versions in one answer share this key and so one review: they write the same text,
  // so each card shows the other's Replace and Undo.
  const batchKey = `${messageId ?? ""}:${entry.action}:${content}`;
  const review = reviews.get(batchKey) ?? EMPTY_WORD_REVIEW;
  const result = review.selection;
  const messageCapture = messageId
    ? capturesByAssistantMessageId.get(messageId)
    : undefined;
  // A version written onto a copy the user picked holds another passage, so it is not counted.
  const sibling = useMemo(() => {
    if (!messageId || !messageCapture) return undefined;
    const versions = `${messageId}:${entry.action}:`;
    for (const [key, other] of reviews)
      if (
        key !== batchKey &&
        key.startsWith(versions) &&
        other.capture === messageCapture &&
        holdsPassage(other)
      )
        return { key, review: other };
    return undefined;
  }, [reviews, messageId, messageCapture, entry.action, batchKey]);
  const siblingRemoval =
    sibling &&
    siblingRemovalOf(sibling.key, sibling.review, revertSlot, documentIdentity);
  const severalVersions = useMemo(
    () => countWordReplaceFences(extractTextFromContent(message?.content)) > 1,
    [message?.content],
  );
  const cardRef = useWordReviewFocus(
    `${review.status}:${!!review.detailsExpanded}`,
  );
  const detailsId = useId();
  const [revertConfirmation, setRevertConfirmation] = useState(false);
  const [copyNote, setCopyNote] = useState("");
  const [actionNote, setActionNote] = useState("");
  const capture = messageCapture ?? review.capture;
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
  const replacement = useMemo(() => {
    if (!rewritable) return null;
    const split = splitWordSelectionReplacement(
      content,
      rewritable.shape,
      rewritable.paragraphCount,
    );
    if ("refused" in split) return split;
    const pieces = wordSelectionLinePieces(rewritable.paragraphs, split.lines);
    return "refused" in pieces ? pieces : split;
  }, [content, rewritable]);
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
  // With several versions the user picks one, so none is applied or opened for confirmation alone.
  const proposedAction =
    !severalVersions &&
    artifact?.proposedClientAction &&
    (offeredActions as string[]).includes(artifact.proposedClientAction)
      ? (artifact.proposedClientAction as WordClientAction)
      : undefined;
  const idle =
    review.status === "idle" ||
    review.status === "no-capture" ||
    review.status === "identity-mismatch" ||
    review.status === "reverted";
  const applying = review.status === "applying";

  /** Runs inside an operation the caller began, and ends it. */
  const replaceOn = useCallback(
    async (target: WordSelectionCapture): Promise<boolean> => {
      updateReview(batchKey, {
        status: "applying",
        applyStage: "checking",
        capture: target,
        refusedForSibling: undefined,
      });
      let held = false;
      try {
        const run = await entry.execute({
          fenceContent: content,
          capture: target,
          onStage: (applyStage) => updateReview(batchKey, { applyStage }),
        });
        const outcome = run.selectionResult;
        if (!outcome) {
          updateReview(batchKey, { status: "error", applyStage: undefined });
          return false;
        }
        // Any stale refusal here comes from the sibling's write. Without paragraph IDs it shows as
        // AMBIGUOUS_TARGET for a copy elsewhere, whose pick would write onto that copy.
        if (sibling && target === sibling.review.capture && isStale(outcome)) {
          updateReview(batchKey, {
            status: "idle",
            applyStage: undefined,
            selection: undefined,
            refusedForSibling: true,
          });
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
          (outcome.status === "applied" && !outcome.backups?.length)
        )
          setRevertSlot(null);
        if (outcome.status === "applied") {
          if (outcome.backups?.length && messageId)
            setRevertSlot({
              messageId,
              batchKey,
              identity: target.identity,
              ooxml: outcome.backups[0].ooxml,
              selection: {
                written: outcome.written,
                backups: outcome.backups,
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
    },
    [
      updateReview,
      batchKey,
      entry,
      content,
      sibling,
      holdOperationUntil,
      messageId,
      setRevertSlot,
      artifact,
      decisions,
      facetId,
      enforcedAskActions,
      endOperation,
    ],
  );
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
    return replaceOn(live.capture);
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
    replaceOn,
  ]);
  // The same reviewed proposal on the passage the user now selects, never a guess between copies.
  const replaceSelected = useCallback(async () => {
    if (!rewritable || offeredActions.length === 0 || !beginOperation()) return;
    setActionNote("");
    const unread = () =>
      t({
        id: "officeAddin.word.selection.pickUnread",
        message: "Erato could not read your selection. Try again.",
      });
    let target: WordSelectionCapture | null = null;
    let note = "";
    try {
      const read = await captureWordSelection();
      const picked =
        read.status === "ok" && read.value && documentIdentity
          ? emptySelectionCapture(documentIdentity, read.value)
          : null;
      const live = resolveWordWriteGate({
        capture: picked ?? undefined,
        expectedIdentity: artifact?.itemIdentity,
        currentIdentity: documentIdentity,
      });
      if (read.status === "failed") note = unread();
      else if (
        !picked?.selection ||
        !isSameWordPassage(rewritable, picked.selection)
      )
        note = t({
          id: "officeAddin.word.selection.pickDifferent",
          message:
            "The selected text is not exactly the passage from your request. Nothing was replaced.",
        });
      else if (!rewritableWordSelection(picked))
        note = wordSelectionReasonText(picked.selection.reasonCode);
      else if (!live.allowed)
        note = t({
          id: "officeAddin.word.selection.otherDocument",
          message:
            "This answer was written for a passage in another document, so it cannot be replaced here.",
        });
      // The final check trusts the pick's own flag, but the card announced only the request's.
      else if (
        picked.selection.flattensEmphasis &&
        !rewritable.flattensEmphasis
      )
        note = t({
          id: "officeAddin.word.selection.pickEmphasis",
          message:
            "The selected passage has bold, italic, underlined or struck-through words that the passage in your request did not have. Replace would remove that formatting, so nothing was replaced.",
        });
      else target = live.capture;
    } catch {
      note = unread();
    }
    if (target) {
      await replaceOn(target);
      return;
    }
    endOperation();
    setActionNote(note);
  }, [
    rewritable,
    offeredActions.length,
    beginOperation,
    documentIdentity,
    artifact,
    replaceOn,
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
    updateReview(batchKey, {
      status: "reverting",
      revertStale: undefined,
      revertFailed: undefined,
    });
    let held = false;
    try {
      const reverted = await revertWordSelection(
        slot.selection.backups,
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
        updateReview(batchKey, {
          status: "done",
          revertFailed: reverted.timedOut ? "timed-out" : "failed",
          detailsExpanded: true,
        });
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
    setActionNote(
      t({
        id: "officeAddin.word.selection.askAgainNote",
        message:
          "Your request is back in the message box. Select the passage you mean, then send.",
      }),
    );
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
  const refusedRemoval = review.refusedForSibling ? siblingRemoval : undefined;
  const statusMessage =
    heldOperationOwner === batchKey
      ? notRespondingText()
      : (revertText(review) ??
        (refusedRemoval && siblingRefusedText(refusedRemoval)) ??
        (review.status === "denied"
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
                    : undefined));
  const completed =
    review.status === "done" ||
    review.status === "denied" ||
    review.status === "reverted";
  const collapsed =
    completed &&
    !review.detailsExpanded &&
    !review.revertStale &&
    !review.revertFailed;
  const canReplace = gate.allowed && idle && offeredActions.length > 0;
  const ambiguous =
    result?.status === "refused" &&
    result.code === "AMBIGUOUS_TARGET" &&
    gate.allowed &&
    offeredActions.length > 0;
  const askAgain =
    (isStale(result) && !ambiguous) ||
    (!!refusedRemoval && refusedRemoval !== "undo");
  const revertOffered =
    !slot || isWordRevertOffered(slot.selection.backups.length);
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
              {rewritable?.flattensEmphasis && (
                <p className="word-review__hint">
                  {t({
                    id: "officeAddin.word.selection.flattensEmphasis",
                    message:
                      "After Replace, bold, italic, underlined or struck-through words in this passage take the paragraph's usual formatting.",
                  })}
                </p>
              )}
              {siblingRemoval && !review.refusedForSibling && (
                <p className="word-review__hint">
                  {siblingHintText(siblingRemoval)}
                </p>
              )}
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
          {ambiguous && (
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.selection.pickHint",
                message:
                  "Select the one you mean in Word, then choose Replace selected passage. It is replaced only if its text is exactly the same.",
              })}
            </p>
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
            {ambiguous && (
              <Button
                type="button"
                variant="primary"
                disabled={operationInProgress}
                onClick={() => void replaceSelected()}
              >
                {t({
                  id: "officeAddin.word.selection.replacePicked",
                  message: "Replace selected passage",
                })}
              </Button>
            )}
            {askAgain && (
              <Button
                type="button"
                variant="secondary"
                disabled={operationInProgress}
                onClick={useCurrentSelection}
              >
                {t({
                  id: "officeAddin.word.selection.askAgain",
                  message: "Ask again with current selection",
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
          {actionNote && (
            <p className="word-review__hint" role="status">
              {actionNote}
            </p>
          )}
          <WordUndoLine
            canRevert={!!slot && review.status === "done" && revertOffered}
            label={wordUndoLabel()}
            disabled={operationInProgress}
            onUndo={() => setRevertConfirmation(true)}
            testId="word-selection-undo"
          />
          {applied && slot && revertOffered && (
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.selection.undoReplaced",
                message: "Applying another change ends this Undo.",
              })}
            </p>
          )}
          {applied && slot && !revertOffered && review.status === "done" && (
            <p className="word-review__hint">
              {t({
                id: "officeAddin.word.selection.undoInWord",
                message: `To undo this Replace, use Word's own Undo in the document (Ctrl+Z, or ⌘Z on a Mac). In Word for the web, Erato's Undo covers up to ${WORD_WEB_REVERT_MAX_PARAGRAPHS} paragraphs.`,
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
                {slot && slot.selection.backups.length > 1
                  ? t({
                      id: "officeAddin.word.selection.revertWarningParagraphs",
                      message:
                        "Restore every paragraph of the passage as it was before this Replace? Nothing is restored if any of them changed since.",
                    })
                  : t({
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
          original={
            selection
              ? wordKeptMarkersShown(selection.selectedText, selection)
              : null
          }
          proposed={
            selection ? wordKeptMarkersShown(proposal, selection) : proposal
          }
        />
      </WordReviewHeader>
    </WordReviewCard>
  );
}
