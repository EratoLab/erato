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

/**
 * Fence tags the Word cards render. Each must be listed verbatim in
 * `HostArtifact.cardFenceLanguages` (see `buildWordArtifact`) or the fences
 * fall back to plain code blocks, and both must match the tags ERMAIN-820's
 * facet templates teach the model — EXACTLY. Matching is case-sensitive and
 * there is deliberately no drifted-tag rescue: the drift path in the frontend
 * is gated on `bodyFormat`, which neither Word facet declares.
 */
export const WORD_EDITS_FENCE = "erato-word-edits";
export const WORD_PLAN_FENCE = "erato-word-document-plan";
export const WORD_INSERT_FENCE = "erato-word-insert";

export type WordClientAction =
  | "word.apply_edits"
  | "word.insert_at_cursor"
  | "word.apply_document_plan";

/** What an executor gets. */
export interface WordClientActionContext {
  /** The raw text inside this message's fence for the action. */
  fenceContent: string;
  /** The send-time capture this message was stamped with. */
  capture: WordDocumentCapture;
  messageId?: string;
  /** Retain recovery before entering a structural write, even if it later fails. */
  onBeforeDocumentWrite?: (before: string) => void;
}

/** What an executor reports back. */
export interface WordClientActionRun {
  /** Whether the document was actually written to. */
  ok: boolean;
  /** Per-edit report lines; a single-outcome action returns none. */
  outcomes: WordEditOutcome[];
  /** Pre-batch body snapshot backing Revert; `null` when nothing was written. */
  snapshotOoxml: string | null;
  hostFailed?: boolean;
  documentPlanResult?: WordDocumentApplyResult;
  resultAnchors?: ReadonlyMap<number, WordReviewAnchor>;
}

export interface WordClientActionEntry {
  action: WordClientAction;
  /**
   * The facets this action may be offered on. The backend's advertised
   * `client_actions` for the producing facet is the outer gate; this is the
   * client's own statement of which facet each action belongs to, so a facet
   * that advertises the wrong action can never surface it.
   */
  facetIds: readonly string[];
  /** The fence tag carrying this action's payload. */
  fenceLanguage: string;
  /**
   * Namespaces the once-per-message auto-prompt slot. Each action gets its own
   * scope on purpose: the slot is consumed on first evaluation whatever the
   * verdict, so a shared scope would let whichever card mounted first suppress
   * the other's prompt for the same message.
   */
  promptScope: string;
  /**
   * Called, not stored: `t()` resolves against the catalogue active at call
   * time, so a label captured at module scope would freeze the first locale.
   */
  displayLabel: () => string;
  execute: (context: WordClientActionContext) => Promise<WordClientActionRun>;
}

/**
 * Single registry for action membership, labels, facet availability and
 * execution. Cards dispatch through each entry's execute function.
 */
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

/** Registry order, fixed, and the order everything else displays in. */
const REGISTRY_ORDER = [...WORD_CLIENT_ACTIONS.keys()];

export function isImplementedClientAction(
  action: string,
): action is WordClientAction {
  return WORD_CLIENT_ACTIONS.has(action as WordClientAction);
}

/** Registry-derived label, shared by the card, the report and settings. */
export function clientActionDisplayLabel(action: WordClientAction): string {
  return WORD_CLIENT_ACTIONS.get(action)!.displayLabel();
}

/**
 * The backend-advertised actions for a facet, intersected with the registry,
 * in registry order. Consumed by the settings surface, which iterates every
 * advertised facet and has no facet-level opinion of its own.
 */
export function offerableWordClientActions(
  allowedActions: readonly string[] | undefined,
): WordClientAction[] {
  if (!allowedActions || allowedActions.length === 0) {
    return [];
  }
  return REGISTRY_ORDER.filter((action) => allowedActions.includes(action));
}

/**
 * {@link offerableWordClientActions} plus the registry's own facet gate: an
 * action is only ever offered on a facet its entry names. Both halves are
 * required — the advertised set is the security gate, the facet gate is the
 * client's guarantee that an edits card never appears on a compose answer.
 */
export function offerableWordClientActionsForFacet(
  facetId: string | undefined,
  allowedActions: readonly string[] | undefined,
): WordClientAction[] {
  if (!facetId) return [];
  return offerableWordClientActions(allowedActions).filter((action) =>
    WORD_CLIENT_ACTIONS.get(action)!.facetIds.includes(facetId),
  );
}

/** The registry entry whose fence carries this tag, if any. */
export function wordActionForFence(
  language: string,
): WordClientActionEntry | undefined {
  for (const entry of WORD_CLIENT_ACTIONS.values()) {
    if (entry.fenceLanguage === language) return entry;
  }
  return undefined;
}

/**
 * The Word binding of the host-neutral proposal validator. The validator is
 * never re-implemented here: the advertised-set check is the security-relevant
 * half and divergence between hosts is exactly what it exists to prevent.
 */
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
