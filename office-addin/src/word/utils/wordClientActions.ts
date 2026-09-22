import { t } from "@lingui/core/macro";

import { applyWordDocumentPlan } from "./wordApplyDocumentPlan";
import { applyWordEdits } from "./wordApplyEdits";
import { parseWordEdits } from "./wordEditPlan";
import { insertWordTextAtCursor } from "./wordInsertText";
import { extractProposedClientAction as extractProposedClientActionFor } from "../../core/clientActions/proposedClientAction";

import type { WordDocumentApplyResult } from "./wordApplyDocumentPlan";
import type { WordDocumentCapture } from "./wordDocumentCapture";
import type { WordEditOutcome } from "./wordEditPlan";
import type { WordReviewAnchor } from "./wordReviewLocation";
import type { ContentPart } from "@erato/frontend/library";

export { CLIENT_ACTION_TOOL_NAME } from "../../core/clientActions/proposedClientAction";

/** Fence tags are case-sensitive and must match the renderer registration. */
export const WORD_EDITS_FENCE = "erato-word-edits";
export const WORD_PLAN_FENCE = "erato-word-document-plan";
export const WORD_INSERT_FENCE = "erato-word-insert";

export type WordClientAction =
  | "word.apply_edits"
  | "word.insert_at_cursor"
  | "word.apply_document_plan";

export interface WordClientActionContext {
  fenceContent: string;
  capture: WordDocumentCapture;
  messageId?: string;
  /** Retain recovery before entering a structural write, even if it later fails. */
  onBeforeDocumentWrite?: (before: string) => void;
}

export interface WordClientActionRun {
  ok: boolean;
  outcomes: WordEditOutcome[];
  snapshotOoxml: string | null;
  hostFailed?: boolean;
  documentPlanResult?: WordDocumentApplyResult;
  resultAnchors?: ReadonlyMap<number, WordReviewAnchor>;
}

export interface WordClientActionEntry {
  action: WordClientAction;
  facetIds: readonly string[];
  fenceLanguage: string;
  /** Use a separate scope per action: evaluation consumes the one-shot prompt even when denied. */
  promptScope: string;
  /** Evaluate labels at render time so locale changes take effect. */
  displayLabel: () => string;
  execute: (context: WordClientActionContext) => Promise<WordClientActionRun>;
}

export const WORD_CLIENT_ACTIONS: ReadonlyMap<
  WordClientAction,
  WordClientActionEntry
> = new Map<WordClientAction, WordClientActionEntry>([
  [
    "word.apply_document_plan",
    {
      action: "word.apply_document_plan",
      facetIds: ["word_document_authoring"],
      fenceLanguage: WORD_PLAN_FENCE,
      promptScope: "word-document-plan",
      displayLabel: () =>
        t({
          id: "officeAddin.word.authoring.apply",
          message: "Apply document rewrite",
        }),
      execute: async ({
        fenceContent,
        capture,
        messageId,
        onBeforeDocumentWrite,
      }) => {
        const result = await applyWordDocumentPlan(
          fenceContent,
          capture.authoring,
          messageId,
          onBeforeDocumentWrite,
        );
        return {
          ok: result.status === "applied",
          outcomes: [],
          snapshotOoxml: result.before ?? null,
          documentPlanResult: result,
          hostFailed: result.status === "interrupted",
        };
      },
    },
  ],
  [
    "word.apply_edits",
    {
      action: "word.apply_edits",
      facetIds: ["word_document_review", "word_document_authoring"],
      fenceLanguage: WORD_EDITS_FENCE,
      promptScope: "word-edits",
      displayLabel: () =>
        t({
          id: "officeAddin.word.clientActions.applyEdits",
          message: "Apply the changes to the document",
        }),
      execute: async ({ fenceContent, capture }) => {
        const edits = parseWordEdits(fenceContent);
        if (!edits) {
          return { ok: false, outcomes: [], snapshotOoxml: null };
        }
        const result = await applyWordEdits({ edits, capture });
        return {
          ok: result.outcomes.some((outcome) => outcome.status === "applied"),
          outcomes: result.outcomes,
          snapshotOoxml: result.snapshotOoxml,
          hostFailed: result.hostFailed,
          resultAnchors: result.resultAnchors,
        };
      },
    },
  ],
  [
    "word.insert_at_cursor",
    {
      action: "word.insert_at_cursor",
      facetIds: ["word_compose"],
      fenceLanguage: WORD_INSERT_FENCE,
      promptScope: "word-insert",
      displayLabel: () =>
        t({
          id: "officeAddin.word.clientActions.insertAtCursor",
          message: "Insert the text at the cursor",
        }),
      execute: async ({ fenceContent }) => ({
        ok: await insertWordTextAtCursor(fenceContent),
        outcomes: [],
        snapshotOoxml: null,
      }),
    },
  ],
]);

const REGISTRY_ORDER = [...WORD_CLIENT_ACTIONS.keys()];

export function isImplementedClientAction(
  action: string,
): action is WordClientAction {
  return WORD_CLIENT_ACTIONS.has(action as WordClientAction);
}

export function clientActionDisplayLabel(action: WordClientAction): string {
  return WORD_CLIENT_ACTIONS.get(action)!.displayLabel();
}

export function offerableWordClientActions(
  allowedActions: readonly string[] | undefined,
): WordClientAction[] {
  if (!allowedActions || allowedActions.length === 0) {
    return [];
  }
  return REGISTRY_ORDER.filter((action) => allowedActions.includes(action));
}

export function offerableWordClientActionsForFacet(
  facetId: string | undefined,
  allowedActions: readonly string[] | undefined,
): WordClientAction[] {
  if (!facetId) return [];
  return offerableWordClientActions(allowedActions).filter((action) =>
    WORD_CLIENT_ACTIONS.get(action)!.facetIds.includes(facetId),
  );
}

export function wordActionForFence(
  language: string,
): WordClientActionEntry | undefined {
  for (const entry of WORD_CLIENT_ACTIONS.values()) {
    if (entry.fenceLanguage === language) return entry;
  }
  return undefined;
}

export function extractProposedClientAction(
  content: ContentPart[] | undefined,
  allowedActions: readonly string[],
): WordClientAction | undefined {
  return extractProposedClientActionFor(
    content,
    allowedActions,
    isImplementedClientAction,
  );
}
