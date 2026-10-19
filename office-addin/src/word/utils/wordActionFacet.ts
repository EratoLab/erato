import {
  MAX_WORD_SCOPE_BYTES,
  MAX_WORD_SCOPE_TARGETS,
  WORD_COMMENT_MAP_ARG,
  WORD_COMMENT_THREAD_FACET_ID,
  WORD_COMMENTS_JSON_ARG,
  WORD_THREAD_JSON_ARG,
} from "@erato/frontend/word-review";

import { wordSelectionWithoutKeptItems } from "./wordSelectionAnchor";
import { wordSelectionFacetArgs } from "./wordSelectionArgs";
import { advertisedFacetArgs } from "../../core/clientActions/actionFacetArgs";

import type {
  WordDocumentArgs,
  WordDocumentBuild,
} from "./buildWordDocumentArgs";
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
  anchoredComments?: string;
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

/** Authoring has nothing to read after a failed package capture, nor under Track Changes, where
 * review sends the accepted text instead. A capture merely too large for a complete read sets
 * completeReadIssue and keeps its scoped reads. */
const REVIEW_FALLBACK_ISSUES = new Set([
  "too-large",
  "unavailable",
  "tracking",
]);

export function wordReviewFallbackApplies(
  issue: WordAuthoringSnapshot["issue"],
  hasContent: boolean,
  availableFacetIds: ReadonlySet<string>,
): boolean {
  return (
    !!issue &&
    REVIEW_FALLBACK_ISSUES.has(issue) &&
    hasContent &&
    availableFacetIds.has(WORD_DOCUMENT_REVIEW_FACET_ID)
  );
}

/** Authoring that cannot read the document gives the model nothing; review still sends its text. */
export function withWordReviewFallback(
  build: WordDocumentBuild,
  availableFacetIds: ReadonlySet<string>,
): WordDocumentBuild {
  return wordReviewFallbackApplies(
    build.authoring?.issue,
    build.coverage.hasContent,
    availableFacetIds,
  )
    ? { ...build, authoring: undefined }
    : build;
}

export interface WordActionFacetInput {
  chipEnabled: boolean;
  documentName: string;
  documentIdentity: string;
  documentArgs: WordDocumentArgs | null;
  hasContent: boolean;
  authoring?: WordAuthoringSnapshot;
  availableFacetIds: ReadonlySet<string>;
  /** Optional arguments, such as comment_map, go only where they are advertised. */
  availableFacetArgs?: ReadonlyMap<string, ReadonlySet<string>>;
  /** The whole document's comment map (wordCommentSend.ts); empty without one. */
  commentMap?: string;
  /** Read with Track Changes on, so review offers no paragraph edits. */
  trackChanges?: boolean;
}

const WORD_REVIEW_STATUS_ARG = "review_status";

/** Which document facet goes, before any of its arguments are built. */
export function wordDocumentFacetChoice(input: {
  authoring: boolean;
  hasContent: boolean;
  availableFacetIds: ReadonlySet<string>;
}): string | null {
  if (input.authoring && input.availableFacetIds.has(WORD_AUTHORING_FACET_ID))
    return WORD_AUTHORING_FACET_ID;
  if (input.hasContent)
    return input.availableFacetIds.has(WORD_DOCUMENT_REVIEW_FACET_ID)
      ? WORD_DOCUMENT_REVIEW_FACET_ID
      : null;
  return input.availableFacetIds.has(WORD_COMPOSE_FACET_ID)
    ? WORD_COMPOSE_FACET_ID
    : null;
}

/** Supply every configured argument to avoid literal placeholders.
 * Repeat context on each turn because earlier facet instructions are removed from replay. */
export function resolveWordActionFacet(
  input: WordActionFacetInput,
): ActionFacetRequest | undefined {
  if (!input.chipEnabled) return undefined;
  if (input.documentArgs === null) return undefined;
  const commentMap = (facetId: string): Record<string, string> =>
    input.availableFacetArgs?.get(facetId)?.has(WORD_COMMENT_MAP_ARG)
      ? { [WORD_COMMENT_MAP_ARG]: input.commentMap ?? "" }
      : {};

  const choice = wordDocumentFacetChoice({
    authoring: !!input.authoring,
    hasContent: input.hasContent,
    availableFacetIds: input.availableFacetIds,
  });
  if (choice === null) return undefined;
  if (input.authoring && choice === WORD_AUTHORING_FACET_ID) {
    return {
      id: WORD_AUTHORING_FACET_ID,
      args: {
        document_name: input.documentName,
        document_identity: input.documentIdentity,
        ...wordAuthoringDocumentArgs(
          input.documentArgs,
          input.authoring.completeReadIssue,
        ),
        document_snapshot: input.authoring.token,
        authoring_status: wordAuthoringStatus(input.authoring),
        ...commentMap(WORD_AUTHORING_FACET_ID),
      },
    };
  }
  if (choice === WORD_DOCUMENT_REVIEW_FACET_ID) {
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
        ...commentMap(WORD_DOCUMENT_REVIEW_FACET_ID),
        ...(input.availableFacetArgs
          ?.get(WORD_DOCUMENT_REVIEW_FACET_ID)
          ?.has(WORD_REVIEW_STATUS_ARG)
          ? { [WORD_REVIEW_STATUS_ARG]: wordReviewStatus(input.trackChanges) }
          : {}),
      },
    };
  }

  return {
    id: WORD_COMPOSE_FACET_ID,
    args: {
      document_name: input.documentName,
      document_identity: input.documentIdentity,
    },
  };
}

/**
 * word_comment_thread (O-26): one thread in thread_json and the envelope around it in
 * comments_json; an empty thread_json carries the open threads alone. Unavailable unless both are
 * advertised.
 */
export function resolveWordCommentThreadFacet(input: {
  documentName: string;
  documentIdentity: string;
  threadJson: string;
  commentsJson: string;
  availableFacetIds: ReadonlySet<string>;
  availableFacetArgs: ReadonlyMap<string, ReadonlySet<string>>;
}): ActionFacetRequest | undefined {
  const allowed = input.availableFacetArgs.get(WORD_COMMENT_THREAD_FACET_ID);
  if (
    !input.availableFacetIds.has(WORD_COMMENT_THREAD_FACET_ID) ||
    !allowed?.has(WORD_THREAD_JSON_ARG) ||
    !allowed.has(WORD_COMMENTS_JSON_ARG)
  )
    return undefined;
  return {
    id: WORD_COMMENT_THREAD_FACET_ID,
    args: advertisedFacetArgs(
      {
        document_name: input.documentName,
        document_identity: input.documentIdentity,
        [WORD_THREAD_JSON_ARG]: input.threadJson,
        [WORD_COMMENTS_JSON_ARG]: input.commentsJson,
      },
      allowed,
    ),
  };
}

function wordReviewStatus(trackChanges: boolean | undefined): string {
  return trackChanges
    ? "read-only: Track Changes is on. The text is the document with every pending tracked change accepted; it does not show what was changed or by whom. Paragraph edits cannot be applied: give any new wording in plain prose, with no erato-word-edits block and no propose_client_action call."
    : "available";
}

function wordAuthoringStatus(authoring: WordAuthoringSnapshot): string {
  if (authoring.issue)
    return `${authoring.issue}${authoring.issueDetails?.length ? ` (${authoring.issueDetails.join(", ")})` : ""}`;
  // Starts with "available" because the facet prompt only submits plans when the status is available.
  if (authoring.completeReadIssue)
    return `available for scoped reads and scoped edits only. Complete reads, whole-document plans and repairs are unavailable (${authoring.completeReadIssue}: the document exceeds the complete-read limit). target, target.queries and table_cell reads work, up to ${MAX_WORD_SCOPE_TARGETS} targets and ${MAX_WORD_SCOPE_BYTES / 1024} KiB per response; submit scoped_edit or table_cell changes.`;
  return "available";
}

/** Authoring starts with identity and counts only. Tools explicitly deliver content.
 * Used by hosts independently of Office.js; review-only captures keep their excerpt.
 */
export function wordAuthoringDocumentArgs(
  args: WordDocumentArgs,
  completeReadIssue?: WordAuthoringSnapshot["completeReadIssue"],
): WordDocumentArgs {
  return {
    ...args,
    document_text: "",
    heading_outline: "",
    paragraphs_sent: "0",
    truncation_note: completeReadIssue
      ? "No paragraphs are included in this initial context. The document is too large to read completely: read only the parts the request needs with read_document_blocks target, target.queries or table_cell, and say which parts an answer covers."
      : "Document content is available through read_document_blocks; no paragraphs are included in this initial context.",
  };
}
