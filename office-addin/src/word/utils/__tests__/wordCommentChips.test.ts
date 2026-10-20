import { WORD_COMMENT_THREAD_FACET_ID } from "@erato/frontend/word-review";
import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import { NO_WORD_COMMENT_LIST } from "../../hooks/useWordComments";
import {
  WORD_AUTHORING_FACET_ID,
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
} from "../wordActionFacet";
import {
  wordCommentChip,
  wordCommentMapFacet,
  wordDocumentComments,
  wordOpenCommentsChip,
  wordPassageComments,
} from "../wordCommentChips";
import {
  wordCommentCoverageInfo,
  wordCommentCoverageLines,
} from "../wordCommentCoverage";
import { resolveWordCommentSend } from "../wordCommentSend";
import { previewWordSend } from "../wordSendPreview";

import type {
  WordCommentList,
  WordCommentListThread,
} from "../../hooks/useWordComments";
import type { WordCommentChipsInput } from "../wordCommentChips";
import type {
  WordCommentAdvertised,
  WordCommentOverride,
  WordCommentPrecedence,
  WordCommentSendSelection,
} from "../wordCommentSend";

const thread = (
  over: Partial<WordCommentListThread> = {},
): WordCommentListThread => ({
  ref: "t7k",
  commentId: "1331001789",
  author: "Maya Krüger",
  status: "open",
  quote: "delivery dates set out in Schedule 2",
  text: "Can we commit to these dates?",
  replies: 2,
  lastActivity: new Date("2026-09-04T07:00:00Z"),
  pos: 1,
  para: 9,
  inSelection: false,
  ...over,
});
const MAYA = thread();
const JONAS = thread({
  ref: "t2p",
  commentId: "760373734",
  author: "Jonas Weber",
  text: "Finance asked for net 30.",
  pos: 2,
});
const PAUL = thread({
  ref: "t9x",
  commentId: "99",
  author: "Paul Martin",
  text: "Legal wants a cap.",
  replies: null,
  lastActivity: null,
  pos: 3,
});
const LENA = thread({
  ref: "t4r",
  commentId: "44",
  author: "Lena Fischer",
  status: "resolved",
  pos: 4,
});
const THREADS = [MAYA, JONAS, PAUL, LENA];

const ALL: WordCommentAdvertised = {
  anchored: true,
  thread: true,
  map: new Set([WORD_DOCUMENT_REVIEW_FACET_ID]),
};
const FACETS = new Set([
  WORD_DOCUMENT_REVIEW_FACET_ID,
  WORD_SELECTION_FACET_ID,
  WORD_COMMENT_THREAD_FACET_ID,
]);

const listOf = (
  selection: WordCommentList["selection"],
  threads: readonly WordCommentListThread[] = THREADS,
): WordCommentList => ({
  ...NO_WORD_COMMENT_LIST,
  status: "ready",
  threads,
  counts: {
    open: threads.filter((t) => t.status === "open").length,
    resolved: threads.filter((t) => t.status === "resolved").length,
  },
  selection,
});

interface Scene {
  list?: WordCommentList;
  /** A passage the selection chip shows, armed. */
  passage?: { rewritable: boolean } | null;
  pick?: string | null;
  override?: WordCommentOverride | null;
  withoutComments?: boolean;
  includeOpenComments?: boolean;
  openCommentsDismissed?: boolean;
  documentIncluded?: boolean;
  precedence?: WordCommentPrecedence;
  advertised?: WordCommentAdvertised;
  canChangeDefault?: boolean;
  /** A document facet is advertised; default yes. */
  documentAdvertised?: boolean;
  /** A Send waits on comments Word did not hand over. */
  readFailed?: boolean;
}

/** What WordChatInput hands the chip models: the preview and its as-if twin, from one scene. */
function inputOf(scene: Scene): WordCommentChipsInput {
  const list = scene.list ?? listOf({ kind: "none" });
  const advertised = scene.advertised ?? ALL;
  const pick = scene.pick ?? null;
  const passageGoes = !!scene.passage;
  const commentSelection: WordCommentSendSelection = scene.passage
    ? {
        kind: "passage",
        threads:
          list.selection.kind === "passage" ? list.selection.threads : [],
        rewritable: scene.passage.rewritable,
      }
    : list.selection.kind === "caret"
      ? { kind: "caret", threads: list.selection.threads }
      : { kind: "none" };
  const override = scene.override ?? null;
  const withoutComments = scene.withoutComments ?? false;
  const includeOpenComments = scene.includeOpenComments ?? false;
  const documentIncluded = scene.documentIncluded ?? false;
  const base = {
    advertised,
    precedence: scene.precedence ?? "selection",
    pick,
    pickFound:
      pick === null || list.threads.some((entry) => entry.ref === pick),
    includeOpenComments,
    documentIncluded,
    passageGoes,
    commentSelection,
    authoring: false,
    hasContent: true,
    unreadable: false,
    availableFacetIds: FACETS,
  };
  const preview = previewWordSend({ ...base, override, withoutComments });
  return {
    preview,
    asIf: previewWordSend({
      ...base,
      override: override === "passage" ? null : override,
      withoutComments: false,
    }),
    list,
    pick,
    gestures: {
      withoutComments,
      override,
      includeOpenComments,
      openCommentsDismissed: scene.openCommentsDismissed ?? false,
    },
    documentOn: documentIncluded,
    documentAdvertised: scene.documentAdvertised ?? true,
    threadAdvertised: advertised.thread,
    mapFacet: wordCommentMapFacet(preview, advertised),
    readFailed: scene.readFailed ?? false,
    canChangeDefault: scene.canChangeDefault ?? true,
    passageGoes,
  };
}

const caretIn = (...threads: WordCommentListThread[]) =>
  listOf({ kind: "caret", threads: threads.map((t) => t.ref) });
const passageOver = (...threads: WordCommentListThread[]) =>
  listOf({ kind: "passage", threads: threads.map((t) => t.ref) });

beforeEach(() => {
  i18n.activate("en");
});

describe("wordCommentChip", () => {
  it("names the comment at the cursor, sent for this message unless its (x) says otherwise", () => {
    const chip = wordCommentChip(inputOf({ list: caretIn(MAYA) }));
    expect(chip).toMatchObject({
      variant: "thread",
      origin: "ambient",
      state: "included",
      label: "Comment by Maya Krüger",
      spokenLabel: "Comments",
      meta: "At your cursor",
      removeLabel: "Send without comments",
      removeAction: "without",
      removedAnnouncement:
        "Comments removed for this message. Include again with +",
      actions: ["choose"],
      detail: {
        title: "Comment by Maya Krüger",
        why: "cursor",
        thread: MAYA,
        lifetime: "Leaving comments out lasts for the next message only.",
      },
    });
    expect(chip?.detail.coverage?.heading).toBe("What is sent");
    expect(chip?.detail.coverage?.lines[0]).toBe(
      "The comment by Maya Krüger, with its replies.",
    );
    expect(chip?.detail.coverage?.lines).toHaveLength(5);
  });

  it("turns suggested after its (x), naming what + brings back", () => {
    const chip = wordCommentChip(
      inputOf({ list: caretIn(MAYA), withoutComments: true }),
    );
    expect(chip).toMatchObject({
      state: "suggested",
      origin: "ambient",
      label: "Comment by Maya Krüger",
      restoreLabel: "Include comments",
    });
    // The lane states the lifetime of a suggested ambient chip itself.
    expect(chip?.meta).toBeUndefined();
    expect(chip?.detail.coverage?.heading).toBe("If included");
  });

  it("shows a pick as the user's own, whose (x) ends the pick", () => {
    const chip = wordCommentChip(
      inputOf({ list: listOf({ kind: "none" }), pick: JONAS.ref }),
    );
    expect(chip).toMatchObject({
      variant: "thread",
      origin: "user",
      state: "included",
      label: "Comment by Jonas Weber",
      spokenLabel: "Chosen comment",
      meta: "Chosen by you",
      removeLabel: "Remove the chosen comment",
      removeAction: "end-pick",
      actions: ["choose"],
      detail: {
        lifetime:
          "A chosen comment stays until you choose another, remove it or select other text.",
      },
    });
    expect(chip?.removedAnnouncement).toBeUndefined();
  });

  it("offers the passage back from a pick made over a selection", () => {
    expect(
      wordCommentChip(
        inputOf({
          list: passageOver(MAYA),
          passage: { rewritable: true },
          pick: JONAS.ref,
        }),
      )?.actions,
    ).toEqual(["choose", "passage-instead"]);
  });

  it("asks for a choice with the cursor in several comments, listing them", () => {
    const chip = wordCommentChip(inputOf({ list: caretIn(MAYA, JONAS, PAUL) }));
    expect(chip).toMatchObject({
      variant: "choose",
      origin: "ambient",
      state: "attention",
      tone: "warning",
      label: "Cursor is in 3 comments",
      meta: "Choose one",
      removeLabel: "Send without comments",
      removeAction: "without",
      detail: {
        title: "Your cursor is in 3 comments",
        intro:
          "Your cursor is in more than one comment, so Erato does not know which one you mean.",
        choices: [MAYA, JONAS, PAUL],
        coverage: null,
      },
    });
    expect(
      wordCommentChip(
        inputOf({ list: caretIn(MAYA, JONAS, PAUL), withoutComments: true }),
      ),
    ).toMatchObject({
      state: "suggested",
      label: "Comments at your cursor",
      restoreLabel: "Include comments",
    });
  });

  it("marks a pick that is gone as an error the (x) ends", () => {
    const chip = wordCommentChip(
      inputOf({ list: listOf({ kind: "none" }), pick: "tzz" }),
    );
    expect(chip).toMatchObject({
      variant: "gone",
      origin: "user",
      state: "error",
      tone: "error",
      label: "Chosen comment",
      meta: "No longer in the document",
      removeLabel: "Remove the chosen comment",
      removeAction: "end-pick",
      actions: ["choose"],
      detail: {
        notes: [
          {
            tone: "error",
            text: "The comment you chose is no longer in the document.",
          },
        ],
      },
    });
    // Still an error while "Send without comments" holds: the pick is what is wrong.
    expect(
      wordCommentChip(
        inputOf({
          list: listOf({ kind: "none" }),
          pick: "tzz",
          withoutComments: true,
        }),
      )?.state,
    ).toBe("error");
  });

  it("names the passage's thread under the setting, with the way back and the setting", () => {
    const chip = wordCommentChip(
      inputOf({
        list: passageOver(MAYA),
        passage: { rewritable: true },
        precedence: "comment",
      }),
    );
    expect(chip).toMatchObject({
      origin: "ambient",
      state: "included",
      meta: "Your default",
      actions: ["choose", "passage-instead", "change-default"],
    });
    expect(
      wordCommentChip(
        inputOf({
          list: passageOver(MAYA),
          passage: { rewritable: true },
          precedence: "comment",
          canChangeDefault: false,
        }),
      )?.actions,
    ).toEqual(["choose", "passage-instead"]);
    expect(
      wordCommentChip(
        inputOf({
          list: passageOver(MAYA),
          passage: { rewritable: true },
          override: "comment",
        }),
      ),
    ).toMatchObject({ meta: "Chosen by you" });
    // The passage chosen instead: the thread is what + brings back.
    expect(
      wordCommentChip(
        inputOf({
          list: passageOver(MAYA),
          passage: { rewritable: true },
          precedence: "comment",
          override: "passage",
        }),
      ),
    ).toMatchObject({ state: "suggested", label: "Comment by Maya Krüger" });
  });

  it("is no chip for passage threads, the map, open comments or none", () => {
    expect(
      wordCommentChip(
        inputOf({
          list: passageOver(MAYA, JONAS),
          passage: { rewritable: true },
        }),
      ),
    ).toBeNull();
    expect(wordCommentChip(inputOf({ documentIncluded: true }))).toBeNull();
    expect(wordCommentChip(inputOf({ includeOpenComments: true }))).toBeNull();
    expect(wordCommentChip(inputOf({}))).toBeNull();
    expect(
      wordCommentChip(
        inputOf({
          list: caretIn(MAYA),
          advertised: { anchored: true, thread: false, map: new Set() },
        }),
      ),
    ).toBeNull();
  });

  it("picks first on Show in Word only for a thread that goes because of the caret", () => {
    const picks = (scene: Scene) =>
      wordCommentChip(inputOf(scene))?.detail.showInWordPicks;
    expect(picks({ list: caretIn(MAYA) })).toBe(true);
    expect(
      picks({
        list: passageOver(MAYA),
        passage: { rewritable: true },
        precedence: "comment",
      }),
    ).toBe(true);
    // Off for this message, or chosen already: showing must not change what is sent.
    expect(picks({ list: caretIn(MAYA), withoutComments: true })).toBe(false);
    expect(
      picks({
        list: passageOver(MAYA),
        passage: { rewritable: true },
        precedence: "comment",
        override: "passage",
      }),
    ).toBe(false);
    expect(picks({ pick: JONAS.ref })).toBe(false);
  });

  it("turns a thread the waiting Send could not read into an error its (x) answers", () => {
    expect(
      wordCommentChip(inputOf({ pick: JONAS.ref, readFailed: true })),
    ).toMatchObject({
      origin: "user",
      state: "error",
      tone: "error",
      meta: "Couldn't read comments",
      removeAction: "end-pick",
    });
    expect(
      wordCommentChip(
        inputOf({
          list: passageOver(MAYA),
          passage: { rewritable: true },
          precedence: "comment",
          readFailed: true,
        }),
      ),
    ).toMatchObject({
      origin: "ambient",
      state: "error",
      meta: "Couldn't read comments",
      removeAction: "without",
    });
  });

  it("calls a thread the live list has not seen yet a chosen comment", () => {
    const chip = wordCommentChip(
      inputOf({
        list: { ...listOf({ kind: "none" }, []), status: "reading" },
        pick: "t2p",
      }),
    );
    // While reading, a pick is taken as found: Send reads again.
    expect(chip).toMatchObject({
      label: "Chosen comment",
      detail: { thread: null },
    });
  });
});

describe("wordOpenCommentsChip", () => {
  it("starts suggested while the document is off, with + for the chat", () => {
    expect(wordOpenCommentsChip(inputOf({}))).toMatchObject({
      state: "suggested",
      label: "Open comments (3)",
      meta: "Not included",
      restoreLabel: "Include open comments",
      restore: "include",
      actions: ["choose"],
      detail: {
        intro:
          "Shown while the document is off, so you can still send its comments without its text.",
        lifetime: "Leaving them out lasts for this chat.",
      },
    });
  });

  it("is included while the Send carries them, and says Off in this chat after its (x)", () => {
    const included = wordOpenCommentsChip(
      inputOf({ includeOpenComments: true }),
    );
    expect(included).toMatchObject({
      state: "included",
      meta: "With their replies",
      removeLabel: "Don't include open comments",
    });
    expect(included?.detail.coverage?.lines[0]).toBe(
      "The 3 open comments in the document, with their replies.",
    );
    const off = wordOpenCommentsChip(inputOf({ openCommentsDismissed: true }));
    expect(off?.state).toBe("suggested");
    expect(off?.meta).toBeUndefined();
    // "If included" promises the reach the included chip states, not the selection's.
    expect(off?.detail.coverage?.heading).toBe("If included");
    expect(off?.detail.coverage?.lines).toEqual(
      included?.detail.coverage?.lines,
    );
  });

  it("says Off for this message under Send without comments, and + undoes that", () => {
    expect(
      wordOpenCommentsChip(
        inputOf({ includeOpenComments: true, withoutComments: true }),
      ),
    ).toMatchObject({
      state: "suggested",
      meta: "Off for this message",
      restoreLabel: "Include comments",
      restore: "restore-comments",
    });
  });

  it("gives way to a passage or a thread, and offers to go instead", () => {
    expect(
      wordOpenCommentsChip(
        inputOf({
          includeOpenComments: true,
          list: passageOver(MAYA),
          passage: { rewritable: false },
        }),
      ),
    ).toMatchObject({
      state: "superseded",
      meta: "Replaced by selection",
      actions: ["choose", "send-instead"],
      sendInsteadDismissesSelection: true,
    });
    const byThread = wordOpenCommentsChip(
      inputOf({ includeOpenComments: true, list: caretIn(MAYA) }),
    );
    expect(byThread).toMatchObject({
      state: "superseded",
      meta: "Replaced by comment",
      sendInsteadDismissesSelection: false,
    });
    expect(byThread?.detail.coverage?.heading).toBe("If sent instead");
  });

  it("says Off for this message, not Replaced, when only Send without comments keeps them out", () => {
    // The cursor's thread was left out with its (x): nothing replaces the open comments.
    expect(
      wordOpenCommentsChip(
        inputOf({
          includeOpenComments: true,
          list: caretIn(MAYA),
          withoutComments: true,
        }),
      ),
    ).toMatchObject({
      state: "suggested",
      meta: "Off for this message",
      restore: "restore-comments",
    });
    // The passage's own comments are off, but the passage still goes in their place.
    expect(
      wordOpenCommentsChip(
        inputOf({
          includeOpenComments: true,
          list: passageOver(MAYA),
          passage: { rewritable: false },
          withoutComments: true,
        }),
      ),
    ).toMatchObject({ state: "superseded", meta: "Replaced by selection" });
  });

  it("stays while the Send carries them, even with none open", () => {
    const resolvedOnly = listOf({ kind: "none" }, [LENA]);
    expect(
      wordOpenCommentsChip(
        inputOf({ list: resolvedOnly, includeOpenComments: true }),
      ),
    ).toMatchObject({
      state: "included",
      label: "Open comments (0)",
      removeLabel: "Don't include open comments",
    });
    expect(
      wordOpenCommentsChip(
        inputOf({
          list: listOf({ kind: "none" }, []),
          includeOpenComments: true,
        }),
      ),
    ).toMatchObject({ state: "included", label: "Open comments (0)" });
  });

  it("leads to the picker with none open only where no document chip does", () => {
    const resolvedOnly = listOf({ kind: "none" }, [LENA]);
    expect(
      wordOpenCommentsChip(
        inputOf({ list: resolvedOnly, documentAdvertised: false }),
      ),
    ).toMatchObject({
      state: "suggested",
      label: "Open comments (0)",
      meta: "None open",
      restore: null,
      actions: ["choose"],
      detail: {
        intro:
          "No comment in this document is open. Choose comment… to work on a resolved one.",
        coverage: null,
      },
    });
    expect(wordOpenCommentsChip(inputOf({ list: resolvedOnly }))).toBeNull();
    expect(
      wordOpenCommentsChip(
        inputOf({
          list: listOf({ kind: "none" }, []),
          documentAdvertised: false,
        }),
      ),
    ).toBeNull();
  });

  it("does not speak of the document being off where there is no document chip", () => {
    expect(
      wordOpenCommentsChip(inputOf({ documentAdvertised: false }))?.detail
        .intro,
    ).toBe("Sends the document's open comments with their replies.");
  });

  it("turns open comments the waiting Send could not read into an error", () => {
    expect(
      wordOpenCommentsChip(
        inputOf({ includeOpenComments: true, readFailed: true }),
      ),
    ).toMatchObject({
      state: "error",
      tone: "error",
      meta: "Couldn't read comments",
      removeLabel: "Don't include open comments",
    });
  });

  it("shows only while the document is off and the thread facet is advertised", () => {
    expect(
      wordOpenCommentsChip(inputOf({ documentIncluded: true })),
    ).toBeNull();
    expect(
      wordOpenCommentsChip(
        inputOf({
          advertised: { anchored: true, thread: false, map: new Set() },
        }),
      ),
    ).toBeNull();
    expect(
      wordOpenCommentsChip(inputOf({ list: listOf({ kind: "none" }, [LENA]) })),
    ).toBeNull();
  });
});

describe("comments on their parent", () => {
  it("counts the passage's threads on the selection, and keeps them off with Send without comments", () => {
    const on = wordPassageComments(
      inputOf({ list: passageOver(MAYA), passage: { rewritable: true } }),
    );
    expect(on).toMatchObject({
      count: 1,
      checked: true,
      threads: [MAYA],
      why: "default",
      switchTo: MAYA,
      offerChoose: true,
      canChangeDefault: true,
    });
    expect(on?.coverage?.heading).toBe("What is sent");
    const off = wordPassageComments(
      inputOf({
        list: passageOver(MAYA),
        passage: { rewritable: true },
        withoutComments: true,
      }),
    );
    expect(off).toMatchObject({ count: 1, checked: false });
    expect(off?.coverage?.heading).toBe("If included");
    expect(
      wordPassageComments(
        inputOf({ list: passageOver(), passage: { rewritable: true } }),
      ),
    ).toBeNull();
  });

  it("offers no switch over two threads", () => {
    expect(
      wordPassageComments(
        inputOf({
          list: passageOver(MAYA, JONAS),
          passage: { rewritable: true },
        }),
      ),
    ).toMatchObject({ count: 2, switchTo: null, why: null });
  });

  it("counts the rows the map carries on the document, up to its first page", () => {
    const many = listOf(
      { kind: "none" },
      Array.from({ length: 150 }, (_, i) =>
        thread({ ref: `t${(i + 100).toString(36)}`, pos: i + 1 }),
      ),
    );
    expect(
      wordDocumentComments(inputOf({ documentIncluded: true, list: many }))
        ?.count,
    ).toBe(100);
    const map = wordDocumentComments(inputOf({ documentIncluded: true }));
    expect(map).toMatchObject({ count: 4, off: false, mapOff: false });
    expect(map?.lines[0]).toBe(
      "A list of the 4 comments in the document: each one's author, place, status and how it starts.",
    );
  });

  it("counts the map only where the facet the Send uses takes it", () => {
    // comment_map on authoring only; this Send reviews.
    const authoringOnly: WordCommentAdvertised = {
      ...ALL,
      map: new Set([WORD_AUTHORING_FACET_ID]),
    };
    const input = inputOf({
      documentIncluded: true,
      advertised: authoringOnly,
    });
    expect(input.preview.comments.carrier.kind).toBe("map");
    expect(input.preview.facetId).toBe(WORD_DOCUMENT_REVIEW_FACET_ID);
    expect(wordDocumentComments(input)).toMatchObject({
      count: null,
      lines: [],
      off: false,
    });
    expect(
      wordDocumentComments(
        inputOf({
          documentIncluded: true,
          advertised: authoringOnly,
          withoutComments: true,
        }),
      ),
    ).toMatchObject({ off: false, mapOff: false });
  });

  it("says when the waiting Send could not read the comments its parent carries", () => {
    expect(
      wordPassageComments(
        inputOf({
          list: passageOver(MAYA),
          passage: { rewritable: false },
          readFailed: true,
        }),
      ),
    ).toMatchObject({ checked: true, readFailed: true });
    expect(
      wordDocumentComments(
        inputOf({ documentIncluded: true, readFailed: true }),
      ),
    ).toMatchObject({ count: null, readFailed: true });
  });

  it("says when Send without comments takes the map, and when it took only a thread", () => {
    expect(
      wordDocumentComments(
        inputOf({ documentIncluded: true, withoutComments: true }),
      ),
    ).toMatchObject({ count: null, off: true, mapOff: true });
    expect(
      wordDocumentComments(
        inputOf({
          documentIncluded: true,
          withoutComments: true,
          list: caretIn(MAYA),
        }),
      ),
    ).toMatchObject({ off: true, mapOff: false });
    expect(
      wordDocumentComments(
        inputOf({
          documentIncluded: true,
          withoutComments: true,
          advertised: { anchored: true, thread: true, map: new Set() },
        }),
      ),
    ).toMatchObject({ off: false, offerChoose: true });
  });
});

describe("agreement with the send preview", () => {
  const SELECTIONS: {
    name: string;
    list: WordCommentList;
    passage: { rewritable: boolean } | null;
  }[] = [
    { name: "none", list: listOf({ kind: "none" }), passage: null },
    {
      name: "none, resolved only",
      list: listOf({ kind: "none" }, [LENA]),
      passage: null,
    },
    {
      name: "none, no comments",
      list: listOf({ kind: "none" }, []),
      passage: null,
    },
    ...[[], [MAYA], [MAYA, JONAS, PAUL]].map((threads) => ({
      name: `caret ${threads.length}`,
      list: caretIn(...threads),
      passage: null,
    })),
    ...[[], [MAYA], [MAYA, JONAS]].flatMap((threads) =>
      [true, false].map((rewritable) => ({
        name: `passage ${threads.length} ${rewritable}`,
        list: passageOver(...threads),
        passage: { rewritable },
      })),
    ),
  ];
  const ADVERTISED: Record<string, WordCommentAdvertised> = {
    all: ALL,
    noThread: { ...ALL, thread: false },
    noAnchored: { ...ALL, anchored: false },
    noMap: { ...ALL, map: new Set() },
    mapOnAuthoringOnly: { ...ALL, map: new Set([WORD_AUTHORING_FACET_ID]) },
  };
  const scenes: Scene[] = [];
  for (const selection of SELECTIONS)
    for (const pick of [null, JONAS.ref, "tzz"])
      for (const override of [null, "comment", "passage"] as const)
        for (const withoutComments of [false, true])
          for (const includeOpenComments of [false, true])
            for (const documentIncluded of [false, true])
              for (const precedence of ["selection", "comment"] as const)
                for (const advertised of Object.values(ADVERTISED))
                  scenes.push({
                    list: selection.list,
                    passage: selection.passage,
                    pick,
                    override,
                    withoutComments,
                    includeOpenComments,
                    documentIncluded,
                    precedence,
                    advertised,
                  });

  it(`says only what the Send carries, in all ${scenes.length} scenes`, () => {
    for (const scene of scenes) {
      const input = inputOf(scene);
      const { preview } = input;
      const comment = wordCommentChip(input);
      const open = wordOpenCommentsChip(input);
      const passage = wordPassageComments(input);
      const map = wordDocumentComments(input);
      const where = JSON.stringify({ ...scene, list: scene.list?.selection });

      expect(comment?.state === "included", where).toBe(
        preview.carrier === "comment",
      );
      expect(comment?.state === "attention", where).toBe(
        preview.comments.block === "choose-comment",
      );
      if (preview.carrier === "open-comments")
        expect(open?.state, where).toBe("included");
      if (open?.state === "included")
        expect(preview.carrier, where).toBe("open-comments");
      expect(passage?.checked === true, where).toBe(
        preview.selection === "sent" &&
          preview.comments.carrier.kind === "selection" &&
          preview.comments.carrier.threads.length > 0,
      );
      expect((map?.count ?? null) !== null, where).toBe(
        preview.document === "sent" &&
          preview.comments.carrier.kind === "map" &&
          preview.facetId !== null &&
          (scene.advertised ?? ALL).map.has(preview.facetId) &&
          input.list.threads.length > 0,
      );
      // Replaced only by what the Send carries first, never by "Send without comments".
      if (open?.state === "superseded")
        expect(
          preview.carrier === "selection" ||
            preview.carrier === "comment" ||
            preview.comments.block !== null,
          where,
        ).toBe(true);
      if (open?.restore === "restore-comments")
        expect(
          preview.carrier === "none" && input.gestures.withoutComments,
          where,
        ).toBe(true);
    }
  });

  it("sends the open comments that Send this instead and + promise", () => {
    for (const scene of scenes) {
      const input = inputOf(scene);
      const open = wordOpenCommentsChip(input);
      const where = JSON.stringify({ ...scene, list: scene.list?.selection });
      if (open?.state === "superseded") {
        const instead = inputOf({
          ...scene,
          pick: null,
          override: "passage",
          withoutComments: false,
          passage: open.sendInsteadDismissesSelection ? null : scene.passage,
        });
        expect(instead.preview.carrier, where).toBe("open-comments");
        expect(wordOpenCommentsChip(instead)?.state, where).toBe("included");
      }
      if (open?.state === "suggested" && open.restore === "include") {
        const after = wordOpenCommentsChip(
          inputOf({
            ...scene,
            includeOpenComments: true,
            openCommentsDismissed: false,
            withoutComments: false,
          }),
        );
        expect(["included", "superseded"], where).toContain(after?.state);
      }
    }
  });

  it("round-trips every chip's (x) and +", () => {
    for (const scene of scenes) {
      const input = inputOf(scene);
      const comment = wordCommentChip(input);
      const where = JSON.stringify({ ...scene, list: scene.list?.selection });
      if (comment?.state === "included" || comment?.state === "attention") {
        const after =
          comment.removeAction === "end-pick"
            ? inputOf({ ...scene, pick: null })
            : inputOf({ ...scene, withoutComments: true });
        if (comment.removeAction === "without") {
          expect(after.preview.carrier, where).not.toBe("comment");
          expect(after.preview.comments.block, where).toBeNull();
          expect(wordCommentChip(after)?.state, where).toBe("suggested");
        } else if (after.preview.comments.carrier.kind === "thread") {
          expect(after.preview.comments.carrier.ref, where).not.toBe(
            scene.pick,
          );
        }
      }
      if (comment?.state === "suggested") {
        const back = inputOf({
          ...scene,
          withoutComments: false,
          override: scene.override === "passage" ? null : scene.override,
        });
        expect(
          back.preview.carrier === "comment" ||
            back.preview.comments.block === "choose-comment",
          where,
        ).toBe(true);
      }
      const open = wordOpenCommentsChip(input);
      if (open?.state === "included") {
        const off = inputOf({
          ...scene,
          includeOpenComments: false,
          openCommentsDismissed: true,
        });
        expect(off.preview.carrier, where).not.toBe("open-comments");
        // With none open there is nothing to bring back, and the document chip leads to the picker.
        if (input.list.counts.open > 0 || !input.documentAdvertised)
          expect(wordOpenCommentsChip(off), where).toMatchObject({
            state: "suggested",
          });
        else expect(wordOpenCommentsChip(off), where).toBeNull();
      }
    }
  });

  it("sends what Send this instead promises", () => {
    // The document instead of the cursor's thread.
    const replaced = inputOf({ documentIncluded: true, list: caretIn(MAYA) });
    expect(replaced.preview.document).toBe("replaced-by-comment");
    expect(
      inputOf({
        documentIncluded: true,
        list: caretIn(MAYA),
        override: "passage",
      }).preview.document,
    ).toBe("sent");
    // The passage instead of the thread the setting chose.
    const scene: Scene = {
      list: passageOver(MAYA),
      passage: { rewritable: true },
      precedence: "comment",
    };
    expect(inputOf(scene).preview.selection).toBe("replaced-by-comment");
    expect(inputOf({ ...scene, override: "passage" }).preview.selection).toBe(
      "sent",
    );
    // The open comments instead of a pick.
    const picked: Scene = { includeOpenComments: true, pick: JONAS.ref };
    expect(wordOpenCommentsChip(inputOf(picked))?.state).toBe("superseded");
    expect(
      inputOf({ ...picked, pick: null, override: "passage" }).preview.carrier,
    ).toBe("open-comments");
  });
});

describe("What is sent", () => {
  it("says what is sent, what Erato may read, the rest, the resolved rule and that emails never go", () => {
    const list = {
      ...listOf({ kind: "passage", threads: [MAYA.ref] }),
      unplaced: 10,
    };
    const plan = resolveWordCommentSend({
      advertised: ALL,
      selection: { kind: "passage", threads: [MAYA.ref], rewritable: false },
      precedence: "selection",
      pick: null,
      pickFound: true,
      override: null,
      withoutComments: false,
      documentIncluded: false,
      includeOpenComments: false,
      readFailed: false,
    });
    const info = wordCommentCoverageInfo(plan, list, {
      document: false,
      picked: false,
      openComments: false,
    });
    expect(wordCommentCoverageLines(info!)).toEqual([
      "The comment in your selection, with its replies.",
      "If your question needs them, Erato may read up to 3 comments above and 3 below your selection.",
      "13 other comments are not sent.",
      "Resolved comments are sent only when they are in your selection or when you ask for them.",
      "Email addresses of comment authors are never sent.",
    ]);
  });

  it("says for the map what it leaves out and that resolved comments are in it", () => {
    const list = { ...listOf({ kind: "none" }), unplaced: 3 };
    const plan = resolveWordCommentSend({
      advertised: ALL,
      selection: { kind: "none" },
      precedence: "selection",
      pick: null,
      pickFound: true,
      override: null,
      withoutComments: false,
      documentIncluded: true,
      includeOpenComments: false,
      readFailed: false,
    });
    const info = wordCommentCoverageInfo(plan, list, {
      document: true,
      picked: false,
      openComments: false,
    });
    expect(info).toMatchObject({ sent: { kind: "map", threads: 4 }, rest: 3 });
    const lines = wordCommentCoverageLines(info!);
    expect(lines).toContain("3 other comments are not sent.");
    expect(lines).toContain(
      "The list includes resolved comments too, each with how it starts.",
    );
  });
});
