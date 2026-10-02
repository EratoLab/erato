import { describe, expect, it } from "vitest";

import {
  escapeXml,
  packageXml,
  paragraph,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import {
  realisticSnapshot,
  realisticWordPackageXml,
} from "../../../test/mocks/word/realisticWordFixtures";
import {
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
} from "../wordDocumentPlan";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import {
  ALL_WORD_IN_PLACE_CAPABILITIES,
  wordInPlaceCapabilities,
} from "../wordInPlaceCapabilities";
import {
  WORD_IN_PLACE_FALLBACKS,
  classifyWordInPlacePlan,
  sameWordInPlaceProgram,
} from "../wordInPlacePlan";
import { expandWordTableCellSubmission } from "../wordTableCellSubmission";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordPlanEntry,
} from "../wordDocumentPlan";
import type { WordInPlaceFallback, WordInPlaceOp } from "../wordInPlacePlan";

/** Text and cell rewrites with their mark setters; every structural mechanism off. */
const caps = {
  ...(Object.fromEntries(
    Object.keys(ALL_WORD_IN_PLACE_CAPABILITIES).map((k) => [k, false]),
  ) as typeof ALL_WORD_IN_PLACE_CAPABILITIES),
  text: true,
  cell: true,
  marks: true,
};
const ALL = ALL_WORD_IN_PLACE_CAPABILITIES;
const run = (text: string, rPr = "") =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const p = (content: string, pPr = "") =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
const cells = (rows: string[][]) =>
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows
    .map(
      (row) =>
        `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`,
    )
    .join("")}</w:tbl>`;

/** b1 heading, b2 plain, b3 list item, b4 hyperlink, b5 line break, b6 bookmark, b7 mixed languages,
 * b8 uniform language, b9 centred, b10 table, b11 bold without its complex-script twin, b12 empty,
 * b13 field. */
const BODY = [
  p(run("Title"), '<w:pStyle w:val="Heading1"/>'),
  p(run("Plain text")),
  p(
    run("First item"),
    '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>',
  ),
  p(`<w:hyperlink><w:r><w:t>Linked</w:t></w:r></w:hyperlink>`),
  p(`<w:r><w:t>Line</w:t><w:br/><w:t>break</w:t></w:r>`),
  p(
    `<w:bookmarkStart w:id="1" w:name="Mark"/>${run("Marked")}<w:bookmarkEnd w:id="1"/>`,
  ),
  p(
    run("English ", '<w:lang w:val="en-GB"/>') +
      run("Deutsch", '<w:lang w:val="de-DE"/>'),
  ),
  p(
    run("Uniform ", '<w:lang w:val="en-GB"/>') +
      run("language", '<w:lang w:val="en-GB"/>'),
  ),
  p(run("Centred"), '<w:jc w:val="center"/>'),
  cells([
    ["Region", "Budget"],
    ["North", "42"],
  ]),
  p(run("Plain ") + run("bold", "<w:b/>")),
  p(""),
  p(`<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>`),
].join("");

function snapshot(body = BODY): WordAuthoringSnapshot {
  const s = captureWordAuthoringSnapshot(packageXml(body), "doc", "Off", true);
  s.readToken = "read-proof";
  s.read = new Set(s.blocks.map((b) => b.ref));
  return s;
}

function plan(
  s: WordAuthoringSnapshot,
  replacements: Record<string, WordPlanBlock | WordPlanBlock[]>,
  extra: Partial<WordDocumentPlan> = {},
): WordDocumentPlan {
  return {
    version: 1,
    snapshot: s.token,
    readToken: "read-proof",
    scope: "document",
    deleted: [],
    entries: s.blocks.map((b): WordPlanEntry => {
      const replacement = replacements[b.ref];
      return replacement
        ? {
            kind: "replace",
            source: [b.ref],
            blocks: Array.isArray(replacement) ? replacement : [replacement],
          }
        : { kind: "keep", source: [b.ref] };
    }),
    ...extra,
  };
}

const text = (value: string, extra: Partial<WordPlanBlock> = {}) =>
  ({ id: "new", type: "paragraph", text: value, ...extra }) as WordPlanBlock;
const route = (
  s: WordAuthoringSnapshot,
  p: WordDocumentPlan,
  compiled?: WordAuthoringSnapshot,
) => classifyWordInPlacePlan(p, s, caps, compiled);
const fallbackOf = (s: WordAuthoringSnapshot, p: WordDocumentPlan) => {
  const result = route(s, p);
  return "fallback" in result ? result.fallback : "in-place";
};
const compiledOf = (s: WordAuthoringSnapshot, p: WordDocumentPlan) =>
  captureWordAuthoringSnapshot(
    compileWordDocumentPlan(p, s),
    s.identity,
    "Off",
    true,
    "verify",
  );

describe("in-place classification", () => {
  it("rewrites N sources as M blocks pairwise, deleting or inserting the rest", () => {
    const s = snapshot(
      p(run("One")) + p(run("Two")) + p(run("Three")) + p(run("Tail")),
    );
    const reshape = (blocks: string[]): WordDocumentPlan => ({
      ...plan(s, {}),
      entries: [
        {
          kind: "replace",
          source: ["b1", "b2", "b3"],
          blocks: blocks.map((value, i) => text(value, { id: `r${i}` })),
        },
        { kind: "keep", source: ["b4"] },
      ],
    });
    const kinds = (blocks: string[]) => {
      const result = classifyWordInPlacePlan(reshape(blocks), s, ALL);
      return "fallback" in result
        ? result.fallback
        : result.ops.map((op) => `${op.kind}:${op.ref}`);
    };
    expect(kinds(["First", "Second"])).toEqual([
      "text:b1",
      "text:b2",
      "delete:b3",
    ]);
    expect(kinds(["A", "B", "C", "D"])).toEqual([
      "text:b1",
      "text:b2",
      "text:b3",
      "insert:b3",
    ]);
  });

  it("routes only what Word PC's native probe confirmed: plain rewording and paragraph restyles", () => {
    const s = snapshot();
    const shipped = (p: WordDocumentPlan) => {
      const result = classifyWordInPlacePlan(
        p,
        s,
        wordInPlaceCapabilities("PC"),
      );
      return "fallback" in result ? result.fallback : "in-place";
    };
    const list = s.blocks[2];
    expect(shipped(plan(s, { b2: text("Reworded plainly") }))).toBe("in-place");
    expect(
      shipped(plan(s, { b2: text("Now a heading", { styleRef: "Heading1" }) })),
    ).toBe("in-place");
    // Undoing a mark change needs the complex-script setters (P2, P4).
    expect(
      shipped(
        plan(s, {
          b2: text("Bold start", {
            runs: [{ text: "Bold", bold: true }, { text: " start" }],
          }),
        }),
      ),
    ).toBe("run-format");
    // Word PC drops a list item's numbering when its style is set (P6).
    expect(
      shipped(
        plan(s, {
          b3: {
            id: "l",
            type: "list-item",
            text: list.text,
            list: list.list,
            level: list.level,
            ordered: list.ordered,
            styleRef: "Heading1",
          },
        }),
      ),
    ).toBe("list");
  });

  it("turns paragraph, heading and list-item rewrites with b/i/u marks into text ops", () => {
    const s = snapshot();
    const list = s.blocks[2];
    const p = plan(s, {
      b1: { id: "h", type: "heading", level: 1, text: "New title" },
      b2: text("Bold and plain", {
        runs: [
          { text: "Bold", bold: true },
          { text: " and " },
          { text: "plain", italic: true, underline: true },
        ],
      }),
      b3: {
        id: "l",
        type: "list-item",
        text: "Second take",
        list: list.list,
        level: list.level,
        ordered: list.ordered,
        styleRef: list.styleRef,
      },
      b8: text("Still uniform", {
        runs: [{ text: "Still uniform", language: "en-GB" }],
      }),
    });
    const result = route(s, p, compiledOf(s, p));
    expect(result).toEqual({
      ops: [
        {
          kind: "text",
          ref: "b1",
          paragraph: 0,
          runs: [
            { text: "New title", bold: false, italic: false, underline: false },
          ],
          original: [
            { text: "Title", bold: false, italic: false, underline: false },
          ],
        },
        {
          kind: "text",
          ref: "b2",
          paragraph: 0,
          runs: [
            { text: "Bold", bold: true, italic: false, underline: false },
            { text: " and ", bold: false, italic: false, underline: false },
            { text: "plain", bold: false, italic: true, underline: true },
          ],
          original: [
            {
              text: "Plain text",
              bold: false,
              italic: false,
              underline: false,
            },
          ],
        },
        expect.objectContaining({ kind: "text", ref: "b3" }),
        expect.objectContaining({ kind: "text", ref: "b8" }),
      ],
    });
  });

  it("turns a table_cell expansion into one cell op", () => {
    const s = snapshot();
    const table = s.blocks.find((b) => b.nativeKind === "table")!;
    // As Apply sees it: parsed from the submitted JSON, which derives the table's text.
    const p = normalizeWordDocumentPlan(
      parseWordDocumentPlan(
        JSON.stringify(
          expandWordTableCellSubmission(
            {
              snapshot: s.token,
              readToken: "read-proof",
              table_cell: {
                sourceRef: table.ref,
                rowIndex: 1,
                cellIndex: 1,
                expectedText: "42",
                text: "43",
              },
            },
            s,
          ),
        ),
      )!,
      s,
    );
    expect(route(s, p, compiledOf(s, p))).toEqual({
      ops: [
        {
          kind: "cell",
          ref: table.ref,
          paragraph: 3,
          rowIndex: 1,
          cellIndex: 1,
          text: "43",
          original: "42",
        },
      ],
    });
  });

  it("rejects sources and targets the object model cannot reproduce, each with its code", () => {
    const s = snapshot();
    const cases: [string, WordPlanBlock, WordInPlaceFallback][] = [
      ["b4", text("Linked again"), "source-shape"],
      ["b5", text("Line break gone"), "source-shape"],
      ["b6", text("Marked again"), "native-target"],
      ["b7", text("Mixed again"), "source-shape"],
      ["b8", text("No language"), "run-format"],
      ["b9", text("Not centred"), "format"],
      ["b2", text("Now a quote", { styleRef: "Heading1" }), "restyle"],
      ["b2", text(""), "empty-text"],
      ["b12", text("Was empty"), "empty-text"],
      ["b11", text("Plain bold"), "not-invertible"],
      ["b13", text("2"), "native-target"],
      ["b2", text("Two\nlines"), "source-shape"],
    ];
    for (const [ref, block, code] of cases)
      expect(
        fallbackOf(s, plan(s, { [ref]: block })),
        `${ref} ${block.text}`,
      ).toBe(code);
    const realistic = realisticSnapshot(realisticWordPackageXml());
    const commented = realistic.blocks.find(
      (b) => b.nativeKind === "anchored-content",
    )!;
    expect(
      fallbackOf(
        realistic,
        plan(realistic, { [commented.ref]: text("Commented again") }),
      ),
    ).toBe("native-target");
  });

  it("produces every fallback code M2 can reach from a minimal plan, in ladder order", () => {
    const s = snapshot();
    const list = s.blocks[2];
    const refs = s.blocks.map((b) => b.ref);
    const keepAll = plan(s, {});
    const many = snapshot(
      Array.from({ length: 51 }, (_, i) => paragraph(`Paragraph ${i}`)).join(
        "",
      ),
    );
    const reached: Record<string, WordInPlaceFallback | "in-place"> = {
      stories: fallbackOf(s, {
        ...keepAll,
        stories: [
          {
            kind: "upsert",
            type: "header",
            id: "header",
            blocks: [text("Header")],
          },
        ],
      }),
      sections: fallbackOf(s, {
        ...keepAll,
        sections: [{ id: "final", source: "section-1" }],
      }),
      moved: fallbackOf(s, {
        ...keepAll,
        entries: [
          { kind: "keep", source: [refs[1]] },
          { kind: "keep", source: [refs[0]] },
          { kind: "keep", source: refs.slice(2) },
        ],
      }),
      insert: fallbackOf(s, {
        ...keepAll,
        entries: [
          { kind: "keep", source: refs },
          { kind: "insert", blocks: [text("Appended")] },
        ],
      }),
      delete: fallbackOf(s, {
        ...keepAll,
        entries: [{ kind: "keep", source: refs.slice(1) }],
        deleted: [{ source: [refs[0]], reason: "Duplicate" }],
      }),
      split: fallbackOf(
        s,
        plan(s, { b2: [text("One"), { ...text("Two"), id: "two" }] }),
      ),
      restyle: fallbackOf(
        s,
        plan(s, {
          b2: { id: "h", type: "heading", level: 2, text: "Promoted" },
        }),
      ),
      list: fallbackOf(
        s,
        plan(s, {
          b3: {
            id: "l",
            type: "list-item",
            text: "Indented",
            list: list.list,
            level: 1,
            ordered: list.ordered,
            styleRef: list.styleRef,
          },
        }),
      ),
      "native-target": fallbackOf(s, plan(s, { b10: text("No table") })),
      "rich-block": fallbackOf(
        s,
        plan(s, {
          b2: {
            id: "t",
            type: "table",
            text: "",
            rows: [{ cells: [{ blocks: [text("Cell")] }] }],
          },
        }),
      ),
      "new-list": fallbackOf(
        s,
        plan(s, {
          b3: {
            id: "l",
            type: "list-item",
            text: "Fresh list",
            list: "fresh",
            ordered: true,
            styleRef: list.styleRef,
          },
        }),
      ),
      format: fallbackOf(
        s,
        plan(s, { b2: text("Centred", { format: { alignment: "center" } }) }),
      ),
      "run-format": fallbackOf(
        s,
        plan(s, {
          b2: text("Bigger", { runs: [{ text: "Bigger", fontSize: 14 }] }),
        }),
      ),
      "script-text": fallbackOf(s, plan(s, { b2: text("Tokyo 東京") })),
      "source-shape": fallbackOf(s, plan(s, { b4: text("Unlinked") })),
      "empty-text": fallbackOf(s, plan(s, { b2: text("") })),
      "not-invertible": fallbackOf(s, plan(s, { b11: text("Plain") })),
      "program-mismatch": (() => {
        const result = route(
          s,
          plan(s, { b2: text("Changed") }),
          compiledOf(s, plan(s, { b2: text("Different") })),
        );
        return "fallback" in result ? result.fallback : "in-place";
      })(),
      "too-many-ops": fallbackOf(
        many,
        plan(
          many,
          Object.fromEntries(
            many.blocks.map((b, i) => [
              b.ref,
              { ...text(`New ${i}`), id: `n${i}` },
            ]),
          ),
        ),
      ),
    };
    for (const [code, actual] of Object.entries(reached))
      expect(actual, code).toBe(code);
    // Only reachable once the structural mechanisms are on (see below), or reserved for stories.
    expect(
      WORD_IN_PLACE_FALLBACKS.filter((code) => !(code in reached)),
    ).toEqual(["story-text", "inherited-format", "boundary"]);
    expect(
      fallbackOf(s, {
        ...plan(s, { b2: text("Two\nlines") }),
        sections: [{ id: "final", source: "section-1" }],
      }),
    ).toBe("sections");
  });

  it("writes East Asian text and emoji in place only where the host writes them exactly, either way", () => {
    const withScript = { ...caps, scriptText: true };
    const of = (s: WordAuthoringSnapshot, p: WordDocumentPlan, c = caps) => {
      const result = classifyWordInPlacePlan(p, s, c);
      return "fallback" in result ? result.fallback : "in-place";
    };
    const s = snapshot();
    for (const value of ["Tokyo 東京", "Done 😀", "서울", "Ｆｕｌｌ"])
      expect(of(s, plan(s, { b2: text(value) })), value).toBe("script-text");
    expect(of(s, plan(s, { b2: text("Tokyo 東京") }), withScript)).toBe(
      "in-place",
    );
    // Latin, Greek, Cyrillic and Arabic text, dashes and ©: Word PC writes them as one plain run.
    expect(
      of(s, plan(s, { b2: text("München — café © αβγ Привет مرحبا") })),
    ).toBe("in-place");
    // Restore writes the original back, so an original in those scripts counts too.
    const eastern = snapshot(p(run("東京の天気")) + p(run("Closing")));
    expect(
      of(eastern, plan(eastern, { [eastern.blocks[0].ref]: text("Weather") })),
    ).toBe("script-text");
  });

  it("admits structural edits only when the object model can reproduce and undo them", () => {
    const s = snapshot();
    const refs = s.blocks.map((b) => b.ref);
    const all = (p: WordDocumentPlan, from = s) => {
      const result = classifyWordInPlacePlan(p, from, ALL);
      return "fallback" in result ? result.fallback : result.ops;
    };
    const insertAfter = (ref: string, from = s) =>
      ({
        ...plan(from, {}),
        entries: from.blocks.flatMap((b): WordPlanEntry[] => [
          { kind: "keep", source: [b.ref] },
          ...(b.ref === ref
            ? [{ kind: "insert" as const, blocks: [text("Inserted")] }]
            : []),
        ]),
      }) as WordDocumentPlan;
    const without = (ref: string, from = s): WordDocumentPlan => ({
      ...plan(from, {}),
      entries: from.blocks
        .filter((b) => b.ref !== ref)
        .map((b) => ({ kind: "keep", source: [b.ref] })),
      deleted: [{ source: [ref], reason: "Requested" }],
    });
    expect(all(insertAfter("b2"))).toEqual([
      expect.objectContaining({
        kind: "insert",
        ref: "b2",
        location: "After",
        state: { type: "paragraph", style: { builtIn: "Normal" } },
      }),
    ]);
    // A centred anchor would hand its alignment to the new paragraph.
    expect(all(insertAfter("b9"))).toBe("inherited-format");
    // After a table the new paragraph goes before the next paragraph instead.
    expect(all(insertAfter("b10"))).toEqual([
      expect.objectContaining({
        kind: "insert",
        ref: "b11",
        location: "Before",
      }),
    ]);
    expect(
      all({
        ...plan(s, {}),
        entries: [
          { kind: "insert", blocks: [text("First")] },
          ...refs.map((ref) => ({ kind: "keep" as const, source: [ref] })),
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "insert",
        ref: "b1",
        location: "Before",
      }),
    ]);
    expect(all(without("b2"))).toEqual([
      expect.objectContaining({
        kind: "delete",
        ref: "b2",
        recreate: "After",
        original: [
          { text: "Plain text", bold: false, italic: false, underline: false },
        ],
      }),
    ]);
    // Re-creating them would lose the alignment, the language or the bold twin.
    expect(all(without("b9"))).toBe("not-invertible");
    expect(all(without("b8"))).toBe("not-invertible");
    expect(all(without("b11"))).toBe("not-invertible");
    expect(all(without("b6"))).toBe("native-target");
    // The only item of its list could not rejoin it.
    expect(all(without("b3"))).toBe("not-invertible");
    expect(
      all(plan(s, { b9: text("Heading now", { styleRef: "Heading1" }) })),
    ).toBe("format");
    expect(
      all(
        plan(s, {
          b9: {
            id: "h",
            type: "heading",
            level: 1,
            text: "Centred heading",
            format: { alignment: "center" },
          },
        }),
      ),
    ).toBe("inherited-format");
    const tables = snapshot(
      paragraph("Before") +
        cells([["a", "b"]]) +
        paragraph("Between") +
        cells([["c", "d"]]) +
        paragraph("Last"),
    );
    expect(all(without("b3", tables), tables)).toBe("boundary");
    expect(all(without("b5", tables), tables)).toBe("boundary");
    const merged = plan(s, { b1: [text("Merged")] });
    merged.entries.splice(0, 2, {
      kind: "replace",
      source: ["b1", "b2"],
      blocks: [{ id: "m", type: "heading", level: 1, text: "Merged" }],
    });
    expect(all(merged)).toEqual([
      expect.objectContaining({ kind: "text", ref: "b1" }),
      expect.objectContaining({ kind: "delete", ref: "b2", recreate: "After" }),
    ]);
    for (const code of [
      "insert",
      "delete",
      "split",
      "restyle",
      "list",
    ] as const)
      expect(
        fallbackOf(
          s,
          {
            insert: insertAfter("b2"),
            delete: without("b2"),
            split: plan(s, { b2: [text("One"), { ...text("Two"), id: "t" }] }),
            restyle: plan(s, {
              b2: { id: "h", type: "heading", level: 2, text: "Promoted" },
            }),
            list: plan(s, {
              b3: text("First item", { styleRef: "ListParagraph" }),
            }),
          }[code],
        ),
        code,
      ).toBe(code);
  });

  it("admits a structural edit only when the mechanism that undoes it is enabled too", () => {
    const styles = (body: string) => {
      const s = captureWordAuthoringSnapshot(
        packageXml(body).replace(
          "</w:styles>",
          '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style></w:styles>',
        ),
        "doc",
        "Off",
        true,
      );
      s.readToken = "read-proof";
      s.read = new Set(s.blocks.map((b) => b.ref));
      return s;
    };
    const item = (value: string) =>
      p(
        run(value),
        '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>',
      );
    const s = styles(
      paragraph("Before") +
        paragraph("Target") +
        item("One") +
        item("Two") +
        paragraph("Tail"),
    );
    const refs = s.blocks.map((b) => b.ref);
    const keep = (ref: string): WordPlanEntry => ({
      kind: "keep",
      source: [ref],
    });
    const inserted: WordDocumentPlan = {
      ...plan(s, {}),
      entries: [
        keep("b1"),
        keep("b2"),
        { kind: "insert", blocks: [text("Inserted")] },
        ...refs.slice(2).map(keep),
      ],
    };
    const without = (ref: string): WordDocumentPlan => ({
      ...plan(s, {}),
      entries: refs.filter((r) => r !== ref).map(keep),
      deleted: [{ source: [ref], reason: "Requested" }],
    });
    const routed = (
      p: WordDocumentPlan,
      change: Partial<typeof ALL>,
    ): WordInPlaceFallback | "in-place" => {
      const result = classifyWordInPlacePlan(p, s, { ...ALL, ...change });
      return "fallback" in result ? result.fallback : "in-place";
    };
    expect(routed(inserted, {})).toBe("in-place");
    expect(routed(inserted, { delete: false })).toBe("not-invertible");
    expect(routed(inserted, { restyle: false })).toBe("restyle");
    expect(routed(without("b2"), {})).toBe("in-place");
    expect(routed(without("b2"), { insert: false })).toBe("not-invertible");
    expect(routed(without("b2"), { restyle: false })).toBe("not-invertible");
    expect(routed(without("b3"), {})).toBe("in-place");
    expect(routed(without("b3"), { list: false })).toBe("not-invertible");
    // Undo re-attaches the item, and attaching gives it List Paragraph instead of its own style (P6).
    const unstyled = styles(
      paragraph("Before") +
        paragraph("Target") +
        item("One").replace('<w:pStyle w:val="ListParagraph"/>', "") +
        item("Two").replace('<w:pStyle w:val="ListParagraph"/>', "") +
        paragraph("Tail"),
    );
    const result = classifyWordInPlacePlan(
      {
        ...plan(unstyled, {}),
        entries: unstyled.blocks
          .filter((b) => b.ref !== "b3")
          .map((b) => keep(b.ref)),
        deleted: [{ source: ["b3"], reason: "Requested" }],
      },
      unstyled,
      ALL,
    );
    expect("fallback" in result && result.fallback).toBe("not-invertible");
  });

  it("anchors nothing after the final paragraph, which Word keeps", () => {
    const s = readySnapshot(packageXml(paragraph("First") + paragraph("Last")));
    const after = (ref: string): WordDocumentPlan => ({
      ...plan(s, {}),
      entries: s.blocks.flatMap((b): WordPlanEntry[] => [
        { kind: "keep", source: [b.ref] },
        ...(b.ref === ref
          ? [{ kind: "insert" as const, blocks: [text("Added")] }]
          : []),
      ]),
    });
    const classify = (p: WordDocumentPlan) => {
      const result = classifyWordInPlacePlan(p, s, ALL);
      return "fallback" in result ? result.fallback : result.ops;
    };
    expect(classify(after("b1"))).toEqual([
      expect.objectContaining({ kind: "insert", ref: "b1", location: "After" }),
    ]);
    expect(classify(after("b2"))).toBe("boundary");
    expect(
      classify(
        plan(s, { b2: [text("Last"), { ...text("Added"), id: "added" }] }),
      ),
    ).toBe("boundary");
  });

  it("sets a style by name only when it is a custom style", () => {
    const s = captureWordAuthoringSnapshot(
      packageXml(
        paragraph("Before") + paragraph("Target") + paragraph("Tail"),
      ).replace(
        "</w:styles>",
        '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="Callout"><w:name w:val="Callout Text"/></w:style></w:styles>',
      ),
      "doc",
      "Off",
      true,
    );
    s.readToken = "read-proof";
    s.read = new Set(s.blocks.map((b) => b.ref));
    const restyled = (styleRef: string) => {
      const result = classifyWordInPlacePlan(
        plan(s, { b2: text("Target", { styleRef }) }),
        s,
        ALL,
      );
      if ("fallback" in result) return result.fallback;
      const [op] = result.ops as Extract<WordInPlaceOp, { kind: "text" }>[];
      return op.restyle?.to.style;
    };
    expect(restyled("Header")).toEqual({ builtIn: "Header" });
    expect(restyled("Callout")).toEqual({ name: "Callout Text" });
    // A built-in style Paragraph.styleBuiltIn cannot name goes by a localized name the package lacks.
    expect(restyled("ListBullet")).toBe("restyle");
  });

  it("routes a disabled mechanism to the import", () => {
    const s = snapshot();
    expect(
      classifyWordInPlacePlan(plan(s, { b2: text("Changed") }), s, {
        ...caps,
        text: false,
      }),
    ).toEqual({ fallback: "not-invertible" });
  });
});

describe("in-place program equivalence", () => {
  it("detects a tampered op list and an import result that disagrees", () => {
    const s = snapshot();
    const p = plan(s, { b2: text("Changed") });
    const result = route(s, p);
    if (!("ops" in result)) throw new Error("expected ops");
    expect(sameWordInPlaceProgram(p, s, result.ops)).toBe(true);
    const [op] = result.ops as Extract<WordInPlaceOp, { kind: "text" }>[];
    const tampered: WordInPlaceOp[][] = [
      [{ ...op, runs: [{ ...op.runs[0], text: "Something else" }] }],
      [{ ...op, runs: [{ ...op.runs[0], bold: true }] }],
      [{ ...op, ref: "b9" }],
      [op, { ...op, ref: "b8" }],
      [],
    ];
    for (const ops of tampered)
      expect(sameWordInPlaceProgram(p, s, ops)).toBe(false);
    const other = compiledOf(s, plan(s, { b2: text("Different") }));
    expect(route(s, p, other)).toEqual({ fallback: "program-mismatch" });
  });

  it("matches wordPlanOutput for every eligible scoped edit and names the rule for the rest", async () => {
    const context = {
      chatId: "chat",
      messageId: "message",
      toolCallId: "read",
    };
    const scoped = async (
      s: WordAuthoringSnapshot,
      target: Record<string, unknown>,
      scoped_edit: Record<string, unknown>,
    ) => {
      const session = new WordDocumentReadSession();
      session.activate(s, context);
      const read = await session.execute(
        {
          snapshot: s.token,
          documentIdentity: s.identity,
          target,
        },
        context,
      );
      if (!read.ok) throw new Error(read.error);
      const result = await createWordDocumentSubmissionExecutor(session)(
        {
          snapshot: s.token,
          readToken: (read.result as { readToken: string }).readToken,
          scoped_edit,
        },
        { ...context, toolCallId: "edit" },
      );
      if (!result.ok) throw new Error(JSON.stringify(result));
      return (result.result as { plan: WordDocumentPlan }).plan;
    };
    const fresh = () =>
      readySnapshot(
        packageXml(
          paragraph("Before") +
            p(run("Heading"), '<w:pStyle w:val="Heading1"/>') +
            paragraph("Target") +
            paragraph("After") +
            paragraph("Tail"),
        ),
      );
    // Expected route with the probe-confirmed mechanisms (text and cell), then with all of them.
    const cases: [
      Record<string, unknown>,
      Record<string, unknown>,
      WordInPlaceFallback | "in-place",
      WordInPlaceFallback | "in-place",
    ][] = [
      [
        { kind: "paragraph", text: "Target" },
        {
          body: [
            {
              operation: "replace",
              source: ["b3"],
              blocks: [
                text("Changed", {
                  runs: [{ text: "Chan" }, { text: "ged", bold: true }],
                }),
              ],
            },
          ],
        },
        "in-place",
        "in-place",
      ],
      [
        { ref: "b2" },
        {
          body: [
            {
              operation: "replace",
              source: ["b2"],
              blocks: [{ id: "h", type: "heading", level: 1, text: "Renamed" }],
            },
          ],
        },
        "in-place",
        "in-place",
      ],
      [
        { ref: "b2" },
        {
          body: [
            {
              operation: "replace",
              source: ["b2"],
              blocks: [{ id: "h", type: "heading", level: 2, text: "Demoted" }],
            },
          ],
        },
        "restyle",
        "in-place",
      ],
      [
        { ref: "b3" },
        {
          body: [
            {
              operation: "delete",
              source: ["b3"],
              reason: "Obsolete",
            },
          ],
        },
        "delete",
        "in-place",
      ],
      [
        { ref: "b3" },
        {
          body: [
            {
              operation: "insert-after",
              anchor: "b3",
              blocks: [text("Added")],
            },
          ],
        },
        "insert",
        "in-place",
      ],
      [
        { ref: "b3" },
        {
          body: [
            {
              operation: "insert-before",
              anchor: "b3",
              blocks: [text("Added before")],
            },
          ],
        },
        "insert",
        "in-place",
      ],
      [
        { ref: "b3" },
        {
          body: [
            {
              operation: "replace",
              source: ["b3"],
              blocks: [text("One"), { ...text("Two"), id: "two" }],
            },
          ],
        },
        "split",
        "in-place",
      ],
      [
        { refs: ["b4", "b1"] },
        {
          body: [{ operation: "move-before", source: ["b4"], anchor: "b1" }],
        },
        "moved",
        "moved",
      ],
      [
        { refs: ["b1", "b4"] },
        {
          body: [{ operation: "move-after", source: ["b1"], anchor: "b4" }],
        },
        "moved",
        "moved",
      ],
      [
        { ref: "b3", throughRef: "b4" },
        {
          body: [
            {
              operation: "replace",
              source: ["b3", "b4"],
              blocks: [text("Merged")],
            },
          ],
        },
        "split",
        "in-place",
      ],
    ];
    for (const [target, edit, expected, expectedAll] of cases) {
      const s = fresh();
      const p = await scoped(s, target, edit);
      const compiled = compiledOf(s, p);
      for (const [capabilities, want] of [
        [caps, expected],
        [ALL, expectedAll],
      ] as const) {
        const result = classifyWordInPlacePlan(p, s, capabilities, compiled);
        expect(
          "fallback" in result ? result.fallback : "in-place",
          JSON.stringify(edit),
        ).toBe(want);
        if ("ops" in result)
          expect(sameWordInPlaceProgram(p, s, result.ops)).toBe(true);
      }
    }
  });
});
