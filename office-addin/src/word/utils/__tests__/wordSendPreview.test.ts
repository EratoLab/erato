import { WORD_COMMENT_THREAD_FACET_ID } from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  WORD_AUTHORING_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
} from "../wordActionFacet";
import { previewWordSend } from "../wordSendPreview";

import type { WordCommentAdvertised } from "../wordCommentSend";
import type { WordSendPreviewInput } from "../wordSendPreview";

const EVERYTHING: WordCommentAdvertised = {
  anchored: true,
  thread: true,
  map: new Set([WORD_DOCUMENT_REVIEW_FACET_ID, WORD_AUTHORING_FACET_ID]),
};
const NO_COMMENTS: WordCommentAdvertised = {
  anchored: false,
  thread: false,
  map: new Set(),
};
const ALL_FACETS = new Set([
  WORD_AUTHORING_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_SELECTION_FACET_ID,
  WORD_COMMENT_THREAD_FACET_ID,
]);

const input = (
  overrides: Partial<WordSendPreviewInput> = {},
): WordSendPreviewInput => ({
  advertised: EVERYTHING,
  precedence: "selection",
  pick: null,
  pickFound: true,
  override: null,
  withoutComments: false,
  includeOpenComments: false,
  documentIncluded: true,
  passageGoes: false,
  commentSelection: { kind: "none" },
  authoring: false,
  hasContent: true,
  unreadable: false,
  availableFacetIds: ALL_FACETS,
  ...overrides,
});

const passage = (threads: string[], rewritable = true) => ({
  kind: "passage" as const,
  threads,
  rewritable,
});

describe("previewWordSend", () => {
  it.each([
    [{ authoring: true }, WORD_AUTHORING_FACET_ID],
    [{}, WORD_DOCUMENT_REVIEW_FACET_ID],
    [{ hasContent: false }, WORD_COMPOSE_FACET_ID],
  ])("sends the included document (%o)", (overrides, facetId) => {
    const result = previewWordSend(input(overrides));
    expect(result).toMatchObject({
      carrier: "document",
      facetId,
      document: "sent",
    });
    expect(result.comments.carrier).toEqual({ kind: "map" });
  });

  it("sends an armed passage instead of the document", () => {
    expect(
      previewWordSend(
        input({ passageGoes: true, commentSelection: passage([]) }),
      ),
    ).toMatchObject({
      carrier: "selection",
      facetId: WORD_SELECTION_FACET_ID,
      document: "replaced-by-selection",
    });
  });

  it("keeps the document for a passage Erato selected", () => {
    // Shown but not armed, so the passage does not go.
    expect(previewWordSend(input({ passageGoes: false })).document).toBe(
      "sent",
    );
  });

  it("sends the caret's thread instead of the document", () => {
    expect(
      previewWordSend(
        input({ commentSelection: { kind: "caret", threads: ["c1"] } }),
      ),
    ).toMatchObject({
      carrier: "comment",
      facetId: WORD_COMMENT_THREAD_FACET_ID,
      document: "replaced-by-comment",
    });
  });

  it("sends a passage's thread in place of both when the comment wins", () => {
    const result = previewWordSend(
      input({
        passageGoes: true,
        precedence: "comment",
        commentSelection: passage(["c1"]),
      }),
    );
    expect(result).toMatchObject({
      carrier: "comment",
      document: "replaced-by-comment",
    });
    expect(result.comments.carrier).toEqual({ kind: "thread", ref: "c1" });
  });

  it("keeps the document while two threads wait for a choice", () => {
    const result = previewWordSend(
      input({ commentSelection: { kind: "caret", threads: ["c1", "c2"] } }),
    );
    expect(result.comments.block).toBe("choose-comment");
    expect(result.document).toBe("sent");
    expect(result.carrier).toBe("document");
  });

  it("keeps the passage label while a picked thread is gone", () => {
    const result = previewWordSend(
      input({
        passageGoes: true,
        commentSelection: passage([]),
        pick: "c9",
        pickFound: false,
      }),
    );
    expect(result.comments.block).toBe("picked-gone");
    expect(result.document).toBe("replaced-by-selection");
  });

  it("sends the open comments with the document off", () => {
    expect(
      previewWordSend(
        input({ documentIncluded: false, includeOpenComments: true }),
      ),
    ).toMatchObject({
      carrier: "open-comments",
      facetId: WORD_COMMENT_THREAD_FACET_ID,
      document: "off",
    });
  });

  it("sends nothing with the document off and no comments asked for", () => {
    expect(previewWordSend(input({ documentIncluded: false }))).toMatchObject({
      carrier: "none",
      facetId: null,
      document: "off",
    });
  });

  it("drops the thread carrier when sending without comments", () => {
    expect(
      previewWordSend(
        input({
          withoutComments: true,
          commentSelection: { kind: "caret", threads: ["c1"] },
        }),
      ),
    ).toMatchObject({ carrier: "document", document: "sent" });
  });

  describe("the selection's disposition", () => {
    it("sends an armed passage, with or without the document", () => {
      for (const documentIncluded of [true, false])
        expect(
          previewWordSend(
            input({
              documentIncluded,
              passageGoes: true,
              commentSelection: passage([]),
            }),
          ).selection,
        ).toBe("sent");
    });

    it("says a thread goes in the passage's place", () => {
      expect(
        previewWordSend(
          input({
            passageGoes: true,
            precedence: "comment",
            commentSelection: passage(["c1"]),
          }),
        ).selection,
      ).toBe("replaced-by-comment");
    });

    it("sends no passage that does not go: none, dismissed or still Erato's", () => {
      // A dismissed or unarmed passage reaches the preview as passageGoes false.
      expect(previewWordSend(input({ passageGoes: false })).selection).toBe(
        "not-sent",
      );
      expect(
        previewWordSend(
          input({ commentSelection: { kind: "caret", threads: ["c1"] } }),
        ).selection,
      ).toBe("not-sent");
      expect(
        previewWordSend(
          input({ documentIncluded: false, includeOpenComments: true }),
        ).selection,
      ).toBe("not-sent");
      expect(previewWordSend(input({ unreadable: true })).selection).toBe(
        "not-sent",
      );
    });
  });

  it("does not send a document no facet can carry", () => {
    expect(
      previewWordSend(
        input({
          advertised: NO_COMMENTS,
          availableFacetIds: new Set([WORD_COMPOSE_FACET_ID]),
        }),
      ),
    ).toMatchObject({ carrier: "none", facetId: null, document: "not-sent" });
    expect(previewWordSend(input({ unreadable: true })).document).toBe(
      "not-sent",
    );
  });
});
