import { describe, expect, it } from "vitest";

import { utf8ByteLength } from "../../../core/clientActions/actionFacetArgs";
import { wordParagraphAnchor } from "../wordParagraphResolver";
import {
  buildWordSelectionSnapshot,
  classifyWordSelection,
  emptySelectionCapture,
  resolveWordSelection,
  rewritableWordSelection,
  WORD_SELECTION_CONTEXT_BYTES,
  WORD_SELECTION_REASON_MESSAGE_IDS,
  WORD_SELECTION_REPLACE_SHAPES,
  wordSelectionOf,
  wordSelectionParts,
} from "../wordSelectionAnchor";
import { wordSelectionSupport } from "../wordSelectionSupport";

import type { WordParagraphEntry } from "../wordParagraphResolver";
import type {
  WordSelectionFacts,
  WordSelectionParagraphFacts,
  WordSelectionShape,
  WordSelectionSnapshot,
} from "../wordSelectionAnchor";
import type { WordRequirementCheck } from "../wordSelectionSupport";

const host =
  (levels: Record<string, string>): WordRequirementCheck =>
  (name, minVersion = "1.1") => {
    const have = levels[name]?.split(".").map(Number);
    const need = minVersion.split(".").map(Number);
    return (
      !!have &&
      (have[0] > need[0] || (have[0] === need[0] && have[1] >= need[1]))
    );
  };

const MAC = wordSelectionSupport(
  host({ WordApi: "1.9", WordApiDesktop: "1.5" }),
  "Mac",
);
const PC = wordSelectionSupport(
  host({ WordApi: "1.9", WordApiDesktop: "1.5" }),
  "PC",
);
const WEB = wordSelectionSupport(host({ WordApi: "1.10" }), "OfficeOnline");
const LTSC_2024 = wordSelectionSupport(
  host({ WordApi: "1.8", WordApiDesktop: "1.1" }),
  "PC",
);
const LTSC_2021 = wordSelectionSupport(host({ WordApi: "1.3" }), "PC");

const REWRITE_SHAPES = new Set<WordSelectionShape>([
  "inline",
  "paragraph",
  "multi_paragraph",
  "table_cell",
]);

const body = (texts: string[], ids = true): WordParagraphEntry[] =>
  texts.map((text, i) => ({ id: ids ? `p${i}` : null, text }));

const DOC = body([
  "Title",
  "The quick brown fox jumps over the lazy dog.",
  "Second paragraph.",
  "Third paragraph.",
  "Closing.",
]);

interface Span {
  first: number;
  last?: number;
  start?: number;
  end?: number;
}

function facts(
  story: WordParagraphEntry[],
  { first, last = first, start = 0, end }: Span,
  overrides: Partial<WordSelectionFacts> = {},
): WordSelectionFacts {
  const paragraphs = story.slice(first, last + 1).map(
    (p, i): WordSelectionParagraphFacts => ({
      id: p.id,
      text: p.text,
      rangeText: p.text,
      index: first + i,
      styleName: "Normal",
      tableNestingLevel: 0,
      cell: null,
    }),
  );
  const endOffset = end ?? paragraphs[paragraphs.length - 1].rangeText.length;
  return {
    isEmpty: false,
    storyType: "MainDoc",
    selectionText: paragraphs
      .map((p, i) =>
        p.rangeText.slice(
          i === 0 ? start : 0,
          i === paragraphs.length - 1 ? endOffset : undefined,
        ),
      )
      .join("\r"),
    objectOnly: false,
    tables: "none",
    paragraphs,
    startOffset: start,
    endOffset,
    anchor: wordParagraphAnchor(story, first, last),
    hazards: {},
    pictureBeforeSpan: false,
    styleFontResolved: true,
    ...overrides,
  };
}

/** Places the covered paragraphs in table cells. */
function inCells(
  base: WordSelectionFacts,
  cells: (string | null)[],
  nesting = 1,
  tables: WordSelectionFacts["tables"] = "partial",
): WordSelectionFacts {
  return {
    ...base,
    tables,
    paragraphs: base.paragraphs.map((p, i) => ({
      ...p,
      cell: cells[i],
      tableNestingLevel: cells[i] === null ? 0 : nesting,
    })),
  };
}

const INLINE = facts(DOC, { first: 1, start: 4, end: 9 });
const PARAGRAPH = facts(DOC, { first: 2 });
const MULTI = facts(DOC, { first: 1, last: 3, start: 4, end: 5 });
const CELL = inCells(facts(DOC, { first: 2 }), ["r0c1"]);

const classify = (
  selection: WordSelectionFacts,
  support = MAC,
  shapes: ReadonlySet<WordSelectionShape> = REWRITE_SHAPES,
) => classifyWordSelection(selection, support, shapes);
const reasonOf = (
  selection: WordSelectionFacts,
  support = MAC,
  shapes: ReadonlySet<WordSelectionShape> = REWRITE_SHAPES,
) => {
  const result = classify(selection, support, shapes);
  return result.role === "none" ? "none" : result.reasonCode;
};

describe("classifyWordSelection: D-10", () => {
  it.each([
    ["inline text", INLINE, "inline"],
    ["a whole paragraph", PARAGRAPH, "paragraph"],
    ["several paragraphs", MULTI, "multi_paragraph"],
    ["one table cell", CELL, "table_cell"],
  ] as const)("rewrites %s", (_, selection, shape) => {
    expect(classify(selection)).toEqual({
      role: "rewrite",
      shape,
      story: "main",
      reasonCode: null,
    });
  });

  it("keeps every shape context only until it is enabled", () => {
    expect(WORD_SELECTION_REPLACE_SHAPES.size).toBe(0);
    for (const selection of [INLINE, PARAGRAPH, MULTI, CELL])
      expect(classifyWordSelection(selection, MAC)).toMatchObject({
        role: "context_only",
        reasonCode: "shape_not_enabled",
      });
    expect(
      classify(INLINE, MAC, new Set<WordSelectionShape>(["paragraph"])),
    ).toMatchObject({ role: "context_only", reasonCode: "shape_not_enabled" });
  });

  it.each([
    ["Header", "header"],
    ["Footer", "footer"],
    ["Footnote", "footnote"],
    ["Endnote", "endnote"],
    ["NoteItem", "note"],
    ["Shape", "text_box"],
    ["Section", "other"],
  ])("sends a selection in a %s story as context only", (storyType, story) => {
    expect(classify({ ...PARAGRAPH, storyType })).toEqual({
      role: "context_only",
      shape: "paragraph",
      story,
      reasonCode: "other_story",
    });
  });

  it.each([
    ["a hyperlink", { hyperlink: true }, "hyperlink"],
    ["a field", { field: true }, "field"],
    ["a content control", { contentControl: true }, "content_control"],
    ["hidden text", { hiddenText: true }, "hidden_text"],
    ["a tracked deletion", { trackedChange: true }, "tracked_changes"],
    ["a picture", { inlinePicture: true }, "inline_picture"],
    ["a footnote reference", { noteReference: true }, "note_reference"],
    ["a comment mark", { commentMark: true }, "comment_mark"],
    [
      "a character style",
      { unsupportedFormatting: true },
      "unsupported_formatting",
    ],
  ] as const)(
    "sends a span containing %s as context only",
    (_, hazards, reason) => {
      expect(reasonOf({ ...INLINE, hazards })).toBe(reason);
    },
  );

  it.each([
    ["\u0002", "note_reference"],
    ["\u0005", "comment_mark"],
    ["\u000B", "line_break"],
  ])("finds the mark %j in the span's text", (mark, reason) => {
    const story = body(["Intro", `Before ${mark} inside`, "Outro"]);
    expect(reasonOf(facts(story, { first: 1 }))).toBe(reason);
    expect(reasonOf(facts(story, { first: 1, start: 0, end: 6 }))).toBeNull();
  });

  it("sends a whole table as context only", () => {
    const table = inCells(
      facts(DOC, { first: 1, last: 4 }),
      ["r0c0", "r0c1", "r1c0", "r1c1"],
      1,
      "whole",
    );
    expect(classify(table)).toMatchObject({
      role: "context_only",
      shape: "table",
      reasonCode: "whole_table",
    });
  });

  it("sends body text with a whole table as context only", () => {
    const mixed = inCells(
      facts(DOC, { first: 0, last: 2 }),
      [null, "r0c0", "r0c1"],
      1,
      "whole",
    );
    expect(reasonOf(mixed)).toBe("whole_table");
  });

  it("offers no chip for body text running into part of a table", () => {
    const mixed = inCells(facts(DOC, { first: 0, last: 2 }), [
      null,
      "r0c0",
      "r0c1",
    ]);
    expect(classify(mixed)).toEqual({ role: "none" });
  });

  it("sends two or more cells as context only", () => {
    expect(
      reasonOf(inCells(facts(DOC, { first: 1, last: 2 }), ["r0c0", "r0c1"])),
    ).toBe("multi_cell");
  });

  it("sends several paragraphs of one cell as context only", () => {
    const cell = inCells(facts(DOC, { first: 1, last: 2 }), ["r0c0", "r0c0"]);
    expect(classify(cell)).toMatchObject({
      shape: "table_cell",
      reasonCode: "cell_multi_paragraph",
    });
  });

  it("sends a cell of a nested table as context only", () => {
    expect(reasonOf(inCells(facts(DOC, { first: 2 }), ["r0c0"], 2))).toBe(
      "nested_table",
    );
  });

  it.each([
    ["a collapsed cursor", { isEmpty: true }],
    ["a picture or shape", { objectOnly: true }],
    ["a comment balloon", { storyType: "Unknown" }],
  ])("offers no chip for %s", (_, overrides) => {
    expect(classify({ ...INLINE, ...overrides })).toEqual({ role: "none" });
  });

  it("offers no chip for a selection without text", () => {
    const story = body(["Intro", "", "Outro"]);
    expect(classify(facts(story, { first: 1 }))).toEqual({ role: "none" });
  });

  it("caps a rewrite at 40 paragraphs", () => {
    const story = body(Array.from({ length: 41 }, (_, i) => `Line ${i}`));
    expect(reasonOf(facts(story, { first: 0, last: 39 }))).toBeNull();
    expect(reasonOf(facts(story, { first: 0, last: 40 }))).toBe(
      "too_many_paragraphs",
    );
  });

  it("caps a rewrite at 65,536 UTF-8 bytes", () => {
    const fits = `${"€".repeat(21_845)}a`;
    const over = `${"€".repeat(21_845)}ab`;
    expect(reasonOf(facts(body(["Intro", fits]), { first: 1 }))).toBeNull();
    expect(reasonOf(facts(body(["Intro", over]), { first: 1 }))).toBe(
      "too_large",
    );
  });

  it("sends a span that cannot be told apart without a hint as context only", () => {
    const texts = ["B", "B", "B", "T", "B", "B", "B", "T", "B", "B", "B"];
    const withoutIds = facts(body(texts, false), { first: 3 });
    expect(withoutIds.anchor?.window).toBeNull();
    expect(reasonOf(withoutIds)).toBe("not_unique");
    expect(reasonOf({ ...withoutIds, trackedRange: true })).toBeNull();
    expect(reasonOf(facts(body(texts), { first: 3 }))).toBeNull();
  });

  it("locates a unique span without IDs", () => {
    expect(
      reasonOf(
        facts(
          body(
            DOC.map((p) => p.text),
            false,
          ),
          { first: 2 },
        ),
      ),
    ).toBeNull();
  });
});

describe("classifyWordSelection: hosts and edges", () => {
  it("sends a span after an inline picture as context only on the web, not on desktop", () => {
    const shifted = { ...INLINE, pictureBeforeSpan: true };
    expect(reasonOf(shifted, WEB)).toBe("web_picture_offset");
    expect(reasonOf(shifted, MAC)).toBeNull();
    expect(reasonOf(shifted, PC)).toBeNull();
    expect(reasonOf(INLINE, WEB)).toBeNull();
  });

  it("keeps direct complex-script formatting only where the bidi setters exist", () => {
    const complex = { ...PARAGRAPH, hazards: { complexScript: true } };
    expect(reasonOf(complex, MAC)).toBeNull();
    expect(reasonOf(complex, WEB)).toBe("complex_script_format");
    expect(reasonOf(complex, LTSC_2024)).toBe("complex_script_format");
    expect(reasonOf(PARAGRAPH, LTSC_2024)).toBeNull();
  });

  it("sends a span holding a tracked change, such as an earlier tracked Replace, as context only", () => {
    expect(reasonOf({ ...INLINE, hazards: { trackedChange: true } })).toBe(
      "tracked_changes",
    );
  });

  it("needs the paragraph style's font", () => {
    expect(reasonOf({ ...PARAGRAPH, styleFontResolved: false })).toBe(
      "style_font_unavailable",
    );
    expect(reasonOf(PARAGRAPH, { ...MAC, styleFontSource: null })).toBe(
      "style_font_unavailable",
    );
  });

  it("sends everything as context only on a host that cannot rewrite", () => {
    const reduced: WordSelectionFacts = {
      ...PARAGRAPH,
      selectionText: "Second paragraph.\r",
      paragraphs: [],
      anchor: null,
      startOffset: 0,
      endOffset: 0,
    };
    expect(classify(reduced, LTSC_2021)).toEqual({
      role: "context_only",
      shape: "inline",
      story: "main",
      reasonCode: "host_unsupported",
    });
    expect(reasonOf(PARAGRAPH, LTSC_2021)).toBe("host_unsupported");
  });

  it("refuses empty edge paragraphs but keeps empty ones inside", () => {
    const story = body(["Intro", "One", "", "Three", "Outro"]);
    expect(reasonOf(facts(story, { first: 1, last: 3 }))).toBeNull();
    expect(reasonOf(facts(story, { first: 1, last: 3, start: 3 }))).toBe(
      "empty_edge_paragraph",
    );
    expect(reasonOf(facts(story, { first: 1, last: 3, end: 0 }))).toBe(
      "empty_edge_paragraph",
    );
  });

  it("refuses offsets that do not fit the paragraphs or an anchor that does not match them", () => {
    expect(reasonOf({ ...INLINE, endOffset: 500 })).toBe("position_unknown");
    expect(reasonOf({ ...INLINE, startOffset: 10, endOffset: 9 })).toBe(
      "position_unknown",
    );
    expect(reasonOf({ ...INLINE, anchor: null })).toBe("position_unknown");
    expect(reasonOf({ ...INLINE, anchor: PARAGRAPH.anchor })).toBe(
      "position_unknown",
    );
  });

  it("refuses a span that search could not find at its offset", () => {
    const story = body(["Intro", "aaa"]);
    expect(reasonOf(facts(story, { first: 1, start: 1, end: 3 }))).toBe(
      "position_unknown",
    );
  });

  it("reserves exactly one distinct V2-4 message per reason", () => {
    const ids = Object.values(WORD_SELECTION_REASON_MESSAGE_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(/^officeAddin\.word\.selection\.contextOnly\.\w+$/);
  });
});

const snapshot = (
  selection: WordSelectionFacts,
  support = MAC,
): WordSelectionSnapshot => {
  const built = buildWordSelectionSnapshot(
    selection,
    support,
    "user",
    REWRITE_SHAPES,
  );
  if (!built) throw new Error("no snapshot");
  return built;
};

describe("buildWordSelectionSnapshot", () => {
  it("records the span, its occurrence and the text around it", () => {
    expect(snapshot(INLINE)).toEqual({
      role: "rewrite",
      reasonCode: null,
      shape: "inline",
      story: "main",
      origin: "user",
      selectedText: "quick",
      truncated: false,
      paragraphCount: 1,
      paragraphs: [
        {
          id: "p1",
          text: DOC[1].text,
          rangeText: DOC[1].text,
          index: 1,
          styleName: "Normal",
        },
      ],
      startOffset: 4,
      endOffset: 9,
      occurrence: 0,
      anchor: INLINE.anchor,
      contextBefore: "Title\nThe ",
      contextAfter:
        " brown fox jumps over the lazy dog.\nSecond paragraph.\nThird paragraph.\nClosing.",
    });
  });

  it("counts earlier matches of the selected text in its paragraph", () => {
    const story = body(["the cat and the dog"]);
    expect(
      snapshot(facts(story, { first: 0, start: 12, end: 15 })),
    ).toMatchObject({ selectedText: "the", occurrence: 1 });
  });

  it("joins the covered part of each paragraph, one line each", () => {
    const multi = snapshot(MULTI);
    expect(multi.selectedText).toBe(
      "quick brown fox jumps over the lazy dog.\nSecond paragraph.\nThird",
    );
    expect(wordSelectionParts(multi)).toEqual([
      "quick brown fox jumps over the lazy dog.",
      "Second paragraph.",
      "Third",
    ]);
    expect(multi.contextBefore).toBe("Title\nThe ");
    expect(multi.contextAfter).toBe(" paragraph.\nClosing.");
  });

  it("marks a span at the start and end of its paragraph with empty edge lines", () => {
    const whole = snapshot(PARAGRAPH);
    expect(whole.contextBefore).toBe(
      "Title\nThe quick brown fox jumps over the lazy dog.\n",
    );
    expect(whole.contextAfter).toBe("\nThird paragraph.\nClosing.");
  });

  it("keeps the context near the span within its byte budget", () => {
    const story = body([
      "😀".repeat(3_000),
      "Target text here",
      "x".repeat(9_000),
    ]);
    const built = snapshot(facts(story, { first: 1, start: 7, end: 11 }));
    expect(utf8ByteLength(built.contextBefore)).toBeLessThanOrEqual(
      WORD_SELECTION_CONTEXT_BYTES,
    );
    expect(built.contextBefore.endsWith("😀\nTarget ")).toBe(true);
    expect(built.contextBefore).not.toMatch(/^[\uDC00-\uDFFF]/);
    expect(utf8ByteLength(built.contextAfter)).toBe(
      WORD_SELECTION_CONTEXT_BYTES,
    );
    expect(built.contextAfter.startsWith(" here\nxxx")).toBe(true);
  });

  it("cuts an over-cap context-only selection at a paragraph boundary", () => {
    const part = "€".repeat(15_000);
    const built = snapshot(
      facts(body(["Intro", part, part, part]), { first: 1, last: 3 }),
    );
    expect(built).toMatchObject({
      role: "context_only",
      reasonCode: "too_large",
      selectedText: part,
      truncated: true,
      paragraphCount: 3,
    });
  });

  it("keeps the text of a host that cannot rewrite", () => {
    const built = snapshot(
      {
        ...PARAGRAPH,
        selectionText: "Alpha\rBeta\r",
        paragraphs: [],
        anchor: null,
        startOffset: 0,
        endOffset: 0,
      },
      LTSC_2021,
    );
    expect(built).toMatchObject({
      role: "context_only",
      reasonCode: "host_unsupported",
      shape: "multi_paragraph",
      selectedText: "Alpha\nBeta",
      paragraphCount: 2,
      contextBefore: "",
      contextAfter: "",
    });
  });

  it("returns nothing when the selection offers no chip", () => {
    expect(
      buildWordSelectionSnapshot({ ...INLINE, isEmpty: true }, MAC, "user"),
    ).toBeNull();
  });

  it("records the origin", () => {
    expect(buildWordSelectionSnapshot(INLINE, MAC, "erato")?.origin).toBe(
      "erato",
    );
  });
});

describe("selection captures", () => {
  it("carries the selection beside an empty document capture", () => {
    const selection = snapshot(PARAGRAPH);
    const capture = emptySelectionCapture("doc-1", selection);
    expect(capture).toMatchObject({
      identity: "doc-1",
      paragraphsSent: 0,
      partialOrdinal: null,
      selection,
    });
    expect(capture.ordinalMap.size).toBe(0);
    expect(capture.renderedOrdinals.size).toBe(0);
    expect(wordSelectionOf(capture)).toBe(selection);
    expect(wordSelectionOf(null)).toBeNull();
  });

  it("lets Replace run only on a rewrite capture of an enabled shape", () => {
    const rewrite = emptySelectionCapture("doc-1", snapshot(PARAGRAPH));
    expect(rewritableWordSelection(rewrite)).toBeNull();
    expect(rewritableWordSelection(rewrite, REWRITE_SHAPES)).toBe(
      rewrite.selection,
    );
    const contextOnly = emptySelectionCapture(
      "doc-1",
      snapshot({ ...PARAGRAPH, hazards: { field: true } }),
    );
    expect(rewritableWordSelection(contextOnly, REWRITE_SHAPES)).toBeNull();
    expect(rewritableWordSelection(undefined, REWRITE_SHAPES)).toBeNull();
  });
});

const rangeTexts = (story: WordParagraphEntry[]) => story.map((p) => p.text);
const without = (story: WordParagraphEntry[], ids: boolean) =>
  ids ? story : story.map((p) => ({ ...p, id: null }));

describe("resolveWordSelection", () => {
  const texts = ["Intro", "Target text", "Outro"];

  it.each([true, false])("resolves an unchanged paragraph (IDs: %s)", (ids) => {
    const story = body(texts, ids);
    expect(
      resolveWordSelection(
        snapshot(facts(story, { first: 1 })),
        story,
        rangeTexts(story),
      ),
    ).toEqual({ positions: [1] });
  });

  it.each([true, false])(
    "follows a paragraph inserted above, whatever the stored index says (IDs: %s)",
    (ids) => {
      const selection = snapshot(facts(body(texts, ids), { first: 1 }));
      const live = without([{ id: "new", text: "Added" }, ...body(texts)], ids);
      expect(selection.paragraphs[0].index).toBe(1);
      expect(resolveWordSelection(selection, live, rangeTexts(live))).toEqual({
        positions: [2],
      });
    },
  );

  it.each([true, false])(
    "refuses an edit inside the paragraph (IDs: %s)",
    (ids) => {
      const selection = snapshot(facts(body(texts, ids), { first: 1 }));
      const live = body(["Intro", "Target text, edited", "Outro"], ids);
      expect(resolveWordSelection(selection, live, rangeTexts(live))).toEqual({
        refused: "TARGET_TEXT_MISMATCH",
      });
    },
  );

  it.each([true, false])("refuses a deleted paragraph (IDs: %s)", (ids) => {
    const selection = snapshot(facts(body(texts, ids), { first: 1 }));
    const live = without(
      [
        { id: "p0", text: "Intro" },
        { id: "p2", text: "Outro" },
      ],
      ids,
    );
    expect(resolveWordSelection(selection, live, rangeTexts(live))).toEqual({
      refused: "TARGET_NOT_FOUND",
    });
  });

  it.each([true, false])(
    "refuses when the offset text changed but the identity text did not (IDs: %s)",
    (ids) => {
      const story = body(texts, ids);
      const selection = snapshot(facts(story, { first: 1 }));
      const live = rangeTexts(story);
      live[1] = "Target \u0005text";
      expect(resolveWordSelection(selection, story, live)).toEqual({
        refused: "TARGET_TEXT_MISMATCH",
      });
    },
  );

  it("refuses a copy that appeared after capture without IDs, but not with them", () => {
    const copied = ["Intro", "Target text", "Outro", "Q", "Target text", "R"];
    expect(
      resolveWordSelection(
        snapshot(facts(body(texts, false), { first: 1 })),
        body(copied, false),
        copied,
      ),
    ).toEqual({ refused: "AMBIGUOUS_TARGET" });
    expect(
      resolveWordSelection(
        snapshot(facts(body(texts), { first: 1 })),
        copied.map((text, i) => ({ id: i < 3 ? `p${i}` : `c${i}`, text })),
        copied,
      ),
    ).toEqual({ positions: [1] });
  });

  it("refuses a multi-paragraph span with a paragraph inserted inside it", () => {
    const story = body(["A", "One", "Two", "B"], false);
    const selection = snapshot(facts(story, { first: 1, last: 2 }));
    const live = body(["A", "One", "X", "Two", "B"], false);
    expect(resolveWordSelection(selection, live, rangeTexts(live))).toEqual({
      refused: "TARGET_NOT_FOUND",
    });
    expect(resolveWordSelection(selection, story, rangeTexts(story))).toEqual({
      positions: [1, 2],
    });
  });

  it("refuses when Word's IDs are gone and the text is no longer unique", () => {
    const selection = snapshot(facts(body(texts), { first: 1 }));
    const live = body([...texts, ...texts], false);
    expect(resolveWordSelection(selection, live, rangeTexts(live))).toEqual({
      refused: "AMBIGUOUS_TARGET",
    });
  });

  it("refuses a selection without an anchor", () => {
    const story = body(texts);
    expect(
      resolveWordSelection(
        { ...snapshot(facts(story, { first: 1 })), anchor: null },
        story,
        rangeTexts(story),
      ),
    ).toEqual({ refused: "TARGET_NOT_FOUND" });
  });

  describe("with a tracked Range hint", () => {
    it("must agree with a surviving ID", () => {
      const story = body(texts);
      const selection = snapshot(facts(story, { first: 1 }));
      expect(
        resolveWordSelection(selection, story, rangeTexts(story), {
          position: 1,
        }),
      ).toEqual({ positions: [1] });
      expect(
        resolveWordSelection(selection, story, rangeTexts(story), {
          position: 2,
        }),
      ).toEqual({ refused: "HINT_CONFLICT" });
    });

    it("proposes repeated text without IDs, and the exact text decides", () => {
      const story = body(
        ["B", "B", "B", "T", "B", "B", "B", "T", "B", "B", "B"],
        false,
      );
      const selection = snapshot(
        facts(story, { first: 3 }, { trackedRange: true }),
      );
      expect(selection.role).toBe("rewrite");
      const live = rangeTexts(story);
      expect(resolveWordSelection(selection, story, live)).toEqual({
        refused: "AMBIGUOUS_TARGET",
      });
      expect(
        resolveWordSelection(selection, story, live, { position: 3 }),
      ).toEqual({ positions: [3] });
      expect(
        resolveWordSelection(selection, story, live, { position: 2 }),
      ).toEqual({ refused: "TARGET_TEXT_MISMATCH" });
    });

    it("refuses when the hint and a unique text match disagree without IDs", () => {
      const story = body(["P", "T", "N", "Q", "T", "R"], false);
      const selection = snapshot(facts(story, { first: 4 }));
      expect(
        resolveWordSelection(selection, story, rangeTexts(story), {
          position: 1,
        }),
      ).toEqual({ refused: "AMBIGUOUS_TARGET" });
      expect(
        resolveWordSelection(selection, story, rangeTexts(story), {
          position: 4,
        }),
      ).toEqual({ positions: [4] });
    });
  });
});
