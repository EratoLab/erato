import { plural, t } from "@lingui/core/macro";

import { wordRouteGroup } from "./wordInPlaceRoute";

import type { WordDocumentDiagnostic } from "./wordApplyDocumentPlan";
import type { WordApplyStage } from "./wordApplyProgress";
import type { WordPlanIssue } from "./wordDocumentPlan";
import type { WordApplyAdjustment } from "./wordFullDocumentComparison";
import type { WordPlanRoute, WordRouteGroup } from "./wordInPlaceRoute";

export function wordDocumentDiagnosticText(
  diagnostic: WordDocumentDiagnostic,
  restoring = false,
): string {
  if (diagnostic.reason === "source-changed")
    return restoring
      ? t({
          id: "officeAddin.word.authoring.revertStale",
          message:
            "The document changed after applying. Revert was not run because it could remove later edits.",
        })
      : t({
          id: "officeAddin.word.authoring.stale",
          message:
            "The document changed. Nothing was applied. Send a new request to refresh the plan.",
        });
  if (diagnostic.reason === "output-mismatch")
    return restoring
      ? t({
          id: "officeAddin.word.authoring.restoreUnverified",
          message:
            "Word could not verify the restored document. Your saved original is still available for recovery.",
        })
      : t({
          id: "officeAddin.word.authoring.outputUnverified",
          message:
            "Word wrote changes, but the result could not be verified. Your original is saved for recovery.",
        });
  if (diagnostic.reason === "package-growth")
    return restoring
      ? t({
          id: "officeAddin.word.authoring.restorePackageGrowth",
          message:
            "Word added duplicate document data while restoring. Your saved original is still available for recovery.",
        })
      : t({
          id: "officeAddin.word.authoring.packageGrowth",
          message:
            "Word added duplicate document data while writing. Your original is saved for recovery.",
        });
  if (diagnostic.reason === "compile-failed")
    return t({
      id: "officeAddin.word.authoring.compileFailed",
      message:
        "The proposed Word structure could not be prepared. No changes were made. Ask for a new rewrite.",
    });
  if (diagnostic.reason === "host-error")
    return ["write", "verify", "restore"].includes(diagnostic.stage)
      ? t({
          id: "officeAddin.word.authoring.writeInterrupted",
          message:
            "Word could not complete the operation. The document may be partially changed. Your original is saved for recovery.",
        })
      : t({
          id: "officeAddin.word.authoring.readFailed",
          message:
            "Word could not read the document for this operation. No changes were made.",
        });
  if (diagnostic.reason === "tracking" && diagnostic.details?.fallbackReasons)
    return wordTrackingNeedsImportText();
  if (
    diagnostic.reason === "host-unavailable" ||
    diagnostic.reason === "wrong-request"
  )
    return wordAuthoringIssueText("no-capture");
  return wordAuthoringIssueText(diagnostic.reason);
}

function wordTrackingNeedsImportText(): string {
  return t({
    id: "officeAddin.word.authoring.trackingNeedsImport",
    message:
      "This change needs a full-document rewrite, which can't run while Track Changes is on. Turn off Track Changes or ask for a smaller edit.",
  });
}

/** One line before Apply on how the plan will be written; Apply decides again with live state. */
export function wordRoutePreviewText(
  route: WordPlanRoute,
  passages: number,
): string | undefined {
  switch (route.route) {
    case "body":
      return t({
        id: "officeAddin.word.route.body",
        message: "Replaces the document body.",
      });
    case "blocked":
      return wordTrackingNeedsImportText();
    case "in-place":
      if (!route.ops.length) return undefined;
      return route.tracked
        ? t({
            id: "officeAddin.word.route.tracked",
            message: plural(passages, {
              one: "Edits # passage in place as tracked changes under your name.",
              other:
                "Edits # passages in place as tracked changes under your name.",
            }),
          })
        : t({
            id: "officeAddin.word.route.inPlace",
            message: plural(passages, {
              one: "Edits # passage in place.",
              other: "Edits # passages in place.",
            }),
          });
    case "import":
      return wordImportRouteText(wordRouteGroup(route.reason));
  }
}

function wordImportRouteText(group: WordRouteGroup): string {
  switch (group) {
    case "sections":
      return t({
        id: "officeAddin.word.route.import.sections",
        message:
          "Replaces the whole document because it changes sections or page layout.",
      });
    case "stories":
      return t({
        id: "officeAddin.word.route.import.stories",
        message:
          "Replaces the whole document because it changes headers, footers, notes or comments.",
      });
    case "moves":
      return t({
        id: "officeAddin.word.route.import.moves",
        message: "Replaces the whole document because it moves content.",
      });
    case "objects":
      return t({
        id: "officeAddin.word.route.import.objects",
        message:
          "Replaces the whole document because it changes tables, images or other objects.",
      });
    case "formatting":
      return t({
        id: "officeAddin.word.route.import.formatting",
        message:
          "Replaces the whole document because it changes formatting or styles.",
      });
    case "lists":
      return t({
        id: "officeAddin.word.route.import.lists",
        message: "Replaces the whole document because it changes lists.",
      });
    case "paragraphs":
      return t({
        id: "officeAddin.word.route.import.paragraphs",
        message:
          "Replaces the whole document because it adds, removes or splits paragraphs.",
      });
    case "setting":
      return t({
        id: "officeAddin.word.route.import.setting",
        message:
          "Replaces the whole document because compatibility mode is on.",
      });
    case "unavailable":
      return t({
        id: "officeAddin.word.route.import.unavailable",
        message: "Replaces the whole document (in-place editing is off).",
      });
    default:
      return t({
        id: "officeAddin.word.route.import.other",
        message:
          "Replaces the whole document because this change can't be written in place.",
      });
  }
}

export function wordPlanVerifiedText(): string {
  return t({
    id: "officeAddin.word.authoring.verified",
    message: "Verified: the document matches the proposal.",
  });
}

export function wordPlanAdjustedHeadline(): string {
  return t({
    id: "officeAddin.word.authoring.appliedAdjusted",
    message: "Applied with Word adjustments",
  });
}

/** The content tier passed; any visible adjustment is listed after this. */
export function wordPlanAdjustedText(): string {
  return t({
    id: "officeAddin.word.authoring.adjusted",
    message:
      "Word adjusted some details on its own while writing; the content matches the proposal.",
  });
}

export function wordUnverifiedPassagesText(count: number): string {
  return t({
    id: "officeAddin.word.authoring.unverifiedPassages",
    message: plural(count, {
      one: "Word wrote the changes, but # passage doesn't match the proposal. Your original is saved for recovery.",
      other:
        "Word wrote the changes, but # passages don't match the proposal. Your original is saved for recovery.",
    }),
  });
}

export function wordPartlyWrittenText(applied: number, total: number): string {
  return t({
    id: "officeAddin.word.authoring.partlyWritten",
    message: `Word stopped after ${applied} of ${total} changes. Your original is saved.`,
  });
}

/** Word attributes tracked changes to the signed-in user; the add-in cannot choose the author. */
export function wordTrackedApplyText(): string {
  return t({
    id: "officeAddin.word.authoring.appliedTracked",
    message: "Applied as tracked changes under your name.",
  });
}

/** Only visible adjustments have text; list bookkeeping is not something a reader can see. */
export function wordApplyAdjustmentText(
  adjustment: WordApplyAdjustment,
): string | undefined {
  switch (adjustment) {
    case "first-paragraph-spacing":
      return t({
        id: "officeAddin.word.authoring.adjustment.firstParagraphSpacing",
        message: "Word also changed the spacing before the first paragraph.",
      });
    default:
      return undefined;
  }
}

export function wordAuthoringIssueText(
  issue: WordPlanIssue,
  details: readonly string[] = [],
): string {
  switch (issue) {
    case "incomplete":
      return t({
        id: "officeAddin.word.authoring.incomplete",
        message:
          "The complete document has not been read for this plan. Ask for a new rewrite that reads every source block.",
      });
    case "expired":
      return t({
        id: "officeAddin.word.authoring.expired",
        message:
          "This document snapshot is no longer active. Include the document in a new request.",
      });
    case "unsupported":
      return (
        details.map(wordAuthoringDetailText).join(" ") ||
        t({
          id: "officeAddin.word.authoring.unsupported",
          message:
            "Word did not supply a complete editable structure for this document. No rewrite was applied.",
        })
      );
    case "protected-content":
      return t({
        id: "officeAddin.word.authoring.protectedOperation",
        message:
          "This proposal changes or removes protected native content. Ask for a revised plan that retains these objects and rewrites the surrounding text.",
      });
    case "section-order":
      return t({
        id: "officeAddin.word.authoring.sectionOrder",
        message:
          "This proposal reorders section boundaries without specifying their new layout. Ask for a complete ordered section plan.",
      });
    case "tracking":
      return t({
        id: "officeAddin.word.authoring.tracking",
        message:
          "Document restructuring is unavailable with the current Track Changes state. The add-in has not changed that setting.",
      });
    case "model-budget":
      return t({
        id: "officeAddin.word.authoring.modelBudget",
        message:
          "The complete rewrite cannot fit the selected model’s available context. Start a shorter chat or choose a model with more context.",
      });
    case "budget-unavailable":
      return details.includes("estimate-timeout")
        ? t({
            id: "officeAddin.word.authoring.budgetTimeout",
            message:
              "The model context check timed out. Try sending your request again. No document changes were made.",
          })
        : t({
            id: "officeAddin.word.authoring.budgetUnavailable",
            message:
              "The model context check failed. Try sending your request again. No document changes were made.",
          });
    case "too-large":
      return t({
        id: "officeAddin.word.authoring.tooLarge",
        message:
          "This document exceeds the current complete-document rewrite limit. No partial rewrite will be applied.",
      });
    case "invalid":
      return t({
        id: "officeAddin.word.authoring.invalid",
        message:
          "The proposed document plan is incomplete or invalid. Ask for a corrected plan; nothing was applied.",
      });
    default:
      return t({
        id: "officeAddin.word.authoring.noCapture",
        message:
          "This pane cannot verify the source document for this rewrite. Include it in a new request.",
      });
  }
}

function wordAuthoringDetailText(detail: string): string {
  switch (detail) {
    case "locked-content-control":
      return t({
        id: "officeAddin.word.authoring.lockedContent",
        message:
          "A locked content control prevents replacing this document body.",
      });
    case "unbalanced-anchors":
      return t({
        id: "officeAddin.word.authoring.unbalancedAnchors",
        message:
          "A bookmark or annotation extends beyond the captured content. Its complete range is needed for restructuring.",
      });
    case "unbalanced-fields":
      return t({
        id: "officeAddin.word.authoring.unbalancedFields",
        message:
          "A document field is incomplete in the captured content. Its complete range is needed for restructuring.",
      });
    case "unreadable-imported-content":
      return t({
        id: "officeAddin.word.authoring.importedContent",
        message:
          "The body contains imported content that Word has not expanded into readable document blocks.",
      });
    case "missing-related-content":
      return t({
        id: "officeAddin.word.authoring.missingContent",
        message:
          "Word did not include all content linked to this body. Restructuring is unavailable because those objects could not be preserved.",
      });
    default:
      return t({
        id: "officeAddin.word.authoring.unverifiedContent",
        message:
          "The captured document structure could not be verified for restructuring.",
      });
  }
}

export function wordApplyStageLabel(stage: WordApplyStage | undefined): string {
  switch (stage) {
    case "backup":
      return t({
        id: "officeAddin.word.apply.stage.backup",
        message: "Saving backup…",
      });
    case "writing":
      return t({
        id: "officeAddin.word.apply.stage.writing",
        message: "Applying…",
      });
    case "verifying":
      return t({
        id: "officeAddin.word.apply.stage.verifying",
        message: "Verifying…",
      });
    default:
      return t({
        id: "officeAddin.word.apply.stage.checking",
        message: "Checking document…",
      });
  }
}
