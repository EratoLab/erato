import { WORD_COMMENT_THREAD_FACET_ID } from "@erato/frontend/word-review";
import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  quotedSelection,
  selectionExcerpt,
} from "../../../core/selection/selectionExcerpt";
import {
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import {
  resolveWordActionFacet,
  resolveWordCommentThreadFacet,
  resolveWordSelectionFacet,
  WORD_AUTHORING_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
} from "../wordActionFacet";
import { readWordComments } from "../wordCommentReader";
import {
  createWordCommentRefRegistry,
  forgetWordCommentRefs,
} from "../wordCommentRefs";
import {
  wordAnchoredCommentsArg,
  wordCommentMapArg,
  wordCommentSendExact,
  wordCommentSendRead,
  wordCommentThreadArgs,
} from "../wordCommentSend";
import { wordDocumentChip, wordSelectionChip } from "../wordContextChips";
import { previewWordSend } from "../wordSendPreview";
import { wordSentWithDescriptors } from "../wordSentWith";

import type { WordCommentSendRead } from "../wordCommentSend";
import type {
  WordDocumentChipInput,
  WordSelectionChipInput,
} from "../wordContextChips";
import type { WordSelectionSnapshot } from "../wordSelectionAnchor";
import type { ActionFacetRequest } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

const ALL_FACETS = new Set([
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_AUTHORING_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_SELECTION_FACET_ID,
  WORD_COMMENT_THREAD_FACET_ID,
]);
const REVIEW_ONLY = new Set([
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_SELECTION_FACET_ID,
]);
const SELECTION_ARGS = new Set([
  "document_name",
  "document_identity",
  "selected_text",
  "paragraph_count",
  "truncated",
  "anchored_comments",
]);
const FACET_ARGS = new Map<string, ReadonlySet<string>>([
  [WORD_SELECTION_FACET_ID, SELECTION_ARGS],
  [WORD_DOCUMENT_REVIEW_FACET_ID, new Set(["comment_map", "review_status"])],
  [WORD_AUTHORING_FACET_ID, new Set(["comment_map"])],
  [WORD_COMMENT_THREAD_FACET_ID, new Set(["thread_json", "comments_json"])],
]);

const NAME = "Supply agreement.docx";

const sentChip = (facet: ActionFacetRequest) => {
  const chips = wordSentWithDescriptors[facet.id](facet.args ?? {});
  expect(chips).toHaveLength(1);
  return chips![0];
};

const reviewArgs = (sent: number, total: number, truncationNote = "") => ({
  document_text: "Clause 1.",
  heading_outline: "",
  paragraphs_sent: String(sent),
  paragraphs_total: String(total),
  truncation_note: truncationNote,
});

const documentFacet = (input: {
  sent?: number;
  total?: number;
  truncationNote?: string;
  hasContent?: boolean;
  authoring?: WordAuthoringSnapshot;
  trackChanges?: boolean;
  commentMap?: string;
  facets?: ReadonlySet<string>;
}) =>
  resolveWordActionFacet({
    chipEnabled: true,
    documentName: NAME,
    documentIdentity: "doc-1",
    documentArgs: reviewArgs(
      input.sent ?? input.total ?? 86,
      input.total ?? 86,
      input.truncationNote,
    ),
    hasContent: input.hasContent ?? true,
    authoring: input.authoring,
    availableFacetIds: input.facets ?? ALL_FACETS,
    availableFacetArgs: FACET_ARGS,
    trackChanges: input.trackChanges,
    commentMap: input.commentMap,
  })!;

const NO_COMMENTS = { anchored: false, thread: false, map: new Set<string>() };

/** The composer's document chip on the same facts, as WordChatInput builds it. */
const composerDocument = (overrides: Partial<WordDocumentChipInput>) => {
  const document: WordDocumentChipInput = {
    available: true,
    included: true,
    status: "included",
    reading: false,
    coverage: {
      paragraphsSent: 86,
      paragraphsTotal: 86,
      truncated: false,
      partialParagraph: false,
      hasContent: true,
    },
    changed: false,
    authoringRoute: false,
    readInParts: false,
    trackChanges: false,
    lastingIssue: null,
    bodyOnly: false,
    ...overrides,
  };
  const preview = previewWordSend({
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
    authoring: document.authoringRoute,
    hasContent: document.coverage?.hasContent ?? false,
    unreadable: false,
    availableFacetIds: ALL_FACETS,
  });
  return wordDocumentChip({ preview, selection: null, document })!;
};

const composerSelection = (overrides: Partial<WordSelectionChipInput>) => {
  const selection: WordSelectionChipInput = {
    text: "The Supplier shall deliver.\nThe Buyer shall pay.",
    paragraphCount: 2,
    truncated: false,
    armed: true,
    dismissed: false,
    readFailed: false,
    ...overrides,
  };
  const preview = previewWordSend({
    advertised: NO_COMMENTS,
    precedence: "selection",
    pick: null,
    pickFound: true,
    override: null,
    withoutComments: false,
    includeOpenComments: false,
    documentIncluded: true,
    passageGoes: true,
    commentSelection: { kind: "passage", threads: [], rewritable: false },
    authoring: false,
    hasContent: true,
    unreadable: false,
    availableFacetIds: ALL_FACETS,
  });
  return wordSelectionChip({
    preview,
    selection,
    document: {
      available: true,
      included: true,
      status: "included",
      reading: false,
      coverage: null,
      changed: false,
      authoringRoute: false,
      readInParts: false,
      trackChanges: false,
      lastingIssue: null,
      bodyOnly: false,
    },
  })!;
};

const snapshot = (
  overrides: Partial<WordSelectionSnapshot> = {},
): WordSelectionSnapshot => ({
  role: "context_only",
  reasonCode: null,
  shape: "inline",
  story: "main",
  origin: "user",
  selectedText: "The Supplier shall deliver.\nThe Buyer shall pay.",
  truncated: false,
  paragraphCount: 2,
  paragraphs: [],
  startOffset: 0,
  endOffset: 0,
  occurrence: 0,
  anchor: null,
  contextBefore: "",
  contextAfter: "",
  ...overrides,
});

const selectionFacet = (
  selection: WordSelectionSnapshot,
  anchoredComments?: string,
) =>
  resolveWordSelectionFacet({
    selection,
    documentName: NAME,
    documentIdentity: "doc-1",
    availableFacetIds: ALL_FACETS,
    availableFacetArgs: FACET_ARGS,
    anchoredComments,
  })!;

const NOW = new Date("2026-10-12T09:30:00Z");

async function commentRead(
  selection: { tag: string; offset: number },
  passage: { first: number; last: number; start: number; end: number } | null,
): Promise<WordCommentSendRead> {
  const host = installWordCommentHost({ selection });
  const result = await readWordComments({
    selection: true,
    replies: "requested",
    exact: (threads, live) =>
      wordCommentSendExact(threads, { passage, live, pickedId: null }),
    now: host.now,
  });
  if (!result.ok) throw new Error(result.error);
  return wordCommentSendRead({
    result,
    registry: createWordCommentRefRegistry("doc"),
    passage,
    people: { principalEmail: "maya.kruger@contoso.test" },
    now: NOW,
    userTz: "Europe/Berlin",
  });
}

beforeEach(() => {
  i18n.activate("en");
  forgetWordCommentRefs();
});
afterEach(() => uninstallWordCommentHost());

describe("Word sent-with descriptors", () => {
  describe("the document", () => {
    it("names a whole review document as the composer did", () => {
      const chip = sentChip(documentFacet({ total: 86 }));
      expect(chip).toMatchObject({
        kind: "word.document",
        icon: "document",
        label: NAME,
        meta: "86 ¶",
        spokenLabel: "Document",
      });
      expect(chip.meta).toBe(composerDocument({}).meta);
    });

    it("says how much of a long document went", () => {
      const chip = sentChip(documentFacet({ sent: 120, total: 300 }));
      expect(chip.meta).toBe("First 120 of 300 ¶");
      expect(chip.meta).toBe(
        composerDocument({
          coverage: {
            paragraphsSent: 120,
            paragraphsTotal: 300,
            truncated: true,
            partialParagraph: false,
            hasContent: true,
          },
        }).meta,
      );
    });

    it("says only the beginning went of a first paragraph too long to send", () => {
      const chip = sentChip(
        documentFacet({
          sent: 1,
          total: 5,
          truncationNote:
            "Paragraph 1 is included only in part, because it alone exceeds the send limit.",
        }),
      );
      expect(chip.meta).toBe("Beginning only");
      expect(chip.meta).toBe(
        composerDocument({
          coverage: {
            paragraphsSent: 1,
            paragraphsTotal: 5,
            truncated: true,
            partialParagraph: true,
            hasContent: true,
          },
        }).meta,
      );
    });

    it("leads with Track Changes when the review was read-only", () => {
      const chip = sentChip(
        documentFacet({ total: 86, trackChanges: true, facets: REVIEW_ONLY }),
      );
      expect(chip.meta).toBe("Track Changes on · 86 ¶");
      expect(chip.meta).toBe(composerDocument({ trackChanges: true }).meta);
    });

    it("names an authored document by its paragraph count", () => {
      const chip = sentChip(
        documentFacet({
          total: 86,
          authoring: { token: "t" } as WordAuthoringSnapshot,
        }),
      );
      expect(chip.meta).toBe("86 ¶");
      expect(chip.meta).toBe(composerDocument({ authoringRoute: true }).meta);
    });

    it("leads an authored document read in parts with that fact", () => {
      const chip = sentChip(
        documentFacet({
          total: 86,
          authoring: {
            token: "t",
            completeReadIssue: "too-large",
          } as WordAuthoringSnapshot,
        }),
      );
      expect(chip.meta).toBe("Read in parts · 86 ¶");
      expect(chip.meta).toBe(
        composerDocument({ authoringRoute: true, readInParts: true }).meta,
      );
    });

    it("calls an empty document a new one", () => {
      const facet = documentFacet({ total: 0, hasContent: false });
      expect(facet.id).toBe(WORD_COMPOSE_FACET_ID);
      const chip = sentChip(facet);
      expect(chip.meta).toBe("New document");
      expect(chip.meta).toBe(
        composerDocument({
          status: "empty",
          coverage: {
            paragraphsSent: 0,
            paragraphsTotal: 0,
            truncated: false,
            partialParagraph: false,
            hasContent: false,
          },
        }).meta,
      );
    });

    it("counts the comment map the request carried, as the composer did", async () => {
      const read = await commentRead({ tag: "END", offset: 0 }, null);
      const listed = read.model.threads.length;
      expect(listed).toBeGreaterThan(0);
      const chip = sentChip(
        documentFacet({ total: 86, commentMap: wordCommentMapArg(read, []) }),
      );
      const composer = composerDocument({
        comments: {
          count: listed,
          lines: [],
          off: false,
          mapOff: false,
          readFailed: false,
          offerChoose: false,
        },
      });
      expect(chip.meta).toBe(composer.meta);
      expect(chip.meta).toMatch(/^86 ¶ · \d+ comments?$/);
    });

    it("names an unnamed document as the composer does", () => {
      const facet = documentFacet({ total: 3 });
      expect(
        sentChip({ ...facet, args: { ...facet.args, document_name: "" } })
          .label,
      ).toBe("This document");
    });

    it("keeps a chip without the meta for args an older server did not take", () => {
      expect(
        sentChip({
          id: WORD_DOCUMENT_REVIEW_FACET_ID,
          args: { document_name: NAME },
        }),
      ).toEqual({
        id: "word.document",
        kind: "word.document",
        icon: "document",
        label: NAME,
        spokenLabel: "Document",
      });
    });
  });

  describe("the passage", () => {
    it("quotes the passage and counts its paragraphs as the composer did", () => {
      const selection = snapshot();
      const chip = sentChip(selectionFacet(selection));
      const composer = composerSelection({});
      expect(chip).toMatchObject({
        kind: "word.selection",
        icon: "selection",
        spokenLabel: "Selection",
        quote: selection.selectedText,
      });
      expect(chip.label).toBe(quotedSelection(selectionExcerpt(composer.text)));
      expect(chip.meta).toBe(composer.meta);
      expect(chip.meta).toBe("Selected passage · 2 ¶");
    });

    it("says a cut passage went in part", () => {
      const chip = sentChip(selectionFacet(snapshot({ truncated: true })));
      expect(chip.meta).toBe("Too long · beginning only");
      expect(chip.meta).toBe(composerSelection({ truncated: true }).meta);
    });

    it("leads with the passage's comments the request carried", async () => {
      const read = await commentRead({ tag: "T1P", offset: 22 }, null);
      const threads = read.model.threads
        .slice(0, 1)
        .map(({ thread }) => thread.id);
      const chip = sentChip(
        selectionFacet(snapshot(), wordAnchoredCommentsArg(read, threads)),
      );
      expect(chip.meta).toBe("1 comment · 2 ¶");
      expect(chip.meta).toBe(
        composerSelection({
          comments: {
            count: 1,
            checked: true,
            threads: [],
            why: null,
            coverage: { heading: "", lines: [] },
            switchTo: null,
            offerChoose: false,
            canChangeDefault: false,
            readFailed: false,
          },
        }).meta,
      );
    });

    it("keeps a chip without counts when the server took no paragraph_count", () => {
      const chip = sentChip({
        id: WORD_SELECTION_FACET_ID,
        args: { selected_text: "Alpha." },
      });
      expect(chip.label).toBe(quotedSelection(selectionExcerpt("Alpha.")));
      expect(chip.meta).toBeUndefined();
    });
  });

  describe("the comment thread", () => {
    const threadFacet = (
      read: WordCommentSendRead,
      ref: string | null,
      why: "chosen" | "cursor" | null,
    ) => {
      const { threadJson, commentsJson } = wordCommentThreadArgs(
        read,
        ref,
        why,
      );
      return resolveWordCommentThreadFacet({
        documentName: NAME,
        documentIdentity: "doc-1",
        threadJson,
        commentsJson,
        availableFacetIds: ALL_FACETS,
        availableFacetArgs: FACET_ARGS,
      })!;
    };

    it("names a chosen thread by its author and why it went", async () => {
      const read = await commentRead({ tag: "END", offset: 0 }, null);
      const { thread } = read.model.threads[0];
      const chip = sentChip(threadFacet(read, thread.id, "chosen"));
      expect(chip).toMatchObject({
        kind: "word.comment",
        icon: "comment",
        label: `Comment by ${thread.entries[0].by}`,
        meta: "Chosen by you",
        spokenLabel: "Chosen comment",
      });
    });

    it("says a thread at the cursor went because of where the cursor was", async () => {
      const read = await commentRead({ tag: "END", offset: 0 }, null);
      const chip = sentChip(
        threadFacet(read, read.model.threads[0].thread.id, "cursor"),
      );
      expect(chip.meta).toBe("At your cursor");
      expect(chip.spokenLabel).toBe("Comments");
    });

    it("counts the open comments an empty thread_json carried", async () => {
      const read = await commentRead({ tag: "END", offset: 0 }, null);
      const open = read.model.threads.filter(
        ({ thread }) => thread.status === "open",
      ).length;
      const chip = sentChip(threadFacet(read, null, null));
      expect(chip).toMatchObject({
        kind: "word.openComments",
        icon: "comments",
        label: `Open comments (${open})`,
        spokenLabel: "Open comments",
      });
    });

    it("shows nothing for a thread argument that does not parse", () => {
      expect(
        wordSentWithDescriptors[WORD_COMMENT_THREAD_FACET_ID]({
          thread_json: "{not json",
          comments_json: "{}",
        }),
      ).toBeNull();
    });
  });
});
