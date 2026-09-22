import type { WordDocumentArgs } from "./buildWordDocumentArgs";
import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type { ActionFacetRequest } from "@erato/frontend/library";

export const WORD_DOCUMENT_REVIEW_FACET_ID = "word_document_review";
export const WORD_AUTHORING_FACET_ID = "word_document_authoring";
export const WORD_COMPOSE_FACET_ID = "word_compose";

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
        ...input.documentArgs,
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
