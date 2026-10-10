import { wordSelectionWithoutKeptItems } from "./wordSelectionAnchor";
import { wordSelectionFacetArgs } from "./wordSelectionArgs";

import type { WordDocumentArgs } from "./buildWordDocumentArgs";
import type { WordSelectionSnapshot } from "./wordSelectionAnchor";
import type { ActionFacetRequest } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

export const WORD_DOCUMENT_REVIEW_FACET_ID = "word_document_review";
export const WORD_AUTHORING_FACET_ID = "word_document_authoring";
export const WORD_COMPOSE_FACET_ID = "word_compose";
export const WORD_SELECTION_FACET_ID = "word_selection";

/** Without selected_text the model would get the request but not the passage. */
export function wordSelectionFacetAvailable(
  availableFacetIds: ReadonlySet<string>,
  availableFacetArgs: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  return (
    availableFacetIds.has(WORD_SELECTION_FACET_ID) &&
    (availableFacetArgs.get(WORD_SELECTION_FACET_ID)?.has("selected_text") ??
      false)
  );
}

/**
 * A selection the Replace action can write takes the facet slot ahead of the document (D-28). One
 * that can only be context does not displace an included document (decision 2).
 */
export function wordSelectionTakesSlot(
  selection: WordSelectionSnapshot,
  documentIncluded: boolean,
): boolean {
  return selection.role === "rewrite" || !documentIncluded;
}

/**
 * The selection as the server can take it: a rewrite that keeps items needs the kept_items
 * argument that explains its markers, and is sent as context only where it is not advertised yet.
 */
export function wordSelectionForFacets(
  selection: WordSelectionSnapshot,
  availableFacetArgs: ReadonlyMap<string, ReadonlySet<string>>,
): WordSelectionSnapshot {
  const allowed = availableFacetArgs.get(WORD_SELECTION_FACET_ID);
  return allowed?.has("kept_items")
    ? selection
    : wordSelectionWithoutKeptItems(selection);
}

export function resolveWordSelectionFacet(input: {
  selection: WordSelectionSnapshot;
  documentName: string;
  documentIdentity: string;
  availableFacetIds: ReadonlySet<string>;
  availableFacetArgs: ReadonlyMap<string, ReadonlySet<string>>;
}): ActionFacetRequest | undefined {
  if (
    !wordSelectionFacetAvailable(
      input.availableFacetIds,
      input.availableFacetArgs,
    )
  )
    return undefined;
  return {
    id: WORD_SELECTION_FACET_ID,
    args: wordSelectionFacetArgs(
      input,
      input.availableFacetArgs.get(WORD_SELECTION_FACET_ID),
    ),
  };
}

export interface WordActionFacetInput {
  chipEnabled: boolean;
  documentName: string;
  documentIdentity: string;
  documentArgs: WordDocumentArgs | null;
  hasContent: boolean;
  authoring?: WordAuthoringSnapshot;
  availableFacetIds: ReadonlySet<string>;
}

/** Supply every configured argument to avoid literal placeholders.
 * Repeat context on each turn because earlier facet instructions are removed from replay. */
export function resolveWordActionFacet(
  input: WordActionFacetInput,
): ActionFacetRequest | undefined {
  if (!input.chipEnabled) return undefined;
  if (input.documentArgs === null) return undefined;

  if (input.authoring && input.availableFacetIds.has(WORD_AUTHORING_FACET_ID)) {
    return {
      id: WORD_AUTHORING_FACET_ID,
      args: {
        document_name: input.documentName,
        document_identity: input.documentIdentity,
        ...wordAuthoringDocumentArgs(input.documentArgs),
        document_snapshot: input.authoring.token,
        authoring_status: input.authoring.issue
          ? `${input.authoring.issue}${input.authoring.issueDetails?.length ? ` (${input.authoring.issueDetails.join(", ")})` : ""}`
          : "available",
      },
    };
  }
  if (input.hasContent) {
    if (!input.availableFacetIds.has(WORD_DOCUMENT_REVIEW_FACET_ID)) {
      return undefined;
    }
    return {
      id: WORD_DOCUMENT_REVIEW_FACET_ID,
      args: {
        document_name: input.documentName,
        document_text: input.documentArgs.document_text,
        heading_outline: input.documentArgs.heading_outline,
        paragraphs_sent: input.documentArgs.paragraphs_sent,
        paragraphs_total: input.documentArgs.paragraphs_total,
        truncation_note: input.documentArgs.truncation_note,
        document_identity: input.documentIdentity,
      },
    };
  }

  if (!input.availableFacetIds.has(WORD_COMPOSE_FACET_ID)) return undefined;
  return {
    id: WORD_COMPOSE_FACET_ID,
    args: {
      document_name: input.documentName,
      document_identity: input.documentIdentity,
    },
  };
}

/** Authoring starts with identity and counts only. Tools explicitly deliver content.
 * Used by hosts independently of Office.js; review-only captures keep their excerpt.
 */
export function wordAuthoringDocumentArgs(
  args: WordDocumentArgs,
): WordDocumentArgs {
  return {
    ...args,
    document_text: "",
    heading_outline: "",
    paragraphs_sent: "0",
    truncation_note:
      "Document content is available through read_document_blocks; no paragraphs are included in this initial context.",
  };
}
