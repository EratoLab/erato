import { describe, expect, it } from "vitest";

import { utf8ByteLength } from "../../../core/clientActions/actionFacetArgs";
import { wordParagraphAnchor } from "../wordParagraphResolver";
import { buildWordSelectionSnapshot } from "../wordSelectionAnchor";
import {
  fitWordSelectionText,
  WORD_SELECTION_ARG_KEYS,
  wordSelectionFacetArgs,
} from "../wordSelectionArgs";
import { wordSelectionSupport } from "../wordSelectionSupport";

import type { WordSelectionSnapshot } from "../wordSelectionAnchor";

const story = [
  { id: "p0", text: "Intro" },
  { id: "p1", text: "Heading text" },
  { id: "p2", text: "Body text" },
  { id: "p3", text: "Outro" },
];

const SELECTION: WordSelectionSnapshot = {
  role: "rewrite",
  reasonCode: null,
  shape: "multi_paragraph",
  story: "main",
  origin: "user",
  selectedText: "Heading text\nBody text",
  truncated: false,
  paragraphCount: 2,
  paragraphs: [
    {
      ...story[1],
      rangeText: story[1].text,
      index: 1,
      styleName: "Heading 1",
      tableNestingLevel: 0,
    },
    {
      ...story[2],
      rangeText: story[2].text,
      index: 2,
      styleName: "Normal",
      tableNestingLevel: 0,
    },
  ],
  startOffset: 0,
  endOffset: 9,
  occurrence: 0,
  anchor: wordParagraphAnchor(story, 1, 2),
  contextBefore: "Intro\n",
  contextAfter: "\nOutro",
};

const ALL = new Set<string>(WORD_SELECTION_ARG_KEYS);
const args = (
  selection: WordSelectionSnapshot = SELECTION,
  allowed: ReadonlySet<string> | undefined = ALL,
) =>
  wordSelectionFacetArgs(
    { documentName: "Report.docx", documentIdentity: "doc-1", selection },
    allowed,
  );

describe("wordSelectionFacetArgs", () => {
  it("pins the owner-frozen argument keys", () => {
    expect(WORD_SELECTION_ARG_KEYS).toEqual([
      "document_name",
      "document_identity",
      "selected_text",
      "selection_role",
      "context_reason",
      "selection_shape",
      "selection_story",
      "paragraph_count",
      "style_names",
      "context_before",
      "context_after",
      "truncated",
    ]);
  });

  it("fills every advertised key and never sends text_version", () => {
    expect(args()).toEqual({
      document_name: "Report.docx",
      document_identity: "doc-1",
      selected_text: "Heading text\nBody text",
      selection_role: "rewrite",
      context_reason: "",
      selection_shape: "multi_paragraph",
      selection_story: "main",
      paragraph_count: "2",
      style_names: "Heading 1\nNormal",
      context_before: "Intro\n",
      context_after: "\nOutro",
      truncated: "false",
    });
    expect(
      args(SELECTION, new Set([...WORD_SELECTION_ARG_KEYS, "text_version"])),
    ).not.toHaveProperty("text_version");
  });

  it("sends the reason of a context-only selection", () => {
    expect(
      args({
        ...SELECTION,
        role: "context_only",
        reasonCode: "hyperlink",
      }),
    ).toMatchObject({
      selection_role: "context_only",
      context_reason: "hyperlink",
    });
  });

  it("offers a passage inside one paragraph for rewriting", () => {
    const text = "The quick brown fox.";
    const inline = buildWordSelectionSnapshot(
      {
        isEmpty: false,
        storyType: "MainDoc",
        selectionText: "quick",
        objectOnly: false,
        tables: "none",
        paragraphs: [
          {
            id: "p1",
            text,
            rangeText: text,
            index: 1,
            styleName: "Normal",
            tableNestingLevel: 0,
            cell: null,
          },
        ],
        startOffset: 4,
        endOffset: 9,
        anchor: wordParagraphAnchor(
          [story[0], { id: "p1", text }, story[2]],
          1,
          1,
        ),
        hazards: {},
        pictureBeforeSpan: false,
        styleFontResolved: true,
        spanChecked: true,
      },
      wordSelectionSupport(() => true, "Mac"),
      "user",
    );
    if (!inline) throw new Error("no snapshot");
    expect(args(inline)).toMatchObject({
      selected_text: "quick",
      selection_role: "rewrite",
      context_reason: "",
      selection_shape: "inline",
    });
  });

  it.each([
    [
      "several paragraphs",
      [null, null],
      "multi_paragraph",
      "Heading text\nBody",
    ],
    ["one table cell", ["r0c0"], "table_cell", "Heading text"],
  ] as const)("offers %s for rewriting", (_, cells, shape, selectedText) => {
    const covered = cells.map((cell, i) => ({
      ...story[i + 1],
      rangeText: story[i + 1].text,
      index: i + 1,
      styleName: "Normal",
      tableNestingLevel: cell ? 1 : 0,
      cell,
    }));
    const snapshot = buildWordSelectionSnapshot(
      {
        isEmpty: false,
        storyType: "MainDoc",
        selectionText: selectedText.replaceAll("\n", "\r"),
        objectOnly: false,
        tables: cells[0] ? "partial" : "none",
        paragraphs: covered,
        startOffset: 0,
        endOffset: covered.length > 1 ? 4 : covered[0].rangeText.length,
        anchor: wordParagraphAnchor(story, 1, covered.length),
        hazards: {},
        pictureBeforeSpan: false,
        styleFontResolved: true,
        spanChecked: true,
      },
      wordSelectionSupport(() => true, "Mac"),
      "user",
    );
    if (!snapshot) throw new Error("no snapshot");
    expect(args(snapshot)).toMatchObject({
      selected_text: selectedText,
      selection_role: "rewrite",
      context_reason: "",
      selection_shape: shape,
    });
  });

  it("drops keys the server does not advertise", () => {
    const allowed = new Set(
      WORD_SELECTION_ARG_KEYS.filter(
        (key) => key !== "context_before" && key !== "style_names",
      ),
    );
    const sent = args(SELECTION, allowed);
    expect(Object.keys(sent).sort()).toEqual([...allowed].sort());
    expect(
      wordSelectionFacetArgs(
        {
          documentName: "Report.docx",
          documentIdentity: "doc-1",
          selection: SELECTION,
        },
        undefined,
      ),
    ).toEqual({});
  });

  it("truncates the selected text only at a paragraph boundary", () => {
    const line = "€".repeat(10_000);
    const lines = Array.from({ length: 5 }, (_, i) => `${i}${line}`);
    const sent = args({
      ...SELECTION,
      role: "context_only",
      reasonCode: "too_large",
      selectedText: lines.join("\n"),
    });
    expect(sent.selected_text).toBe(lines.slice(0, 2).join("\n"));
    expect(utf8ByteLength(sent.selected_text)).toBeLessThanOrEqual(65_536);
    expect(sent.truncated).toBe("true");
  });

  it("keeps a selection already cut at capture marked as truncated", () => {
    expect(args({ ...SELECTION, truncated: true }).truncated).toBe("true");
  });
});

describe("fitWordSelectionText", () => {
  it("passes text at the limit and cuts one byte over it", () => {
    expect(fitWordSelectionText(`${"a".repeat(65_534)}\nb`)).toEqual({
      text: `${"a".repeat(65_534)}\nb`,
      truncated: false,
    });
    expect(fitWordSelectionText(`${"a".repeat(65_535)}\nb`)).toEqual({
      text: "a".repeat(65_535),
      truncated: true,
    });
  });

  it("cuts inside a first paragraph that alone exceeds the limit, at a code point", () => {
    const fitted = fitWordSelectionText(`${"😀".repeat(20_000)}\nnext`);
    expect(fitted.truncated).toBe(true);
    expect(fitted.text).toBe("😀".repeat(16_384));
  });
});
