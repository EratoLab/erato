import {
  resolveWordActionFacet,
  resolveWordCommentThreadFacet,
  resolveWordSelectionFacet,
  wordDocumentFacetInput,
  wordDocumentSendInput,
  wordSelectionForFacets,
} from "./wordActionFacet";
import {
  WORD_COMMENT_MAP_PAGE_ROWS,
  WORD_COMMENT_MAP_QUOTE_CHARS,
  wordCommentGist,
} from "./wordCommentMap";

import type { WordDocumentBuild } from "./buildWordDocumentArgs";
import type { WordSelectionSnapshot } from "./wordSelectionAnchor";
import type { WordSelectionPreview } from "./wordSelectionCapture";
import type { WordSendPreview } from "./wordSendPreview";
import type {
  WordCommentList,
  WordCommentListThread,
} from "../hooks/useWordComments";
import type { ActionFacetRequest } from "@erato/frontend/library";

export interface WordSendEstimateInput {
  documentName: string;
  documentIdentity: string;
  availableFacetIds: ReadonlySet<string>;
  availableFacetArgs: ReadonlyMap<string, ReadonlySet<string>>;
  /** The passage the selection chip shows. */
  selection: WordSelectionPreview | null;
  /** The last capture that landed; null before one has. */
  build: WordDocumentBuild | null;
  /** The comments the chips list. */
  comments: WordCommentList;
}

/**
 * The passage as render time knows it. The Send reads the selection again
 * with its neighbours and marks; this leaves those out, so the estimate is of
 * the passage itself.
 */
export function wordSelectionEstimateSnapshot(
  preview: WordSelectionPreview,
): WordSelectionSnapshot {
  return {
    role: "context_only",
    reasonCode: null,
    shape: preview.shape,
    story: preview.story,
    origin: "user",
    selectedText: preview.text,
    truncated: preview.truncated,
    paragraphCount: preview.paragraphCount,
    paragraphs: [],
    startOffset: 0,
    endOffset: 0,
    occurrence: 0,
    anchor: null,
    contextBefore: "",
    contextAfter: "",
  };
}

/**
 * Stand-ins for the comment envelopes, which the Send builds from a fresh read
 * of every thread: the threads the chips list, by author, quote and comment.
 */
const threadsStandIn = (threads: readonly WordCommentListThread[]) =>
  threads.length === 0
    ? ""
    : JSON.stringify(
        threads.map((thread) => ({
          by: thread.author,
          q: thread.quote,
          text: thread.text,
        })),
      );

const mapStandIn = (threads: readonly WordCommentListThread[]) =>
  threads.length === 0
    ? ""
    : JSON.stringify(
        threads.slice(0, WORD_COMMENT_MAP_PAGE_ROWS).map((thread) => ({
          by: thread.author,
          q: (thread.quote ?? "").slice(0, WORD_COMMENT_MAP_QUOTE_CHARS),
          g: wordCommentGist(thread.text),
        })),
      );

const threadsOf = (list: WordCommentList, refs: readonly string[]) => {
  const byRef = new Map(list.threads.map((thread) => [thread.ref, thread]));
  return refs.flatMap((ref) => {
    const thread = byRef.get(ref);
    return thread ? [thread] : [];
  });
};

/**
 * The facet the Send would build for what the preview says it carries, from
 * what render time knows, through the resolvers and input preparation the
 * Send itself uses. Its args are what the composer adds to the token
 * estimate. The comment carriers' envelopes are stand-ins built from the
 * listed threads (see threadsStandIn); the Send reads them afresh.
 */
export function wordSendEstimateFacet(
  preview: WordSendPreview,
  input: WordSendEstimateInput,
): ActionFacetRequest | undefined {
  const { carrier: commentCarrier } = preview.comments;
  switch (preview.carrier) {
    case "selection": {
      if (!input.selection) return undefined;
      return resolveWordSelectionFacet({
        selection: wordSelectionForFacets(
          wordSelectionEstimateSnapshot(input.selection),
          input.availableFacetArgs,
        ),
        documentName: input.documentName,
        documentIdentity: input.documentIdentity,
        availableFacetIds: input.availableFacetIds,
        availableFacetArgs: input.availableFacetArgs,
        ...(commentCarrier.kind === "selection"
          ? {
              anchoredComments: threadsStandIn(
                threadsOf(input.comments, commentCarrier.threads),
              ),
            }
          : {}),
      });
    }
    case "document": {
      if (!input.build) return undefined;
      const prepared = wordDocumentSendInput(
        input.build,
        input.availableFacetIds,
      );
      return resolveWordActionFacet(
        wordDocumentFacetInput({
          ...prepared,
          documentName: input.documentName,
          documentIdentity: input.documentIdentity,
          availableFacetIds: input.availableFacetIds,
          availableFacetArgs: input.availableFacetArgs,
          ...(commentCarrier.kind === "map"
            ? { commentMap: mapStandIn(input.comments.threads) }
            : {}),
        }),
      );
    }
    case "comment":
    case "open-comments": {
      const threads =
        commentCarrier.kind === "thread"
          ? threadsOf(input.comments, [commentCarrier.ref])
          : input.comments.threads.filter((thread) => thread.status === "open");
      const picked = commentCarrier.kind === "thread";
      return resolveWordCommentThreadFacet({
        documentName: input.documentName,
        documentIdentity: input.documentIdentity,
        threadJson: picked ? threadsStandIn(threads) : "",
        commentsJson: picked ? "" : threadsStandIn(threads),
        availableFacetIds: input.availableFacetIds,
        availableFacetArgs: input.availableFacetArgs,
      });
    }
    default:
      return undefined;
  }
}
