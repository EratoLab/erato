import { WORD_COMMENT_THREAD_FACET_ID } from "@erato/frontend/word-review";
import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import { NO_WORD_COMMENT_LIST } from "../../hooks/useWordComments";
import { buildWordDocumentArgs } from "../buildWordDocumentArgs";
import {
  resolveWordActionFacet,
  resolveWordSelectionFacet,
  WORD_AUTHORING_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
  wordDocumentFacetInput,
  wordDocumentSendInput,
  wordSelectionForFacets,
} from "../wordActionFacet";
import {
  wordSelectionEstimateSnapshot,
  wordSendEstimateFacet,
} from "../wordSendEstimate";
import { previewWordSend } from "../wordSendPreview";

import type {
  WordCommentList,
  WordCommentListThread,
} from "../../hooks/useWordComments";
import type { WordDocumentBuild } from "../buildWordDocumentArgs";
import type { WordCommentAdvertised } from "../wordCommentSend";
import type { WordSelectionPreview } from "../wordSelectionCapture";
import type { WordSendPreviewInput } from "../wordSendPreview";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

const FACETS = new Set([
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_AUTHORING_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_SELECTION_FACET_ID,
  WORD_COMMENT_THREAD_FACET_ID,
]);
const ARGS = new Map<string, ReadonlySet<string>>([
  [
    WORD_SELECTION_FACET_ID,
    new Set([
      "document_name",
      "selected_text",
      "paragraph_count",
      "truncated",
      "kept_items",
      "anchored_comments",
    ]),
  ],
  [WORD_DOCUMENT_REVIEW_FACET_ID, new Set(["comment_map", "review_status"])],
  [WORD_AUTHORING_FACET_ID, new Set(["comment_map"])],
  [WORD_COMMENT_THREAD_FACET_ID, new Set(["thread_json", "comments_json"])],
]);
const NO_COMMENTS: WordCommentAdvertised = {
  anchored: false,
  thread: false,
  map: new Set(),
};
const EVERY_COMMENT: WordCommentAdvertised = {
  anchored: true,
  thread: true,
  map: new Set([WORD_DOCUMENT_REVIEW_FACET_ID, WORD_AUTHORING_FACET_ID]),
};

const paragraphs = (texts: string[]) =>
  texts.map((text, index) => ({
    ordinal: index + 1,
    text,
    uniqueLocalId: `p${index + 1}`,
    styleBuiltIn: "Normal",
    outlineLevel: 10,
  }));

const capture = (
  over: Partial<WordDocumentBuild> = {},
  texts = ["Clause one.", "Clause two."],
): WordDocumentBuild => ({
  ...buildWordDocumentArgs(paragraphs(texts)),
  ...over,
});

const passage: WordSelectionPreview = {
  key: "k1",
  text: "The Supplier shall deliver.\nThe Buyer shall pay.",
  paragraphCount: 2,
  shape: "multi_paragraph",
  story: "main",
  truncated: false,
  mayRewrite: true,
};

const thread = (
  ref: string,
  over: Partial<WordCommentListThread> = {},
): WordCommentListThread => ({
  ref,
  commentId: ref,
  author: "Jonas Weber",
  status: "open",
  quote: "delivery date",
  text: "Can we move this to Friday?",
  replies: 0,
  lastActivity: null,
  pos: 1,
  para: 1,
  inSelection: false,
  ...over,
});

const list = (threads: WordCommentListThread[]): WordCommentList => ({
  ...NO_WORD_COMMENT_LIST,
  status: "ready",
  threads,
  counts: {
    open: threads.filter((entry) => entry.status === "open").length,
    resolved: threads.filter((entry) => entry.status === "resolved").length,
  },
});

const preview = (over: Partial<WordSendPreviewInput>) =>
  previewWordSend({
    advertised: NO_COMMENTS,
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
    availableFacetIds: FACETS,
    ...over,
  });

const inputs = {
  documentName: "Supply agreement.docx",
  documentIdentity: "doc-1",
  availableFacetIds: FACETS,
  availableFacetArgs: ARGS,
  selection: passage,
  build: null as WordDocumentBuild | null,
  comments: NO_WORD_COMMENT_LIST,
};

/** What the Send resolves for the document, from the same capture. */
const sendDocumentFacet = (
  build: WordDocumentBuild,
  availableFacetIds: ReadonlySet<string> = FACETS,
) =>
  resolveWordActionFacet(
    wordDocumentFacetInput({
      ...wordDocumentSendInput(build, availableFacetIds),
      documentName: inputs.documentName,
      documentIdentity: inputs.documentIdentity,
      availableFacetIds,
      availableFacetArgs: ARGS,
    }),
  );

beforeEach(() => i18n.activate("en"));

describe("wordSendEstimateFacet", () => {
  it("builds the passage's facet as the Send's resolver does", () => {
    const facet = wordSendEstimateFacet(preview({ passageGoes: true }), inputs);
    expect(facet).toEqual(
      resolveWordSelectionFacet({
        selection: wordSelectionForFacets(
          wordSelectionEstimateSnapshot(passage),
          ARGS,
        ),
        documentName: inputs.documentName,
        documentIdentity: inputs.documentIdentity,
        availableFacetIds: FACETS,
        availableFacetArgs: ARGS,
      }),
    );
    expect(facet?.args?.selected_text).toBe(passage.text);
    expect(facet?.args?.paragraph_count).toBe("2");
  });

  it("drops kept_items where the server does not take it", () => {
    const without = new Map(ARGS);
    without.set(
      WORD_SELECTION_FACET_ID,
      new Set(["document_name", "selected_text"]),
    );
    const facet = wordSendEstimateFacet(preview({ passageGoes: true }), {
      ...inputs,
      availableFacetArgs: without,
    });
    expect(Object.keys(facet?.args ?? {}).sort()).toEqual([
      "document_name",
      "selected_text",
    ]);
  });

  it("builds the document's facet from the last capture as the Send prepares it", () => {
    const build = capture();
    const facet = wordSendEstimateFacet(preview({}), { ...inputs, build });
    expect(facet?.id).toBe(WORD_DOCUMENT_REVIEW_FACET_ID);
    expect(facet).toEqual(sendDocumentFacet(build));
    expect(facet?.args?.document_text).toContain("Clause one.");
  });

  it("estimates a Track Changes capture as read-only, as the Send sends it", () => {
    const build = capture({ trackChanges: true });
    const facet = wordSendEstimateFacet(preview({}), { ...inputs, build });
    expect(facet).toEqual(sendDocumentFacet(build));
    expect(facet?.args?.review_status).toMatch(/^read-only/);
  });

  it("falls back to review for an authoring capture too large to edit", () => {
    const build = capture({
      authoring: {
        token: "t",
        issue: "too-large",
      } as WordAuthoringSnapshot,
    });
    const facet = wordSendEstimateFacet(preview({ authoring: false }), {
      ...inputs,
      build,
    });
    expect(facet?.id).toBe(WORD_DOCUMENT_REVIEW_FACET_ID);
    expect(facet).toEqual(sendDocumentFacet(build));
  });

  it("estimates authoring by what it sends up front: no paragraphs", () => {
    const build = capture({
      authoring: { token: "t" } as WordAuthoringSnapshot,
    });
    const facet = wordSendEstimateFacet(preview({ authoring: true }), {
      ...inputs,
      build,
    });
    expect(facet?.id).toBe(WORD_AUTHORING_FACET_ID);
    expect(facet).toEqual(sendDocumentFacet(build));
    expect(facet?.args?.document_text).toBe("");
  });

  it("stands the listed threads in for the comment map while the map goes", () => {
    const build = capture();
    const comments = list([thread("t1"), thread("t2", { pos: 2 })]);
    const facet = wordSendEstimateFacet(
      preview({ advertised: EVERY_COMMENT }),
      { ...inputs, build, comments },
    );
    expect(facet?.args?.comment_map).toContain(
      "Can we move this to Friday?".slice(0, 20),
    );
  });

  it("stands the chip's thread in for a comment that goes", () => {
    const comments = list([thread("t1")]);
    const facet = wordSendEstimateFacet(
      preview({
        advertised: EVERY_COMMENT,
        documentIncluded: false,
        pick: "t1",
      }),
      { ...inputs, comments },
    );
    expect(facet?.id).toBe(WORD_COMMENT_THREAD_FACET_ID);
    expect(facet?.args?.thread_json).toContain("Can we move this to Friday?");
    expect(facet?.args?.comments_json).toBe("");
  });

  it("stands the open threads in for open comments", () => {
    const comments = list([
      thread("t1"),
      thread("t2", { status: "resolved", text: "Done." }),
    ]);
    const sendPreview = preview({
      advertised: EVERY_COMMENT,
      documentIncluded: false,
      includeOpenComments: true,
    });
    expect(sendPreview.carrier).toBe("open-comments");
    const facet = wordSendEstimateFacet(sendPreview, { ...inputs, comments });
    expect(facet?.args?.thread_json).toBe("");
    expect(facet?.args?.comments_json).toContain("Can we move this");
    expect(facet?.args?.comments_json).not.toContain("Done.");
  });

  it("has nothing to estimate when nothing goes, or nothing is read yet", () => {
    expect(
      wordSendEstimateFacet(preview({ documentIncluded: false }), inputs),
    ).toBeUndefined();
    expect(wordSendEstimateFacet(preview({}), inputs)).toBeUndefined();
    expect(
      wordSendEstimateFacet(preview({ passageGoes: true }), {
        ...inputs,
        selection: null,
      }),
    ).toBeUndefined();
  });
});
