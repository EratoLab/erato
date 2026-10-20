import { WORD_COMMENT_THREAD_FACET_ID } from "@erato/frontend/word-review";
import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import {
  WORD_AUTHORING_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
} from "../wordActionFacet";
import { wordDocumentChip, wordSelectionChip } from "../wordContextChips";
import { previewWordSend } from "../wordSendPreview";

import type { WordDocumentStatus } from "../../hooks/useWordDocumentSource";
import type { WordCommentAdvertised } from "../wordCommentSend";
import type {
  WordContextChipInput,
  WordDocumentChipInput,
  WordSelectionChipInput,
} from "../wordContextChips";
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
const REVIEW_AND_COMPOSE = new Set([
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_SELECTION_FACET_ID,
  WORD_COMMENT_THREAD_FACET_ID,
]);
const DOCUMENT_FACETS = new Set([
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_COMPOSE_FACET_ID,
  WORD_AUTHORING_FACET_ID,
]);

const coverage = (sent: number, total = sent) => ({
  paragraphsSent: sent,
  paragraphsTotal: total,
  truncated: sent < total,
  partialParagraph: false,
  hasContent: total > 0,
});

const documentInput = (
  overrides: Partial<WordDocumentChipInput> = {},
): WordDocumentChipInput => ({
  available: true,
  included: true,
  status: "included",
  reading: false,
  coverage: coverage(86),
  changed: false,
  authoringRoute: false,
  readInParts: false,
  trackChanges: false,
  lastingIssue: null,
  bodyOnly: false,
  ...overrides,
});

const selectionInput = (
  overrides: Partial<WordSelectionChipInput> = {},
): WordSelectionChipInput => ({
  text: "Revenue grew in every region.\nCosts fell.",
  paragraphCount: 2,
  truncated: false,
  armed: true,
  dismissed: false,
  readFailed: false,
  ...overrides,
});

/** Feeds the preview what WordChatInput feeds it, so chips and preview see the same facts. */
function resolve({
  document = documentInput(),
  selection = null,
  send = {},
}: {
  document?: WordDocumentChipInput;
  selection?: WordSelectionChipInput | null;
  send?: Partial<WordSendPreviewInput>;
} = {}): WordContextChipInput {
  const preview = previewWordSend({
    advertised: NO_COMMENTS,
    precedence: "selection",
    pick: null,
    pickFound: true,
    override: null,
    withoutComments: false,
    includeOpenComments: false,
    documentIncluded: document.available && document.included,
    passageGoes: !!selection && selection.armed && !selection.dismissed,
    commentSelection: { kind: "none" },
    authoring: document.authoringRoute,
    hasContent: document.coverage?.hasContent ?? false,
    unreadable: document.status === "unreadable",
    availableFacetIds: REVIEW_AND_COMPOSE,
    ...send,
  });
  return { preview, selection, document };
}

beforeEach(() => {
  i18n.activate("en");
});

describe("wordSelectionChip", () => {
  it("offers no chip without a passage", () => {
    expect(wordSelectionChip(resolve())).toBeNull();
  });

  it("includes the user's passage, sent instead of the document", () => {
    const chip = wordSelectionChip(resolve({ selection: selectionInput() }));
    expect(chip).toMatchObject({
      state: "included",
      meta: "Selected passage · 2 ¶",
      removeLabel: "Dismiss selection",
      title: "Selected passage",
      paragraphs: "2 paragraphs",
      text: "Revenue grew in every region.\nCosts fell.",
      restoredAnnouncement:
        "Selection included. It is sent instead of the document.",
      lifetime: "Leaving it out lasts until the selection changes.",
    });
    expect(chip?.tone).toBeUndefined();
    expect(chip?.notes).toEqual([
      { tone: "info", text: "Sent instead of the document." },
    ]);
  });

  it("says nothing of the document while the document is off", () => {
    const chip = wordSelectionChip(
      resolve({
        document: documentInput({ included: false }),
        selection: selectionInput({ paragraphCount: 1 }),
      }),
    );
    expect(chip).toMatchObject({
      state: "included",
      meta: "Selected passage · 1 ¶",
      paragraphs: "1 paragraph",
      notes: [],
    });
    expect(chip?.restoredAnnouncement).toBeUndefined();
  });

  it("turns a dismissed passage suggested, with + to include it again", () => {
    const chip = wordSelectionChip(
      resolve({ selection: selectionInput({ dismissed: true }) }),
    );
    expect(chip).toMatchObject({
      state: "suggested",
      removeLabel: null,
      restore: "rearm",
      restoreLabel: "Include selection",
    });
    // The lane states the lifetime of a suggested chip without meta.
    expect(chip?.meta).toBeUndefined();
  });

  it("shows Erato's passage as suggested, with + only", () => {
    const chip = wordSelectionChip(
      resolve({
        selection: selectionInput({ armed: false, paragraphCount: 1 }),
      }),
    );
    expect(chip).toMatchObject({
      state: "suggested",
      meta: "Shown by Erato · 1 ¶",
      removeLabel: null,
      restore: "arm",
      restoreLabel: "Use this selection",
      title: "Passage Erato selected",
      notes: [
        {
          tone: "info",
          text: "Erato selected this passage. It is shown, but not sent until you use it.",
        },
      ],
    });
  });

  it("brings back and takes over Erato's passage after a dismissal", () => {
    expect(
      wordSelectionChip(
        resolve({
          selection: selectionInput({ armed: false, dismissed: true }),
        }),
      ),
    ).toMatchObject({
      restore: "rearm-and-arm",
      restoreLabel: "Use this selection",
    });
  });

  it("marks a passage the last Send could not read", () => {
    const chip = wordSelectionChip(
      resolve({ selection: selectionInput({ readFailed: true }) }),
    );
    expect(chip).toMatchObject({
      state: "error",
      tone: "error",
      meta: "Couldn't read · send again",
      removeLabel: "Dismiss selection",
    });
    expect(chip?.notes[0]).toMatchObject({ tone: "error" });
    expect(chip?.notes[0].text).toMatch(/could not read your selection/);
  });

  it("supersedes the passage when a thread goes in its place", () => {
    const chip = wordSelectionChip(
      resolve({
        selection: selectionInput(),
        send: {
          advertised: EVERYTHING,
          precedence: "comment",
          commentSelection: {
            kind: "passage",
            threads: ["c1"],
            rewritable: true,
          },
        },
      }),
    );
    expect(chip).toMatchObject({
      state: "superseded",
      meta: "Replaced by comment",
      removeLabel: "Dismiss selection",
      notes: [
        { tone: "info", text: "A comment is sent instead of this passage." },
      ],
    });
  });

  it("warns that a passage too long to send whole is cut", () => {
    const chip = wordSelectionChip(
      resolve({
        selection: selectionInput({ truncated: true, paragraphCount: 14 }),
      }),
    );
    expect(chip).toMatchObject({
      state: "included",
      tone: "warning",
      toneIcon: "tone",
      meta: "Too long · beginning only",
      cut: true,
      paragraphs: "Erato receives the first 2 of 14 paragraphs.",
    });
    expect(chip?.notes.map((note) => note.text)).toEqual([
      "Too long to send in full. Only the beginning is sent.",
      "Sent instead of the document.",
    ]);
  });
});

describe("how much of a cut passage goes", () => {
  it.each([
    [
      "one paragraph cut inside",
      { text: "Revenue grew", paragraphCount: 1 },
      "Erato receives only the beginning of the first paragraph, because it alone exceeds the send limit.",
    ],
    [
      "more lines than paragraphs",
      { text: "a\nb\nc", paragraphCount: 2 },
      "2 paragraphs",
    ],
  ])("says so for %s", (_, selection, paragraphs) => {
    expect(
      wordSelectionChip(
        resolve({
          selection: selectionInput({ truncated: true, ...selection }),
        }),
      )?.paragraphs,
    ).toBe(paragraphs);
  });

  it("counts only, and keeps the cut mark, while the passage does not go", () => {
    const dismissed = wordSelectionChip(
      resolve({
        selection: selectionInput({
          truncated: true,
          paragraphCount: 14,
          dismissed: true,
        }),
      }),
    );
    expect(dismissed).toMatchObject({
      state: "suggested",
      paragraphs: "14 paragraphs",
      cut: true,
    });
    expect(dismissed?.toneIcon).toBeUndefined();
  });

  it("names where Erato's passage came from", () => {
    expect(
      wordSelectionChip(
        resolve({
          selection: selectionInput({ armed: false, paragraphCount: 1 }),
        }),
      )?.paragraphs,
    ).toBe("1 paragraph · Shown by Erato after Show in Word");
  });
});

describe("wordDocumentChip", () => {
  const chip = (
    document: Partial<WordDocumentChipInput> = {},
    rest: Omit<Parameters<typeof resolve>[0] & object, "document"> = {},
  ) =>
    wordDocumentChip(resolve({ document: documentInput(document), ...rest }));

  it("offers no chip without a document facet", () => {
    expect(chip({ available: false })).toBeNull();
  });

  it("includes the document with its paragraph count", () => {
    expect(chip()).toMatchObject({
      state: "included",
      meta: "86 ¶",
      removeLabel: "Don't include this document",
      actions: [],
      notes: [],
      coverage: {
        heading: "Coverage",
        lines: ["Erato receives the whole document, 86 paragraphs."],
      },
      lifetime:
        "Leaving it out lasts for this chat. New chats follow your setting “Include the open document in new chats”.",
    });
    expect(chip()?.tone).toBeUndefined();
  });

  it("turns suggested when off in this chat, with + to include it", () => {
    const off = chip({ included: false });
    expect(off).toMatchObject({
      state: "suggested",
      restore: "include",
      restoreLabel: "Include this document",
    });
    expect(off?.meta).toBeUndefined();
    expect(chip({ included: false, status: "unreadable" })?.restore).toBe(
      "include-and-retry",
    );
  });

  it("claims no coverage while off, though it was read and changed", () => {
    expect(chip({ included: false, changed: true })?.coverage).toBeNull();
  });

  it.each([
    ["the selection", { selection: selectionInput() }],
    [
      "a thread",
      {
        send: {
          advertised: EVERYTHING,
          commentSelection: { kind: "caret" as const, threads: ["c1"] },
        },
      },
    ],
  ])(
    "states its coverage only as what goes if it is sent instead of %s, and reads nothing again",
    (_, rest) => {
      const superseded = chip(
        { coverage: coverage(120, 300), changed: true },
        rest,
      );
      expect(superseded?.state).toBe("superseded");
      expect(superseded?.coverage).toEqual({
        heading: "If sent instead",
        lines: ["Erato receives the first 120 of 300 paragraphs."],
        hint: "Only the beginning is sent. To work on a later part, select it in Word.",
      });
    },
  );

  it("is superseded while the selection goes, and offers to send it instead", () => {
    expect(chip({}, { selection: selectionInput() })).toMatchObject({
      state: "superseded",
      meta: "Replaced by selection",
      actions: ["send-instead"],
      notes: [
        {
          tone: "info",
          text: "Your selection is sent instead of the document.",
        },
      ],
    });
  });

  it("is superseded while a thread goes in its place, and offers to send it instead", () => {
    const superseded = chip(
      {},
      {
        send: {
          advertised: EVERYTHING,
          commentSelection: { kind: "caret", threads: ["c1"] },
        },
      },
    );
    expect(superseded).toMatchObject({
      state: "superseded",
      meta: "Replaced by comment",
      actions: ["send-instead-of-comment"],
      notes: [
        { tone: "info", text: "A comment is sent instead of the document." },
      ],
    });
  });

  it("shows a read that takes long as loading", () => {
    expect(chip({ reading: true })).toMatchObject({
      state: "loading",
      meta: "Reading document…",
      removeLabel: "Don't include this document",
    });
  });

  it("says a document Word did not hand over is not sent, and offers to try again", () => {
    const failed = chip({
      status: "unreadable",
      coverage: null,
      readReport: "report",
    });
    expect(failed).toMatchObject({
      state: "error",
      tone: "error",
      meta: "Couldn't read the document",
      removeLabel: "Dismiss document",
      actions: ["retry"],
      readReport: "report",
      coverage: null,
      notes: [
        {
          tone: "error",
          text: "Word did not hand over this document, so it is not sent. Try again, or leave it out.",
        },
      ],
    });
  });

  it.each([
    [
      "a document with text in a chat that only composes",
      { status: "included" as const },
      new Set([WORD_COMPOSE_FACET_ID]),
      "This chat can only start new documents, so a document with text is not sent.",
    ],
    [
      "an empty document in a chat that only reviews",
      {
        status: "empty" as const,
        coverage: { ...coverage(0), hasContent: false },
      },
      new Set([WORD_DOCUMENT_REVIEW_FACET_ID]),
      "This chat can only work with documents that have text, so an empty document is not sent.",
    ],
  ])("says why %s cannot be sent", (_, document, availableFacetIds, note) => {
    expect(chip(document, { send: { availableFacetIds } })).toMatchObject({
      state: "error",
      tone: "error",
      meta: "Can't be sent in this chat",
      removeLabel: "Dismiss document",
      actions: [],
      notes: [{ tone: "error", text: note }],
    });
  });

  it("shows an unread document as included without meta, since Send reads it first", () => {
    const unknown = chip(
      { status: "unknown", coverage: null },
      { send: { availableFacetIds: new Set([WORD_DOCUMENT_REVIEW_FACET_ID]) } },
    );
    expect(unknown).toMatchObject({ state: "included", notes: [] });
    expect(unknown?.meta).toBeUndefined();
  });

  it("names a new document", () => {
    expect(
      chip({
        status: "empty",
        coverage: { ...coverage(0), hasContent: false },
      }),
    ).toMatchObject({
      state: "included",
      meta: "New document",
      coverage: {
        heading: "Coverage",
        lines: ["The document is empty, so only its name is sent."],
      },
    });
  });

  describe("meta", () => {
    it.each([
      [{ trackChanges: true }, "Track Changes on · 86 ¶", "warning"],
      [
        { trackChanges: true, changed: true },
        "Track Changes on · Changed since last send",
        "warning",
      ],
      [{ changed: true }, "Changed since last send", undefined],
      [{ coverage: coverage(120, 300) }, "First 120 of 300 ¶", undefined],
      [
        { coverage: { ...coverage(1, 3), partialParagraph: true } },
        "Beginning only",
        undefined,
      ],
      [
        { lastingIssue: { text: "Too large.", readOnly: true } },
        "Read only · 86 ¶",
        "warning",
      ],
      [
        { lastingIssue: { text: "Cannot edit.", readOnly: false } },
        "Can't edit · 86 ¶",
        "warning",
      ],
      [
        {
          authoringRoute: true,
          readInParts: true,
          coverage: coverage(120, 300),
        },
        "Read in parts · 300 ¶",
        undefined,
      ],
      [{ authoringRoute: true, bodyOnly: true }, "Body only · 86 ¶", undefined],
      [
        { trackChanges: true, lastingIssue: { text: "x", readOnly: true } },
        "Track Changes on · 86 ¶",
        "warning",
      ],
    ] as const)("reads %o as %s", (document, meta, tone) => {
      const included = chip(document, {
        send: { availableFacetIds: new Set(DOCUMENT_FACETS) },
      });
      expect(included?.state).toBe("included");
      expect(included?.meta).toBe(meta);
      expect(included?.tone).toBe(tone);
    });

    it("never puts the change before the coverage", () => {
      expect(chip({ changed: true })?.meta).not.toMatch(/Changed.*¶/);
    });
  });

  describe("detail", () => {
    it("states the coverage of a long document and how to reach a later part", () => {
      expect(
        chip({ coverage: coverage(120, 300), changed: true })?.coverage,
      ).toEqual({
        heading: "Coverage",
        lines: [
          "Erato receives the first 120 of 300 paragraphs.",
          "Changed since last send: Erato reads it again with this message.",
        ],
        hint: "Only the beginning is sent. To work on a later part, select it in Word.",
      });
    });

    it("states that authoring reads in parts", () => {
      expect(
        chip(
          { authoringRoute: true, readInParts: true },
          { send: { availableFacetIds: new Set(DOCUMENT_FACETS) } },
        )?.coverage,
      ).toEqual({
        heading: "Coverage",
        lines: ["Erato reads the parts of the document your request needs."],
        hint: "This document is too large to rewrite as a whole. Erato can still read and edit it section by section.",
      });
    });

    it("keeps the lasting facts as notes", () => {
      const notes = chip({
        trackChanges: true,
        lastingIssue: { text: "Read only, here is why.", readOnly: true },
      })?.notes;
      expect(notes?.map((note) => note.tone)).toEqual(["warning", "warning"]);
      expect(notes?.[0].text).toMatch(/^Track Changes is on/);
      expect(notes?.[1].text).toBe("Read only, here is why.");
      expect(
        chip(
          { authoringRoute: true, bodyOnly: true },
          { send: { availableFacetIds: new Set(DOCUMENT_FACETS) } },
        )?.notes,
      ).toEqual([
        expect.objectContaining({
          tone: "info",
          testId: "word-document-read-note",
        }),
      ]);
    });

    it("lists the comment map only for a document that goes", () => {
      const lines = ["A list of the 3 comments in the document."];
      const comments = {
        count: 3,
        lines,
        off: false,
        mapOff: false,
        offerChoose: true,
      };
      expect(chip({ comments })?.comments).toEqual(lines);
      expect(
        chip({ comments }, { selection: selectionInput() })?.comments,
      ).toEqual([]);
    });
  });
});

describe("comments on the selection and the document", () => {
  const passage = (
    over: Partial<NonNullable<WordSelectionChipInput["comments"]>> = {},
  ): NonNullable<WordSelectionChipInput["comments"]> => ({
    count: 1,
    checked: true,
    threads: [],
    why: "default",
    coverage: null,
    switchTo: null,
    offerChoose: true,
    canChangeDefault: false,
    ...over,
  });
  const documentComments = (
    over: Partial<NonNullable<WordDocumentChipInput["comments"]>> = {},
  ): NonNullable<WordDocumentChipInput["comments"]> => ({
    count: 12,
    lines: ["A list of the 12 comments in the document."],
    off: false,
    mapOff: false,
    offerChoose: true,
    ...over,
  });
  const selectionChip = (
    comments: WordSelectionChipInput["comments"],
    over: Partial<WordSelectionChipInput> = {},
  ) =>
    wordSelectionChip(
      resolve({ selection: selectionInput({ comments, ...over }) }),
    );
  const documentChip = (
    document: Partial<WordDocumentChipInput>,
    send: Partial<WordSendPreviewInput> = {},
  ) => wordDocumentChip(resolve({ document: documentInput(document), send }));

  it("counts the passage's comments in the selection's meta, or says they are off", () => {
    expect(selectionChip(passage())).toMatchObject({
      meta: "Selected · 2 ¶ · 1 comment",
      actions: ["choose"],
    });
    expect(selectionChip(passage({ count: 2 }))?.meta).toBe(
      "Selected · 2 ¶ · 2 comments",
    );
    expect(selectionChip(passage({ checked: false }))?.meta).toBe(
      "Selected · 2 ¶ · comments off",
    );
    // Cut to the send limit says so first.
    expect(selectionChip(passage(), { truncated: true })?.meta).toBe(
      "Too long · beginning only",
    );
    expect(selectionChip(null)?.meta).toBe("Selected passage · 2 ¶");
  });

  it("offers the passage's switches from its detail", () => {
    const switchTo = {
      ref: "t1",
      commentId: "1",
      author: "Maya Krüger",
      status: "open" as const,
      quote: "",
      text: "",
      replies: null,
      lastActivity: null,
      pos: 1,
      para: 1,
      inSelection: true,
    };
    expect(
      selectionChip(passage({ switchTo, canChangeDefault: true }))?.actions,
    ).toEqual(["comment-instead", "choose", "change-default"]);
  });

  it("counts the map as a third fact only where nothing leads and nothing changed", () => {
    expect(documentChip({ comments: documentComments() })?.meta).toBe(
      "86 ¶ · 12 comments",
    );
    expect(
      documentChip({ comments: documentComments(), changed: true })?.meta,
    ).toBe("Changed since last send");
    expect(
      documentChip({ comments: documentComments(), trackChanges: true })?.meta,
    ).toBe("Track Changes on · 86 ¶");
    expect(
      documentChip({ comments: documentComments({ count: 1 }) })?.meta,
    ).toBe("86 ¶ · 1 comment");
  });

  it("says the comments are off for this message, and offers them back where the map is what is off", () => {
    const mapOff = documentChip({
      comments: documentComments({
        count: null,
        lines: [],
        off: true,
        mapOff: true,
      }),
    });
    expect(mapOff).toMatchObject({
      meta: "86 ¶ · comments off",
      commentsNote: "Comments are off for this message.",
      comments: [],
      actions: ["include-comments", "choose"],
    });
    const threadOff = documentChip({
      comments: documentComments({ count: null, lines: [], off: true }),
    });
    expect(threadOff).toMatchObject({
      meta: "86 ¶",
      commentsNote: "Comments are off for this message.",
      actions: ["choose"],
    });
  });

  it("keeps the picker in reach from the document in every state", () => {
    const comments = documentComments({ count: null, lines: [] });
    expect(documentChip({ comments, included: false })).toMatchObject({
      state: "suggested",
      actions: ["choose"],
    });
    expect(
      documentChip(
        { comments, status: "unreadable" },
        {
          unreadable: true,
        },
      )?.actions,
    ).toEqual(["retry", "choose"]);
    expect(
      documentChip(
        { comments },
        {
          advertised: EVERYTHING,
          commentSelection: { kind: "caret", threads: ["c1"] },
        },
      )?.actions,
    ).toEqual(["send-instead-of-comment", "choose"]);
  });
});

describe("agreement with the send preview", () => {
  type Passage = "none" | "user" | "erato" | "dismissed" | "failed";
  type Comments = "none" | "map" | "thread" | "open-comments";
  const FACET_SETS: Record<string, ReadonlySet<string>> = {
    all: new Set([
      ...DOCUMENT_FACETS,
      WORD_SELECTION_FACET_ID,
      WORD_COMMENT_THREAD_FACET_ID,
    ]),
    reviewOnly: new Set([
      WORD_DOCUMENT_REVIEW_FACET_ID,
      WORD_SELECTION_FACET_ID,
      WORD_COMMENT_THREAD_FACET_ID,
    ]),
    composeOnly: new Set([
      WORD_COMPOSE_FACET_ID,
      WORD_SELECTION_FACET_ID,
      WORD_COMMENT_THREAD_FACET_ID,
    ]),
    reviewAndCompose: REVIEW_AND_COMPOSE,
  };
  const cases: {
    included: boolean;
    passage: Passage;
    status: WordDocumentStatus;
    reading: boolean;
    facets: string;
    comments: Comments;
  }[] = [];
  for (const included of [true, false])
    for (const passage of [
      "none",
      "user",
      "erato",
      "dismissed",
      "failed",
    ] as const)
      for (const status of [
        "unknown",
        "empty",
        "included",
        "unreadable",
      ] as const)
        for (const reading of [false, true])
          for (const facets of Object.keys(FACET_SETS))
            for (const comments of [
              "none",
              "map",
              "thread",
              "open-comments",
            ] as const)
              cases.push({
                included,
                passage,
                status,
                reading,
                facets,
                comments,
              });

  const DOCUMENT_FACET_IDS = new Set(DOCUMENT_FACETS);

  it(`holds for all ${cases.length} combinations`, () => {
    for (const c of cases) {
      const availableFacetIds = FACET_SETS[c.facets];
      const authoringRoute = availableFacetIds.has(WORD_AUTHORING_FACET_ID);
      const document = documentInput({
        included: c.included,
        status: c.status,
        reading: c.reading,
        authoringRoute,
        coverage:
          c.status === "included"
            ? coverage(86)
            : c.status === "empty"
              ? { ...coverage(0), hasContent: false }
              : null,
      });
      const selection =
        c.passage === "none"
          ? null
          : selectionInput({
              armed: c.passage !== "erato",
              dismissed: c.passage === "dismissed",
              readFailed: c.passage === "failed",
            });
      const passageGoes =
        !!selection && selection.armed && !selection.dismissed;
      const input = resolve({
        document,
        selection,
        send: {
          availableFacetIds,
          advertised: c.comments === "none" ? NO_COMMENTS : EVERYTHING,
          precedence: c.comments === "thread" ? "comment" : "selection",
          includeOpenComments: c.comments === "open-comments",
          commentSelection:
            c.comments !== "thread"
              ? passageGoes
                ? { kind: "passage", threads: [], rewritable: true }
                : { kind: "none" }
              : passageGoes
                ? { kind: "passage", threads: ["c1"], rewritable: true }
                : { kind: "caret", threads: ["c1"] },
        },
      });
      const { preview } = input;
      const doc = wordDocumentChip(input)!;
      const sel = wordSelectionChip(input);
      const label = JSON.stringify({
        ...c,
        preview: preview.document,
        selection: preview.selection,
      });

      if (doc.state === "included")
        expect(
          (preview.document === "sent" &&
            preview.facetId !== null &&
            DOCUMENT_FACET_IDS.has(preview.facetId)) ||
            // The documented exception: nothing read yet, Send reads first.
            (c.status === "unknown" &&
              !c.reading &&
              preview.document === "not-sent"),
          label,
        ).toBe(true);
      expect(doc.state === "superseded", label).toBe(
        preview.document === "replaced-by-selection" ||
          preview.document === "replaced-by-comment",
      );
      expect(doc.state === "suggested", label).toBe(preview.document === "off");
      if (doc.state === "error")
        expect(preview.document, label).toBe("not-sent");
      if (doc.state === "loading") {
        expect(c.reading, label).toBe(true);
        expect(["sent", "not-sent"], label).toContain(preview.document);
      }
      if (preview.carrier === "none" && doc.state === "included")
        expect(c.status, label).toBe("unknown");

      if (!sel) {
        expect(c.passage, label).toBe("none");
        continue;
      }
      expect(sel.state === "included", label).toBe(
        preview.selection === "sent" && c.passage !== "failed",
      );
      if (sel.state === "error") expect(c.passage, label).toBe("failed");
      expect(sel.state === "superseded", label).toBe(
        preview.selection === "replaced-by-comment" && c.passage !== "failed",
      );
      expect(sel.state === "suggested", label).toBe(
        c.passage === "erato" || c.passage === "dismissed",
      );
      if (sel.state === "suggested")
        expect(preview.selection, label).toBe("not-sent");
    }
  });
});
