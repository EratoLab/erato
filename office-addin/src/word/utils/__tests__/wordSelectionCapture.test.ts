import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import {
  captureWordSelection,
  describeWordSelection,
  WORD_SELECTION_SPAN_CHECK_MS_PER_PARAGRAPH,
} from "../wordSelectionCapture";

import type {
  MockSelectionDocument,
  MockSelectionTarget,
  WordSelectionHostOptions,
} from "../../../test/mocks/word/selectionHost";
import type {
  WordSelectionShape,
  WordSelectionSnapshot,
} from "../wordSelectionAnchor";

const HOSTS = ["mac", "pc", "web"] as const;

afterEach(() => {
  vi.useRealTimers();
  uninstallWordSelectionHost();
  delete window.WORD_FORCE_NO_PARAGRAPH_IDS;
});

async function captured(): Promise<WordSelectionSnapshot | null> {
  const read = await captureWordSelection();
  if (read.status !== "ok") throw new Error("capture failed");
  return read.value;
}

describe.each(HOSTS)("captureWordSelection on %s", (flavour) => {
  const install = (
    document: MockSelectionDocument = SV2_MAIN_DOCUMENT,
    options: WordSelectionHostOptions = {},
  ) => installWordSelectionHost(document, { host: flavour, ...options });
  const captureOf = async (
    target: MockSelectionTarget,
    document?: MockSelectionDocument,
  ) => {
    install(document).select(target);
    return captured();
  };

  it("records inline text with its offsets, its paragraph's identity and the anchor", async () => {
    const selection = await captureOf({ p: "PL1", text: "lima mike" });
    expect(selection).toMatchObject({
      role: "rewrite",
      reasonCode: null,
      shape: "inline",
      story: "main",
      origin: "user",
      selectedText: "lima mike",
      paragraphCount: 1,
      startOffset: 25,
      endOffset: 34,
      occurrence: 0,
      truncated: false,
    });
    expect(selection!.paragraphs).toEqual([
      expect.objectContaining({
        rangeText: "PL1 Plain paragraph kilo lima mike november oscar papa.",
        index: 2,
        styleName: "Normal",
      }),
    ]);
    expect(selection!.anchor).toMatchObject({ window: 0 });
    expect(selection!.anchor!.paragraphs[0].id).toBeTruthy();
    expect(selection!.contextBefore).toBe(
      "H1 Selection probe heading\nMX1 Alpha bravo charlie delta echo foxtrot link golf 2026-10-06 hotel india.\nPL1 Plain paragraph kilo ",
    );
    expect(selection!.contextAfter).toBe(
      " november oscar papa.\nLI1 List item quebec romeo.\nLI2 List item sierra tango.\nMP1 Multi paragraph uniform victor whiskey.",
    );
  });

  it.each(["Content", "Whole"] as const)(
    "records a whole paragraph selected as its %s range",
    async (part) => {
      const selection = await captureOf({ p: "PL1", part });
      expect(selection).toMatchObject({
        shape: "paragraph",
        selectedText: "PL1 Plain paragraph kilo lima mike november oscar papa.",
        startOffset: 0,
        endOffset: 55,
      });
    },
  );

  it("records several paragraphs as one line each", async () => {
    const selection = await captureOf({
      p: "MP1",
      text: "victor whiskey.",
      to: { p: "MP3", text: "MP3 Multi" },
    });
    expect(selection).toMatchObject({
      role: "rewrite",
      reasonCode: null,
      shape: "multi_paragraph",
      paragraphCount: 3,
      selectedText:
        "victor whiskey.\nMP2 Multi paragraph uniform xray yankee.\nMP3 Multi",
      startOffset: 28,
      endOffset: 9,
    });
    expect(selection!.paragraphs.map((p) => p.index)).toEqual([5, 6, 7]);
  });

  it.each([
    [0, 4],
    [1, 23],
    [2, 42],
  ])(
    "tells occurrence %i of a repeated passage apart by Word's search hits",
    async (occ, start) => {
      const host = install();
      host.select({ p: "RP1", text: "Repeated word one.", occ });
      const selection = await captured();
      expect(selection).toMatchObject({ startOffset: start, occurrence: occ });
      expect(host.calls()).toContain("Paragraph.search");
    },
  );

  it("searches a passage that occurs once only to check that Replace could find it", async () => {
    const host = install();
    host.select({ p: "PL1", text: "lima mike" });
    await captured();
    expect(
      host.calls().filter((call) => call === "Paragraph.search"),
    ).toHaveLength(1);
    expect(host.calls()).not.toContain("Range.compareLocationWith");
  });

  it("reads no search for a whole paragraph", async () => {
    const host = install();
    host.select({ p: "PL1" });
    await captured();
    expect(host.calls()).not.toContain("Paragraph.search");
  });

  it("leaves a repeated passage unplaced when Word's search cannot take it", async () => {
    const repeated = "x^y ".repeat(2);
    const selection = await captureOf(
      { paragraph: 0, text: "x^y", occ: 1 },
      { body: [repeated] },
    );
    expect(selection).toMatchObject({
      selectedText: "x^y",
      startOffset: -1,
      reasonCode: "position_unknown",
    });
  });

  it("records one table cell", async () => {
    const selection = await captureOf({ table: 0, cell: [1, 1] });
    expect(selection).toMatchObject({
      role: "rewrite",
      shape: "table_cell",
      selectedText: "CB2 Cell B2 text",
      reasonCode: null,
    });
    expect(selection!.paragraphs).toEqual([
      expect.objectContaining({ tableNestingLevel: 1 }),
    ]);
  });

  it.each([
    ["a whole table", { table: 0, tableWhole: true }, "whole_table"],
    [
      "two cells",
      { table: 0, cell: [0, 0], to: { table: 0, cell: [0, 1] } },
      "multi_cell",
    ],
  ] as const)("sends %s as context only", async (_, target, reasonCode) => {
    expect(await captureOf(target)).toMatchObject({
      role: "context_only",
      shape: "table",
      reasonCode,
    });
  });

  it.each([
    ["header", { story: "header", p: "HD1" }, "header"],
    [
      "footnote",
      { story: "footnote", text: "Footnote body" },
      // The web reports a footnote's body as a NoteItem (SV2:129-132).
      flavour === "web" ? "note" : "footnote",
    ],
    ["text box", { story: "textbox", p: "TB1" }, "text_box"],
  ] as const)(
    "sends text in a %s as context only",
    async (_, target, story) => {
      const selection = await captureOf(target);
      expect(selection).toMatchObject({
        role: "context_only",
        reasonCode: "other_story",
        story,
      });
      expect(selection!.anchor).toBeNull();
      expect(selection!.selectedText).not.toBe("");
    },
  );

  it.each([
    ["a collapsed cursor", { p: "PL1", collapse: "Start" }],
    ["a picture", { picture: 0 }],
    ["a comment balloon", { story: "comment", text: "Probe comment" }],
    [
      "body text into part of a table",
      { p: "PC1", to: { table: 0, cell: [0, 0] } },
    ],
  ] as const)("offers nothing for %s", async (_, target) => {
    expect(await captureOf(target)).toBeNull();
  });

  it("never sends tracked deletions to the model", async () => {
    const selection = await captureOf({
      p: "TC1",
      text: "kept",
      to: { p: "TC1", text: "end words" },
    });
    expect(selection!.selectedText).toBe("kept end words");
  });

  it("keeps field results, not codes, when tracked deletions make it send reviewed text", async () => {
    const selection = await captureOf({
      p: "FD1",
      text: "before",
      to: { p: "TC1", text: "end words" },
    });
    expect(selection!.selectedText).toBe(
      flavour === "mac"
        ? "before 2026-10-06 field after words.\nHT1 Hidden before hidden after words.\nTC1 Tracked inserted words kept end words"
        : // PC and the web read reviewed text there, which shows hidden text.
          "before 2026-10-06 field after words.\nHT1 Hidden before SECRET hidden after words.\nTC1 Tracked inserted words kept end words",
    );
  });

  it("marks a comment's anchor in the text sent instead of its control character", async () => {
    const selection = await captureOf({
      p: "CM1",
      text: "anchor phrase",
      to: { p: "CM1", text: "after" },
    });
    expect(selection!.selectedText).toBe("anchor phrase\u27E61\u27E7 after");
  });

  it("places paragraphs without IDs by comparing ranges", async () => {
    window.WORD_FORCE_NO_PARAGRAPH_IDS = true;
    const host = install();
    host.select({ p: "PL1", text: "lima mike" });
    const selection = await captured();
    expect(selection!.paragraphs[0]).toMatchObject({ id: null, index: 2 });
    expect(selection!.anchor).toMatchObject({ window: 0 });
    expect(host.calls()).toContain("Range.compareLocationWith");
  });

  it("places the right copy of a duplicated paragraph without IDs", async () => {
    const document: MockSelectionDocument = {
      body: ["Intro one.", "Same text.", "Middle.", "Same text.", "End."],
    };
    install(document, { nullParagraphIds: true }).select({
      paragraph: 3,
      text: "Same",
    });
    const selection = await captured();
    expect(selection!.paragraphs[0]).toMatchObject({ id: null, index: 3 });
    expect(selection!.anchor).toMatchObject({ window: 1 });
  });

  it("writes nothing and builds no range inside a paragraph", async () => {
    const host = install();
    const before = host.paragraphs();
    for (const target of [
      { p: "HT1", text: "before", to: { p: "HT1", text: "after" } },
      { p: "RT1", text: "ABC" },
      { p: "RP1", text: "Repeated word one.", occ: 1 },
      { p: "MX1", text: "bravo", to: { p: "PL1", text: "kilo" } },
      { table: 0, cell: [0, 1] },
    ] as const) {
      host.select(target);
      expect(await captured()).not.toBeNull();
    }
    expect(host.paragraphs()).toEqual(before);
    expect(host.writeSyncs()).toEqual([]);
    expect(host.calls()).not.toContain("Range.expandTo");
    expect(host.calls()).not.toContain("Paragraph.expandTo");
  });
});

describe("captureWordSelection across requirement levels", () => {
  it("sends LTSC 2021's selection text without reading paragraph texts it cannot", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
      host: "pc",
      requirements: "ltsc2021",
    });
    host.select({ p: "PL1", text: "lima mike" });
    const selection = await captured();
    expect(selection).toMatchObject({
      role: "context_only",
      reasonCode: "host_unsupported",
      selectedText: "lima mike",
      anchor: null,
    });
    expect(selection!.paragraphs).toEqual([
      expect.objectContaining({ id: null, index: -1 }),
    ]);
    expect(host.calls()).not.toContain("Paragraph.getText");
    expect(host.calls()).not.toContain("Range.getReviewedText");
  });

  it("keeps a table cell on LTSC 2021, which cannot rewrite it", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
      host: "pc",
      requirements: "ltsc2021",
    });
    host.select({ table: 0, cell: [0, 1] });
    expect(await captured()).toMatchObject({
      reasonCode: "host_unsupported",
      shape: "table_cell",
      selectedText: "CB1 Cell B1 text",
    });
  });

  it("places LTSC 2024's paragraphs, which have no IDs", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
      host: "pc",
      requirements: "ltsc2024",
    });
    host.select({ p: "PL1", text: "lima mike" });
    const selection = await captured();
    expect(selection).toMatchObject({ role: "rewrite", reasonCode: null });
    expect(selection!.paragraphs[0]).toMatchObject({ id: null, index: 2 });
  });
});

describe("captureWordSelection when Word does not answer", () => {
  it("reports a failure, never a partial snapshot", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    host.select({ p: "PL1", text: "lima mike" });
    const hang = host.hangSync({ at: 2 });
    const read = captureWordSelection("user", 20);
    await hang.reached;
    expect(await read).toEqual({ status: "failed" });
    hang.release();
  });
});

describe("captureWordSelection of many paragraphs on the web", () => {
  const FORTY = { body: Array.from({ length: 42 }, (_, i) => `Line ${i}.`) };
  const SHAPES = new Set<WordSelectionShape>(["multi_paragraph"]);
  const BASE_MS = 1_000;
  const BUDGET_MS = BASE_MS + 40 * WORD_SELECTION_SPAN_CHECK_MS_PER_PARAGRAPH;
  /** The span checks' sync, counted from the start of a capture on a fresh host. */
  const spanCheckSync = async () => {
    const host = installWordSelectionHost(FORTY, { host: "web" });
    host.select({ paragraph: 0, to: { paragraph: 39 } });
    const before = host.syncCount();
    await captureWordSelection("user", BASE_MS, SHAPES);
    const entry = host
      .syncLog()
      .find((sync) =>
        sync.commands.some((command) => command.endsWith(".getOoxml")),
      );
    uninstallWordSelectionHost();
    if (!entry) throw new Error("no span checks");
    return entry.index - before;
  };

  it.each([
    ["finishes", BUDGET_MS - 1, { status: "ok" }],
    ["fails", BUDGET_MS, { status: "failed" }],
  ] as const)(
    "gives the span checks of 40 paragraphs time beyond the base timeout, and %s at the end of it",
    async (_, wait, expected) => {
      const offset = await spanCheckSync();
      const host = installWordSelectionHost(FORTY, { host: "web" });
      host.select({ paragraph: 0, to: { paragraph: 39 } });
      vi.useFakeTimers();
      const hang = host.hangSync({ at: host.syncCount() + offset });
      const read = captureWordSelection("user", BASE_MS, SHAPES);
      await hang.reached;
      await vi.advanceTimersByTimeAsync(wait);
      hang.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(await read).toMatchObject(expected);
    },
  );
});

describe("describeWordSelection", () => {
  it.each(HOSTS)(
    "shows what would be sent on %s, reading only the selected paragraphs",
    async (flavour) => {
      const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
        host: flavour,
      });
      host.select({
        p: "MP1",
        text: "victor whiskey.",
        to: { p: "MP2", text: "MP2 Multi" },
      });
      const read = await describeWordSelection();
      expect(read).toEqual({
        status: "ok",
        value: {
          key: expect.any(String),
          text: "victor whiskey.\nMP2 Multi",
          paragraphCount: 2,
          shape: "multi_paragraph",
          story: "main",
          truncated: false,
          mayRewrite: true,
        },
      });
      expect(host.syncCount()).toBe(2);
      expect(
        host.calls().filter((call) => call === "Paragraph.getText"),
      ).toHaveLength(2);
    },
  );

  it.each(HOSTS)(
    "shows on %s the text Send sends, without comment marks or tracked deletions",
    async (flavour) => {
      const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
        host: flavour,
      });
      const shown = async (target: MockSelectionTarget) => {
        host.select(target);
        const read = await describeWordSelection();
        return read.status === "ok" ? read.value?.text : undefined;
      };
      expect(
        await shown({
          p: "CM1",
          text: "anchor",
          to: { p: "CM1", text: "after" },
        }),
      ).toBe("anchor phrase after");
      expect(await shown({ p: "CM1", text: "Commented" })).toBe("Commented");
      expect(
        await shown({
          p: "TC1",
          text: "kept",
          to: { p: "TC1", text: "end words" },
        }),
      ).toBe("kept end words");
    },
  );

  it("reads one sync on a host without getText", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
      host: "pc",
      requirements: "ltsc2021",
    });
    host.select({ p: "PL1", text: "lima mike" });
    expect(await describeWordSelection()).toMatchObject({
      status: "ok",
      value: { text: "lima mike" },
    });
    expect(host.syncCount()).toBe(1);
    expect(host.calls()).not.toContain("Paragraph.getText");
  });

  it("gives the same text in another paragraph a new key", async () => {
    const host = installWordSelectionHost({
      body: ["One same words.", "Two same words."],
    });
    const keyOf = async (paragraph: number) => {
      host.select({ paragraph, text: "same words" });
      const read = await describeWordSelection();
      return read.status === "ok" ? read.value?.key : undefined;
    };
    expect(await keyOf(0)).not.toBe(await keyOf(1));
  });

  it("reads the cells of a table selection", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, { host: "web" });
    host.select({ table: 0, tableWhole: true });
    const read = await describeWordSelection();
    expect(read).toMatchObject({
      status: "ok",
      value: { shape: "table", paragraphCount: 4 },
    });
  });

  it("offers nothing for a collapsed cursor", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    host.select({ p: "PL1", collapse: "End" });
    expect(await describeWordSelection()).toEqual({
      status: "ok",
      value: null,
    });
  });

  it("reports a failure when Word does not answer", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    const hang = host.hangSync();
    const read = describeWordSelection(20);
    await hang.reached;
    expect(await read).toEqual({ status: "failed" });
    hang.release();
  });
});

describe.each(HOSTS)(
  "captureWordSelection with whole paragraphs enabled on %s",
  (flavour) => {
    const PARAGRAPHS = new Set<WordSelectionShape>(["paragraph"]);
    const capture = async (
      target: MockSelectionTarget,
      document: MockSelectionDocument = SV2_MAIN_DOCUMENT,
    ) => {
      const host = installWordSelectionHost(document, { host: flavour });
      host.select(target);
      const read = await captureWordSelection("user", 15_000, PARAGRAPHS);
      if (read.status !== "ok") throw new Error("capture failed");
      return { host, selection: read.value };
    };

    it("offers a plain whole paragraph for rewriting", async () => {
      const { selection } = await capture({ p: "PL1" });
      expect(selection).toMatchObject({
        role: "rewrite",
        reasonCode: null,
        shape: "paragraph",
      });
    });

    it.each([
      ["HT1", "hidden_text"],
      ["TC1", "tracked_changes"],
      ["RT1", "complex_script_format"],
    ] as const)("keeps %s context only (%s)", async (p, reasonCode) => {
      const { selection } = await capture({ p });
      expect(selection).toMatchObject({ role: "context_only", reasonCode });
    });

    it.each([
      [
        "MX1",
        "MX1 Alpha bravo charlie delta echo foxtrot \u27E61\u27E7link\u27E6/1\u27E7 golf \u27E62\u27E7 hotel india.",
      ],
      ["FD1", "FD1 Field before \u27E61\u27E7 field after words."],
      ["CM1", "CM1 Commented anchor phrase\u27E61\u27E7 after comment."],
      ["FN1", "FN1 Footnote host sentence\u27E61\u27E7 continues here."],
      ["PC1", "PC1 Picture: \u27E61\u27E7 after picture."],
    ] as const)(
      "offers %s for rewriting with its items marked to stay",
      async (p, text) => {
        const { selection } = await capture({ p });
        if (flavour === "web" && p === "PC1") {
          // The web's selection text shows a picture as a space that paragraph.text lacks, so the
          // span is not placed as a whole paragraph there.
          expect(selection).toMatchObject({
            role: "context_only",
            reasonCode: "shape_not_enabled",
          });
          return;
        }
        expect(selection).toMatchObject({
          role: "rewrite",
          reasonCode: null,
          selectedText: text,
        });
        expect(selection!.paragraphs[0].kept?.text).toBe(text);
      },
    );

    it("takes a mixed toggle from the paragraph style and refuses a partial colour", async () => {
      const document: MockSelectionDocument = {
        body: [
          "Intro.",
          {
            runs: ["Mixed ", { text: "bold", font: { bold: true } }, " words."],
          },
          {
            runs: [
              "Part ",
              { text: "red", font: { color: "#C00000" } },
              " words.",
            ],
          },
          "Outro.",
        ],
      };
      expect(
        (await capture({ paragraph: 1 }, document)).selection,
      ).toMatchObject({
        role: "rewrite",
      });
      expect(
        (await capture({ paragraph: 2 }, document)).selection,
      ).toMatchObject({
        role: "context_only",
        reasonCode: "mixed_formatting",
      });
    });

    const FIELD = { text: "3", field: "PAGE" };

    it.each([
      [
        "a colour on part of it",
        ["Part ", { text: "red", font: { color: "#C00000" } }, " words "],
      ],
      [
        "a highlight on part of it",
        ["Part ", { text: "marked", font: { highlightColor: "Yellow" } }, " "],
      ],
      [
        "a font on part of it",
        ["Part ", { text: "Arial", font: { name: "Arial" } }, " "],
      ],
      [
        "a size on part of it",
        ["Part ", { text: "big", font: { size: 16 } }, " "],
      ],
      [
        "a character style on part of it",
        ["Part ", { text: "strong", rStyle: "Strong" }, " "],
      ],
    ] as const)(
      "keeps a paragraph that keeps a field context only for %s",
      async (_, runs) => {
        const { selection } = await capture(
          { paragraph: 1 },
          { body: ["Intro.", { runs: [...runs, FIELD, " end."] }, "Outro."] },
        );
        expect(selection).toMatchObject({
          role: "context_only",
          reasonCode: "mixed_formatting",
        });
        expect(selection!.paragraphs[0].kept).toBeUndefined();
      },
    );

    it("rewrites a paragraph that keeps a field when its text is formatted alike", async () => {
      const red = { color: "#C00000", size: 14 };
      const { selection } = await capture(
        { paragraph: 1 },
        {
          body: [
            "Intro.",
            {
              runs: [
                { text: "All red ", font: red, rStyle: "Strong" },
                FIELD,
                { text: " words.", font: red, rStyle: "Strong" },
              ],
            },
            "Outro.",
          ],
        },
      );
      expect(selection).toMatchObject({ role: "rewrite", reasonCode: null });
      expect(selection!.flattensEmphasis).toBeUndefined();
    });

    it.each([
      [
        "without kept items",
        ["Area 12 m", { text: "2", font: { superscript: true } }, "."],
      ],
      [
        "with a kept field",
        ["Area ", FIELD, " m", { text: "2", font: { superscript: true } }, "."],
      ],
      [
        "with a subscript",
        ["CO", { text: "2", font: { subscript: true } }, " levels."],
      ],
    ] as const)(
      "keeps superscript or subscript on part of a paragraph context only, %s",
      async (_, runs) => {
        const { selection } = await capture(
          { paragraph: 1 },
          { body: ["Intro.", { runs }, "Outro."] },
        );
        expect(selection).toMatchObject({
          role: "context_only",
          reasonCode: "mixed_script",
        });
      },
    );

    it("tells the card when a rewrite flattens bold, italic, underline or strikethrough on part of the text", async () => {
      const document: MockSelectionDocument = {
        body: [
          "Intro.",
          {
            runs: ["Mixed ", { text: "bold", font: { bold: true } }, " words."],
          },
          { runs: [{ text: "All bold words.", font: { bold: true } }] },
          {
            runs: [
              { text: "Bold before ", font: { bold: true } },
              FIELD,
              " plain after.",
            ],
          },
          {
            runs: [
              "Plain ",
              { text: "struck", font: { strikeThrough: true } },
              FIELD,
            ],
          },
          "Outro.",
        ],
      };
      const flag = async (paragraph: number) =>
        (await capture({ paragraph }, document)).selection;
      expect(await flag(1)).toMatchObject({
        role: "rewrite",
        flattensEmphasis: true,
      });
      expect((await flag(2))!.flattensEmphasis).toBeUndefined();
      // Each piece between kept items keeps the formatting its own text shares.
      expect((await flag(3))!.flattensEmphasis).toBeUndefined();
      expect(await flag(4)).toMatchObject({
        role: "rewrite",
        flattensEmphasis: true,
      });
      expect((await capture({ p: "MX1" })).selection).toMatchObject({
        role: "rewrite",
        flattensEmphasis: true,
      });
      expect(
        (await capture({ p: "PL1" })).selection!.flattensEmphasis,
      ).toBeUndefined();
    });

    it.each([
      [
        "a table of contents' bookmark around a heading",
        "H1",
        [{ text: "H1 Selection probe heading", bookmark: "_Toc938001" }],
      ],
      [
        "a cross-reference's bookmark",
        "R7",
        [{ text: "R7 Signatures", bookmark: "_Ref938002" }],
      ],
      [
        "a user's bookmark around two words",
        "PB",
        ["PB Plain ", { text: "lima mike", bookmark: "Intro938" }, " papa."],
      ],
      [
        "a bookmark next to a field it could keep",
        "FB",
        ["FB Before ", { text: "marked", bookmark: "Mark938" }, FIELD],
      ],
    ] as const)(
      "keeps a paragraph holding %s context only and says it holds a bookmark",
      async (_, tag, runs) => {
        const host = installWordSelectionHost(
          { body: ["Intro.", { runs }, "Outro."] },
          { host: flavour },
        );
        expect(host.ooxml({ p: tag })).toContain("<w:bookmarkStart");
        host.select({ p: tag });
        const read = await captureWordSelection("user", 15_000, PARAGRAPHS);
        expect(read).toMatchObject({
          value: { role: "context_only", reasonCode: "bookmark" },
        });
      },
    );

    it("rewrites a paragraph holding only Word's own last-edit bookmark", async () => {
      const { selection } = await capture(
        { paragraph: 1 },
        {
          body: [
            "Intro.",
            {
              runs: ["GB Edited ", { text: "here", bookmark: "_GoBack" }, "."],
            },
            "Outro.",
          ],
        },
      );
      expect(selection).toMatchObject({ role: "rewrite", reasonCode: null });
    });

    it("keeps a paragraph that ends a section context only, and the rest of the body rewritable", async () => {
      const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
        host: flavour,
        sectionBreaks: ["MP1"],
      });
      host.select({ p: "MP1" });
      expect(
        await captureWordSelection("user", 15_000, PARAGRAPHS),
      ).toMatchObject({
        value: { role: "context_only", reasonCode: "special_character" },
      });
      host.select({ p: "PL1" });
      expect(
        await captureWordSelection("user", 15_000, PARAGRAPHS),
      ).toMatchObject({ value: { role: "rewrite", story: "main" } });
    });

    it("reads no OOXML for a shape that is not enabled", async () => {
      const { host, selection } = await capture({
        p: "PL1",
        text: "lima mike",
      });
      expect(selection).toMatchObject({ reasonCode: "shape_not_enabled" });
      expect(host.calls()).not.toContain("Paragraph.getOoxml");
    });
  },
);

describe.each(HOSTS)(
  "captureWordSelection with inline spans enabled on %s",
  (flavour) => {
    const INLINE = new Set<WordSelectionShape>(["paragraph", "inline"]);
    const LONG = `LG1 ${Array.from({ length: 70 }, (_, i) => `term${i}`).join(" ")}.`;
    const document: MockSelectionDocument = {
      body: [
        ...SV2_MAIN_DOCUMENT.body,
        LONG,
        "QV1 Say 'quoted' and ‘quoted’ again.",
        {
          runs: [
            "BN1 Plain ",
            { text: "bold", font: { bold: true } },
            " words then ",
            { text: "red", font: { color: "#C00000" } },
            " end.",
          ],
        },
      ],
    };
    const capture = async (
      target: MockSelectionTarget,
      options: WordSelectionHostOptions = {},
    ) => {
      const host = installWordSelectionHost(document, {
        host: flavour,
        ...options,
      });
      host.select(target);
      const read = await captureWordSelection("user", 15_000, INLINE);
      if (read.status !== "ok") throw new Error("capture failed");
      return { host, selection: read.value };
    };

    it.each([
      ["a unique passage", { p: "PL1", text: "lima mike" }],
      ["a repeated passage", { p: "RP1", text: "Repeated word one.", occ: 1 }],
      ["a passage at the paragraph's start", { p: "PL1", text: "PL1 Plain" }],
      ["a passage at its end", { p: "PL1", text: "papa." }],
      ["a passage right before a bold word", { p: "BN1", text: "Plain " }],
    ] as const)("offers %s for rewriting", async (_, target) => {
      const { selection } = await capture(target);
      expect(selection).toMatchObject({
        role: "rewrite",
        reasonCode: null,
        shape: "inline",
      });
    });

    it("keeps a span next to hidden text in its paragraph context only", async () => {
      const { selection } = await capture({ p: "HT1", text: "after words" });
      expect(selection).toMatchObject({
        role: "context_only",
        shape: "inline",
        reasonCode: "hidden_text",
      });
    });

    it.each([
      ["a link and a field", "MX1", "golf"],
      ["a comment", "CM1", "after comment"],
      ["a footnote reference", "FN1", "continues"],
      ["a picture", "PC1", "after picture"],
      ["a field", "FD1", "after words"],
    ] as const)(
      "offers a span next to %s for rewriting, its paragraph's items kept",
      async (_, p, text) => {
        const { selection } = await capture({ p, text });
        expect(selection).toMatchObject({
          role: "rewrite",
          shape: "inline",
          reasonCode: null,
          selectedText: text,
        });
        expect(selection!.paragraphs[0].kept).toMatchObject({
          text,
          markers: [],
        });
      },
    );

    it("keeps a span next to a red word context only, since the rewrite could take its colour", async () => {
      const { selection } = await capture({ p: "BN1", text: " end." });
      expect(selection).toMatchObject({
        role: "context_only",
        reasonCode: "mixed_formatting",
      });
    });

    it("searches the span at capture and keeps it context only when Find also matches a quote variant", async () => {
      const straight = await capture(
        { p: "QV1", text: "'quoted'" },
        { searchMatchesQuoteVariants: true },
      );
      expect(straight.selection).toMatchObject({
        role: "context_only",
        reasonCode: "position_unknown",
      });
      expect(straight.host.calls()).toContain("Paragraph.search");
      expect(
        (await capture({ p: "QV1", text: "'quoted'" })).selection,
      ).toMatchObject({ role: "rewrite" });
    });

    it("rewrites a span longer than Word's search only on desktop", async () => {
      const { selection } = await capture({
        p: "LG1",
        text: LONG.slice(4, 304),
      });
      expect(selection).toMatchObject(
        flavour === "web"
          ? { role: "context_only", reasonCode: "position_unknown" }
          : { role: "rewrite", shape: "inline" },
      );
    });

    it("writes nothing and builds no range inside a paragraph", async () => {
      const host = installWordSelectionHost(document, { host: flavour });
      const before = host.paragraphs();
      const ooxml = host.ooxml({ p: "MX1" });
      for (const target of [
        { p: "PL1", text: "lima mike" },
        { p: "RP1", text: "Repeated word one.", occ: 1 },
        { p: "MX1", text: "golf" },
        { p: "HT1", text: "after" },
        { p: "LG1", text: LONG.slice(4, 304) },
      ] as const) {
        host.select(target);
        expect(
          await captureWordSelection("user", 15_000, INLINE),
        ).toMatchObject({ status: "ok" });
      }
      expect(host.paragraphs()).toEqual(before);
      expect(host.ooxml({ p: "MX1" })).toBe(ooxml);
      expect(host.writeSyncs()).toEqual([]);
      expect(host.calls().filter((call) => call.endsWith(".expandTo"))).toEqual(
        [],
      );
    });
  },
);

describe.each(HOSTS)(
  "captureWordSelection with every shape enabled on %s",
  (flavour) => {
    const ALL = new Set<WordSelectionShape>([
      "paragraph",
      "inline",
      "multi_paragraph",
      "table_cell",
    ]);
    const LONG = `LG2 ${"y".repeat(300)} end.`;
    const document: MockSelectionDocument = {
      body: [
        ...SV2_MAIN_DOCUMENT.body,
        LONG,
        "NX1 Next paragraph words.",
        "QM1 Before the quote.",
        "'x' then ‘x’ end.",
        {
          table: [
            [
              ["CP1 First cell paragraph.", "CP2 Second cell paragraph."],
              "CQ1 Other cell.",
            ],
          ],
        },
        {
          table: [
            [[{ table: [["NT1 Nested cell text."]] }], "NO1 Outer cell."],
          ],
        },
        "AF1 After the tables.",
      ],
    };
    const capture = async (
      target: MockSelectionTarget,
      options: WordSelectionHostOptions = {},
    ) => {
      const host = installWordSelectionHost(document, {
        host: flavour,
        ...options,
      });
      host.select(target);
      const read = await captureWordSelection("user", 15_000, ALL);
      if (read.status !== "ok") throw new Error("capture failed");
      return { host, selection: read.value };
    };

    it.each([
      [
        "several paragraphs with partial edges",
        {
          p: "MP1",
          text: "victor whiskey.",
          to: { p: "MP3", text: "MP3 Multi" },
        },
        "multi_paragraph",
      ],
      [
        "several whole paragraphs",
        { p: "LI1", to: { p: "LI2" } },
        "multi_paragraph",
      ],
      ["a whole cell", { table: 0, cell: [1, 1] }, "table_cell"],
      ["part of a cell", { p: "CB2", text: "Cell B2" }, "table_cell"],
    ] as const)("offers %s for rewriting", async (_, target, shape) => {
      const { selection } = await capture(target);
      expect(selection).toMatchObject({
        role: "rewrite",
        reasonCode: null,
        shape,
      });
    });

    it("reads a cell's text from its offsets, without desktop's cell mark taken for deleted text", async () => {
      const { host, selection } = await capture({ p: "CB2", text: "Cell B2" });
      expect(selection).toMatchObject({
        role: "rewrite",
        selectedText: "Cell B2",
      });
      expect(selection?.contextBefore).toMatch(/CA2 Cell A2 text\nCB2 $/);
      expect(selection?.contextAfter).toMatch(/^ text\n/);
      expect(host.calls()).not.toContain("Range.getReviewedText");
    });

    it("checks every covered paragraph's OOXML in one sync", async () => {
      const { host, selection } = await capture({
        p: "MP1",
        text: "victor whiskey.",
        to: { p: "MP3", text: "MP3 Multi" },
      });
      expect(selection?.role).toBe("rewrite");
      const reads = host
        .syncLog()
        .filter((entry) => entry.commands.includes("Paragraph.getOoxml"));
      expect(reads).toHaveLength(1);
      expect(
        reads[0].commands.filter((command) => command === "Paragraph.getOoxml"),
      ).toHaveLength(3);
    });

    it.each([
      [
        "a link in its first paragraph",
        { p: "MX1", text: "india.", to: { p: "PL1", text: "PL1 Plain" } },
      ],
      [
        "a footnote reference in its last paragraph",
        {
          p: "CM1",
          text: "after comment.",
          to: { p: "FN1", text: "FN1 Footnote" },
        },
      ],
    ] as const)(
      "offers several paragraphs with %s for rewriting",
      async (_, target) => {
        const { selection } = await capture(target);
        expect(selection).toMatchObject({
          role: "rewrite",
          shape: "multi_paragraph",
          reasonCode: null,
        });
      },
    );

    it("keeps several paragraphs context only when one hides text, though another's field is kept", async () => {
      const { selection } = await capture({
        p: "MP3",
        text: "omega.",
        to: { p: "HT1", text: "HT1 Hidden" },
      });
      expect(selection).toMatchObject({
        role: "context_only",
        shape: "multi_paragraph",
        reasonCode: "hidden_text",
      });
      expect(selection!.selectedText).not.toContain("SECRET");
    });

    it("keeps several paragraphs across a section end context only", async () => {
      const { selection } = await capture(
        {
          p: "MP1",
          text: "victor whiskey.",
          to: { p: "MP3", text: "MP3 Multi" },
        },
        { sectionBreaks: ["MP2"] },
      );
      expect(selection).toMatchObject({
        role: "context_only",
        reasonCode: "special_character",
      });
    });

    it("searches the last paragraph's part too, keeping the span context only when Find also matches a quote variant there", async () => {
      const target = {
        p: "QM1",
        text: "quote.",
        to: { paragraph: 23, text: "'x'" },
      } as const;
      expect(
        (await capture(target, { searchMatchesQuoteVariants: true })).selection,
      ).toMatchObject({ role: "context_only", reasonCode: "position_unknown" });
      expect((await capture(target)).selection).toMatchObject({
        role: "rewrite",
        selectedText: "quote.\n'x'",
      });
    });

    it("rewrites a long partial edge only on desktop", async () => {
      const { selection } = await capture({
        p: "LG2",
        text: "y".repeat(300),
        to: { p: "NX1", text: "NX1 Next" },
      });
      expect(selection).toMatchObject(
        flavour === "web"
          ? { role: "context_only", reasonCode: "position_unknown" }
          : { role: "rewrite", shape: "multi_paragraph" },
      );
    });

    it.each([
      [
        "two paragraphs of one cell",
        { p: "CP1", to: { p: "CP2" } },
        "cell_multi_paragraph",
      ],
      ["a nested table's cell", { p: "NT1" }, "nested_table"],
      [
        "two cells",
        { table: 0, cell: [0, 0], to: { table: 0, cell: [0, 1] } },
        "multi_cell",
      ],
      ["a whole table", { table: 0, tableWhole: true }, "whole_table"],
    ] as const)("keeps %s context only", async (_, target, reasonCode) => {
      const { selection } = await capture(target);
      expect(selection).toMatchObject({ role: "context_only", reasonCode });
    });

    it("offers nothing for body text running into part of a table", async () => {
      const { selection } = await capture({
        p: "PC1",
        to: { table: 0, cell: [0, 0] },
      });
      expect(selection).toBeNull();
    });

    it("keeps 41 paragraphs context only", async () => {
      const host = installWordSelectionHost(
        { body: Array.from({ length: 42 }, (_, i) => `Line ${i}.`) },
        { host: flavour },
      );
      host.select({ paragraph: 0, to: { paragraph: 40 } });
      expect(await captureWordSelection("user", 15_000, ALL)).toMatchObject({
        value: { role: "context_only", reasonCode: "too_many_paragraphs" },
      });
      host.select({ paragraph: 0, to: { paragraph: 39 } });
      expect(await captureWordSelection("user", 15_000, ALL)).toMatchObject({
        value: { role: "rewrite", paragraphCount: 40 },
      });
    });

    it("writes nothing and builds no range inside a paragraph", async () => {
      const host = installWordSelectionHost(document, { host: flavour });
      const before = host.paragraphs();
      const ooxml = [1, 5, 6, 7].map((paragraph) => host.ooxml({ paragraph }));
      for (const target of [
        {
          p: "MP1",
          text: "victor whiskey.",
          to: { p: "MP3", text: "MP3 Multi" },
        },
        { p: "MX1", text: "india.", to: { p: "PL1", text: "PL1 Plain" } },
        { p: "LG2", text: "y".repeat(300), to: { p: "NX1", text: "NX1 Next" } },
        { table: 0, cell: [1, 1] },
        { p: "CB2", text: "Cell B2" },
      ] as const) {
        host.select(target);
        expect(await captureWordSelection("user", 15_000, ALL)).toMatchObject({
          status: "ok",
        });
      }
      expect(host.paragraphs()).toEqual(before);
      expect(
        [1, 5, 6, 7].map((paragraph) => host.ooxml({ paragraph })),
      ).toEqual(ooxml);
      expect(host.writeSyncs()).toEqual([]);
      expect(host.calls().filter((call) => call.endsWith(".expandTo"))).toEqual(
        [],
      );
    });
  },
);
