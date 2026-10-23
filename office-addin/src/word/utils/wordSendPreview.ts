import { WORD_COMMENT_THREAD_FACET_ID } from "@erato/frontend/word-review";

import {
  WORD_SELECTION_FACET_ID,
  wordDocumentFacetChoice,
} from "./wordActionFacet";
import { resolveWordCommentSend } from "./wordCommentSend";

import type {
  WordCommentSendInput,
  WordCommentSendPlan,
  WordCommentSendSelection,
} from "./wordCommentSend";

export type WordSendCarrier =
  | "selection"
  | "document"
  | "comment"
  | "open-comments"
  | "none";

/**
 * What becomes of the document: it goes, a passage or a comment thread goes
 * in its place, it is switched off, or it is on but would not go (unreadable,
 * or no document facet advertised).
 */
export type WordDocumentDisposition =
  | "sent"
  | "replaced-by-selection"
  | "replaced-by-comment"
  | "off"
  | "not-sent";

/** What becomes of the user's passage: it goes, or a comment thread goes in its place. */
export type WordSelectionDisposition =
  | "sent"
  | "replaced-by-comment"
  | "not-sent";

export interface WordSendPreviewInput
  extends Pick<
    WordCommentSendInput,
    | "advertised"
    | "precedence"
    | "pick"
    | "pickFound"
    | "override"
    | "withoutComments"
    | "includeOpenComments"
  > {
  /** The document chip is on and a document facet is advertised. */
  documentIncluded: boolean;
  /** The passage is shown, armed and advertised; one still being read does not go yet. */
  passageGoes: boolean;
  /** The passage's threads when it goes, otherwise the caret's. */
  commentSelection: WordCommentSendSelection;
  /** The authoring route, not read-only. */
  authoring: boolean;
  hasContent: boolean;
  unreadable: boolean;
  availableFacetIds: ReadonlySet<string>;
}

export interface WordSendPreview {
  /** While `comments.block` waits, what goes once the user sends without comments. */
  carrier: WordSendCarrier;
  facetId: string | null;
  document: WordDocumentDisposition;
  /** The selection chip reads this, as the document chip reads `document`. */
  selection: WordSelectionDisposition;
  comments: WordCommentSendPlan;
}

/**
 * The Send's order (passage, then document, then comments) on what render
 * time knows, so the context chips state what the Send would carry. The Send
 * reads Word again and decides for itself.
 */
export function previewWordSend(input: WordSendPreviewInput): WordSendPreview {
  const resolveComments = (documentIncluded: boolean) =>
    resolveWordCommentSend({
      advertised: input.advertised,
      selection: input.commentSelection,
      precedence: input.precedence,
      pick: input.pick,
      pickFound: input.pickFound,
      override: input.override,
      withoutComments: input.withoutComments,
      documentIncluded,
      includeOpenComments: input.includeOpenComments,
      readFailed: false,
    });
  const thread = (
    comments: WordCommentSendPlan,
    document: WordDocumentDisposition,
  ): WordSendPreview => ({
    carrier: "comment",
    facetId: WORD_COMMENT_THREAD_FACET_ID,
    document,
    selection: input.passageGoes ? "replaced-by-comment" : "not-sent",
    comments,
  });

  if (input.passageGoes) {
    const comments = resolveComments(false);
    // A thread facet replaces the passage and the document alike.
    if (comments.carrier.kind === "thread")
      return thread(
        comments,
        input.documentIncluded ? "replaced-by-comment" : "off",
      );
    return {
      carrier: "selection",
      facetId: WORD_SELECTION_FACET_ID,
      document: input.documentIncluded ? "replaced-by-selection" : "off",
      selection: "sent",
      comments,
    };
  }

  if (input.documentIncluded) {
    const comments = resolveComments(true);
    if (comments.carrier.kind === "thread")
      return thread(comments, "replaced-by-comment");
    const facetId = input.unreadable
      ? null
      : wordDocumentFacetChoice({
          authoring: input.authoring,
          hasContent: input.hasContent,
          availableFacetIds: input.availableFacetIds,
        });
    return facetId
      ? {
          carrier: "document",
          facetId,
          document: "sent",
          selection: "not-sent",
          comments,
        }
      : {
          carrier: "none",
          facetId: null,
          document: "not-sent",
          selection: "not-sent",
          comments,
        };
  }

  const comments = resolveComments(false);
  if (comments.carrier.kind === "thread") return thread(comments, "off");
  if (comments.carrier.kind === "open-comments")
    return {
      carrier: "open-comments",
      facetId: WORD_COMMENT_THREAD_FACET_ID,
      document: "off",
      selection: "not-sent",
      comments,
    };
  return {
    carrier: "none",
    facetId: null,
    document: "off",
    selection: "not-sent",
    comments,
  };
}
