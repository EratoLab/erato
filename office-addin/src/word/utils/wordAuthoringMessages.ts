import { t } from "@lingui/core/macro";

import type { WordDocumentDiagnostic } from "./wordApplyDocumentPlan";
import type { WordPlanIssue } from "./wordDocumentPlan";

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
  if (
    diagnostic.reason === "host-unavailable" ||
    diagnostic.reason === "wrong-request"
  )
    return wordAuthoringIssueText("no-capture");
  return wordAuthoringIssueText(diagnostic.reason);
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
