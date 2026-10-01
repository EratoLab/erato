import { describe, expect, it } from "vitest";

import {
  examplePlan,
  packageXml,
  paragraph,
  readySnapshot,
  sixParagraphXml,
} from "../../../test/mocks/word/authoringFixtures";
import {
  buildWordPlanReview,
  createWordListNumbering,
  wordEditBatchSize,
  wordLength,
} from "../wordPlanReview";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordPlanEntry,
} from "../wordDocumentPlan";
import type { WordPlanRowOf } from "../wordPlanReview";

const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cells = (rows: string[][]) =>
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  rows
    .map(
      (row) =>
        "<w:tr>" +
        row.map((c) => `<w:tc><w:tcPr/>${paragraph(c)}</w:tc>`).join("") +
        "</w:tr>",
    )
    .join("") +
  "</w:tbl>";
const TABLE = cells([
  ["Team", "Hours"],
  ["East", "18"],
  ["West", "18"],
]);
const plan = (
  snapshot: WordAuthoringSnapshot,
  entries: WordPlanEntry[],
  extra: Partial<WordDocumentPlan> = {},
): WordDocumentPlan => ({
  version: 1,
  snapshot: snapshot.token,
  readToken: "read-proof",
  scope: "body",
  entries,
  deleted: [],
  ...extra,
});
const keepAll = (snapshot: WordAuthoringSnapshot, except: string[] = []) =>
  snapshot.blocks
    .filter((b) => !except.includes(b.ref))
    .map<WordPlanEntry>((b) => ({ kind: "keep", source: [b.ref] }));
const para = (id: string, text: string): WordPlanBlock => ({
  id,
  type: "paragraph",
  text,
});
function chapters(count: number) {
  return readySnapshot(
    packageXml(
      Array.from(
        { length: count },
        (_, i) => heading(`Chapter ${i + 1}`) + paragraph(`Body ${i + 1}`),
      ).join(""),
    ),
  );
}
function withParts(snapshot: WordAuthoringSnapshot) {
  snapshot.fullDocument = true;
  snapshot.stories = [
    {
      id: "f1",
      type: "footer",
      text: "Draft footer",
      xml: "",
      part: "/word/footer1.xml",
    },
  ];
  snapshot.sections = [
    {
      id: "s1",
      layout: {
        orientation: "portrait",
        width: 595.3,
        height: 841.9,
        margins: { top: 72, left: 72 },
      },
      headers: {},
      footers: { default: "f1" },
      xml: "",
    },
  ];
  return snapshot;
}

describe("buildWordPlanReview", () => {
  it("shows a table-cell text edit as one changed cell with the new text", () => {
    const snapshot = readySnapshot(
      packageXml(paragraph("Allocation") + TABLE + paragraph("After")),
    );
    const table = snapshot.blocks[1];
    expect(table.nativeKind).toBe("table");
    const review = buildWordPlanReview(
      plan(snapshot, [
        { kind: "keep", source: ["b1"] },
        {
          kind: "replace",
          source: [table.ref],
          blocks: [
            {
              id: "cell-edit-table",
              type: "table",
              text: "",
              sourceRef: table.ref,
              rows: table.content!.rows.map((r) => ({
                sourceIndex: r.sourceIndex,
                cells: r.cells.map((c) => ({
                  sourceIndex: c.sourceIndex,
                  ...(r.sourceIndex === 2 && c.sourceIndex === 1
                    ? { textEdit: { expectedText: "18", text: "21" } }
                    : {}),
                })),
              })),
            },
          ],
        },
        { kind: "keep", source: ["b3"] },
      ]),
      snapshot,
    );
    expect(review.size).toBe("small");
    expect(review.variant).toBeUndefined();
    expect(review.title).toEqual({ kind: "cells", n: 1 });
    expect(review.risks).toEqual([]);
    const row = review.rows.find(
      (r) => r.family === "table",
    ) as WordPlanRowOf<"table">;
    expect(row).toMatchObject({
      status: "changed",
      rows: 3,
      cols: 2,
      sameShape: true,
      rowsAdded: 0,
      rowsRemoved: 0,
      headerRow: ["Team", "Hours"],
      changedRowIndexes: [2],
      locateRef: table.ref,
    });
    expect(row.changedCells).toEqual([
      { row: 2, col: 1, before: "18", after: "21" },
    ]);
    expect(review.rows.filter((r) => r.family === "unchanged")).toHaveLength(2);
  });

  it("classifies two inserted paragraphs as a small addition", () => {
    const snapshot = readySnapshot();
    const review = buildWordPlanReview(
      plan(snapshot, [
        ...keepAll(snapshot),
        {
          kind: "insert",
          contextRefs: ["b6"],
          blocks: [para("n1", "First"), para("n2", "Second")],
        },
      ]),
      snapshot,
    );
    expect(review).toMatchObject({
      size: "small",
      variant: "addition",
      title: { kind: "paragraphs-added", n: 2 },
      scope: { wholeFile: false, unchanged: ["layout"] },
    });
    expect(
      review.rows.filter((r) => r.family === "text").map((r) => r.status),
    ).toEqual(["new", "new"]);
  });

  it("groups six changed of thirteen chapters plus the footer as large", () => {
    const snapshot = withParts(chapters(13));
    const bodies = snapshot.blocks.filter((b) => b.type === "paragraph");
    const rewritten = new Set(bodies.slice(0, 6).map((b) => b.ref));
    const review = buildWordPlanReview(
      plan(
        snapshot,
        snapshot.blocks.map<WordPlanEntry>((b) =>
          rewritten.has(b.ref)
            ? {
                kind: "replace",
                source: [b.ref],
                blocks: [para(`n-${b.ref}`, `New ${b.text}`)],
              }
            : { kind: "keep", source: [b.ref] },
        ),
        {
          scope: "document",
          stories: [
            {
              kind: "upsert",
              type: "footer",
              id: "f1",
              blocks: [para("footer", "Final footer")],
            },
          ],
        },
      ),
      snapshot,
    );
    expect(review.size).toBe("large");
    expect(review.title).toEqual({
      kind: "sections",
      changed: 6,
      total: 13,
      added: 0,
      parts: ["footer"],
      layout: false,
    });
    expect(review.groups).toHaveLength(13);
    expect(review.groups[0]).toMatchObject({
      heading: { text: "Chapter 1" },
      status: "changed",
      summary: { text: 1 },
    });
    expect(review.groups[12].status).toBe("unchanged");
    expect(review.risks.map((r) => r.kind)).toEqual(["parts-changed"]);
    expect(review.risks[0].rowKey).toBe("story:f1");
    expect(review.partsRows).toEqual([
      expect.objectContaining({
        family: "part",
        status: "changed",
        storyType: "footer",
        bindings: ["default"],
        before: "Draft footer",
        after: "Final footer",
      }),
    ]);
    expect(review.scope).toEqual({ wholeFile: true, unchanged: ["layout"] });
  });

  it("treats a summary replacing several chapters as restructured", () => {
    const snapshot = chapters(3);
    const review = buildWordPlanReview(
      plan(snapshot, [
        {
          kind: "replace",
          source: snapshot.blocks.map((b) => b.ref),
          blocks: [para("summary", "In short: three chapters.")],
        },
      ]),
      snapshot,
    );
    expect(review.variant).toBe("restructured");
    expect(review.title).toEqual({ kind: "summary" });
    expect(review.size).toBe("large");
    expect(review.risks.find((r) => r.kind === "headings-lost")?.count).toBe(3);
  });

  it("flags a deleted native table as a large removal", () => {
    const snapshot = readySnapshot(
      packageXml(paragraph("Intro") + TABLE + paragraph("After")),
    );
    const review = buildWordPlanReview(
      plan(snapshot, keepAll(snapshot, ["b2"]), {
        deleted: [{ source: ["b2"], reason: "Obsolete." }],
      }),
      snapshot,
    );
    expect(review.size).toBe("large");
    expect(review.title).toEqual({ kind: "removed", n: 1 });
    expect(review.risks).toEqual([
      {
        kind: "natives-removed",
        count: 1,
        rowKey: "deleted:b2",
        items: [{ rowKey: "deleted:b2", objectKind: "table" }],
      },
    ]);
    expect(review.rows.find((r) => r.key === "deleted:b2")).toMatchObject({
      family: "table",
      status: "removed",
      rows: 3,
      cols: 2,
      rowsRemoved: 3,
    });
  });

  it("reports a heading that the plan turns into body text", () => {
    const snapshot = readySnapshot(
      packageXml(
        heading("Scope") +
          paragraph("One") +
          heading("Risks") +
          paragraph("Two"),
      ),
    );
    const review = buildWordPlanReview(
      plan(snapshot, [
        { kind: "keep", source: ["b1", "b2"] },
        { kind: "replace", source: ["b3"], blocks: [para("n1", "Risks")] },
        { kind: "keep", source: ["b4"] },
      ]),
      snapshot,
    );
    expect(review.risks).toEqual([
      {
        kind: "headings-lost",
        count: 1,
        rowKey: "output:n1",
        items: [{ rowKey: "output:n1", text: "Risks" }],
      },
    ]);
    expect(review.variant).toBeUndefined();
    expect(review.rows.find((r) => r.key === "output:n1")).toMatchObject({
      family: "text",
      status: "changed",
      before: "Risks",
      beforeLevel: 1,
    });
  });

  it("lists only changed layout properties with their previous values", () => {
    const snapshot = withParts(readySnapshot());
    const review = buildWordPlanReview(
      plan(snapshot, keepAll(snapshot), {
        scope: "document",
        sections: [
          {
            id: "n1",
            source: "s1",
            layout: {
              orientation: "landscape",
              width: 841.9,
              height: 595.3,
              margins: { top: 72 },
            },
            footers: { default: "f1" },
          },
        ],
      }),
      snapshot,
    );
    expect(review.variant).toBe("layout");
    expect(review.size).toBe("medium");
    expect(review.title).toEqual({ kind: "layout", sections: 1, parts: [] });
    expect(review.partsRows).toEqual([
      {
        key: "section:n1",
        family: "layout",
        status: "changed",
        sectionId: "n1",
        beforeAvailable: true,
        locateRef: undefined,
        changes: [
          {
            property: "orientation",
            length: false,
            before: "portrait",
            after: "landscape",
          },
          { property: "width", length: true, before: 595.3, after: 841.9 },
          { property: "height", length: true, before: 841.9, after: 595.3 },
        ],
      },
    ]);
    expect(review.risks.map((r) => r.kind)).toEqual(["layout-changed"]);
    expect(review.scope.unchanged).toEqual(["footers"]);
  });

  it("shows only new values for a section without a captured source", () => {
    const snapshot = withParts(readySnapshot());
    const review = buildWordPlanReview(
      plan(snapshot, keepAll(snapshot), {
        scope: "document",
        sections: [
          { id: "n1", source: "s1", after: "b3" },
          { id: "n2", layout: { columns: 2, columnSpacing: 36 } },
        ],
      }),
      snapshot,
    );
    expect(review.partsRows).toEqual([
      expect.objectContaining({
        key: "section:n1",
        changes: [
          {
            property: "boundary",
            length: false,
            before: false,
            after: "Two regions.",
          },
        ],
      }),
      expect.objectContaining({
        key: "section:n2",
        status: "new",
        beforeAvailable: false,
        changes: [
          { property: "columns", length: false, after: 2 },
          { property: "columnSpacing", length: true, after: 36 },
        ],
      }),
    ]);
  });

  it("reports removed sections", () => {
    const snapshot = withParts(readySnapshot());
    snapshot.sections!.push({
      id: "s2",
      layout: {},
      headers: {},
      footers: {},
      xml: "",
    });
    const review = buildWordPlanReview(
      plan(snapshot, keepAll(snapshot), {
        scope: "document",
        sections: [{ id: "n1", source: "s2" }],
      }),
      snapshot,
    );
    expect(review.risks).toEqual([
      expect.objectContaining({
        kind: "sections-removed",
        count: 1,
        rowKey: "section-removed:s1",
      }),
    ]);
  });

  it("builds a plan-only review without a snapshot", () => {
    const review = buildWordPlanReview(examplePlan("saved"), undefined);
    expect(review.riskUnknown).toBe(true);
    expect(review.risks).toEqual([]);
    expect(review.size).toBe("medium");
    expect(review.variant).toBeUndefined();
    expect(review.title).toMatchObject({ kind: "blocks-changed", n: 5 });
    expect(review.groups).toHaveLength(1);
    expect(review.rows.map((r) => [r.key, r.family, r.status])).toEqual([
      ["output:n1", "text", "new"],
      ["output:n2", "text", "changed"],
      ["keep:b1", "unchanged", "unchanged"],
      ["output:n3", "text", "changed"],
      ["output:n4", "text", "changed"],
      ["keep:b6", "unchanged", "unchanged"],
      ["deleted:b3", "text", "removed"],
    ]);
    expect(review.scope).toEqual({
      wholeFile: false,
      unchanged: ["layout"],
    });
  });

  it("keeps a large inserted table at medium size", () => {
    const snapshot = readySnapshot();
    const review = buildWordPlanReview(
      plan(snapshot, [
        ...keepAll(snapshot),
        {
          kind: "insert",
          contextRefs: ["b6"],
          blocks: [
            {
              id: "t1",
              type: "table",
              text: "",
              rows: Array.from({ length: 12 }, (_, r) => ({
                cells: [
                  { blocks: [para(`a${r}`, `Row ${r}`)] },
                  { blocks: [para(`b${r}`, String(r))] },
                ],
              })),
            },
          ],
        },
      ]),
      snapshot,
    );
    expect(review.size).toBe("medium");
    expect(review.variant).toBe("addition");
    expect(review.title).toEqual({ kind: "blocks-added", n: 1 });
    expect(review.rows.find((r) => r.key === "output:t1")).toMatchObject({
      family: "table",
      status: "new",
      rows: 12,
      cols: 2,
      sameShape: false,
      headerRow: ["Row 0", "0"],
    });
  });

  it("starts a new group for an inserted heading", () => {
    const snapshot = chapters(2);
    const review = buildWordPlanReview(
      plan(snapshot, [
        ...keepAll(snapshot),
        {
          kind: "insert",
          contextRefs: ["b4"],
          blocks: [
            { id: "h", type: "heading", level: 1, text: "Chapter 3" },
            para("p", "Body 3"),
          ],
        },
      ]),
      snapshot,
    );
    expect(review.groups.map((g) => [g.heading?.text, g.status])).toEqual([
      ["Chapter 1", "unchanged"],
      ["Chapter 2", "unchanged"],
      ["Chapter 3", "new"],
    ]);
    expect(review.size).toBe("small");
  });

  it("keeps a replaced image when the output references it", () => {
    const snapshot = readySnapshot(sixParagraphXml());
    snapshot.blocks[1] = {
      ...snapshot.blocks[1],
      type: "native",
      nativeKind: "image",
      objects: [],
    };
    const review = buildWordPlanReview(
      plan(snapshot, [
        { kind: "keep", source: ["b1"] },
        {
          kind: "replace",
          source: ["b2"],
          blocks: [
            {
              id: "img",
              type: "image",
              text: "",
              image: { sourceRef: "b2_image_1" },
            },
          ],
        },
        ...keepAll(snapshot, ["b1", "b2"]),
      ]),
      snapshot,
    );
    expect(review.risks).toEqual([]);
    expect(review.rows.find((r) => r.key === "output:img")).toMatchObject({
      family: "object",
      status: "kept",
      objectKind: "image",
    });
  });
});

describe("changes derived from the captured original", () => {
  const sameLayout = (snapshot: WordAuthoringSnapshot) => ({
    scope: "document" as const,
    sections: [
      {
        id: "n1",
        source: "s1",
        layout: snapshot.sections![0].layout,
        footers: { default: "f1" },
      },
    ],
    stories: [
      {
        kind: "upsert" as const,
        type: "footer" as const,
        id: "f1",
        blocks: [para("footer", "Draft footer")],
      },
    ],
  });

  it("reports a kept body that only repeats the captured layout and footer as nothing to change", () => {
    const snapshot = withParts(readySnapshot());
    const review = buildWordPlanReview(
      plan(snapshot, keepAll(snapshot), sameLayout(snapshot)),
      snapshot,
    );
    expect(review.noChange).toBe(true);
    expect(review.title).toEqual({ kind: "none" });
    expect(review.partsRows).toEqual([]);
    expect(review.risks).toEqual([]);
    expect(review.scope.unchanged).toEqual(["footers", "layout"]);
  });

  it("does not let a repeated layout make a small body edit large", () => {
    const snapshot = withParts(readySnapshot());
    const review = buildWordPlanReview(
      plan(
        snapshot,
        [
          { kind: "replace", source: ["b1"], blocks: [para("n1", "Intro")] },
          ...keepAll(snapshot, ["b1"]),
        ],
        sameLayout(snapshot),
      ),
      snapshot,
    );
    expect(review.size).toBe("small");
    expect(review.title).toEqual({ kind: "paragraphs-changed", n: 1 });
  });

  it("treats a replaced heading as carried when its entry outputs a heading at the same position among the entry's headings", () => {
    const snapshot = chapters(3);
    const review = buildWordPlanReview(
      plan(snapshot, [
        { kind: "keep", source: ["b1", "b2"] },
        {
          kind: "replace",
          source: ["b3"],
          blocks: [
            { id: "h2", type: "heading", level: 1, text: "Second chapter" },
          ],
        },
        { kind: "keep", source: ["b4"] },
        { kind: "replace", source: ["b5"], blocks: [para("p3", "Chapter 3")] },
        { kind: "keep", source: ["b6"] },
      ]),
      snapshot,
    );
    expect(review.risks.find((r) => r.kind === "headings-lost")).toEqual({
      kind: "headings-lost",
      count: 1,
      rowKey: "output:p3",
      items: [{ rowKey: "output:p3", text: "Chapter 3" }],
    });
  });

  it("reports a deleted heading as lost even when the plan inserts another heading", () => {
    const snapshot = chapters(2);
    const review = buildWordPlanReview(
      plan(
        snapshot,
        [
          { kind: "keep", source: ["b1", "b2", "b4"] },
          {
            kind: "insert",
            contextRefs: ["b4"],
            blocks: [{ id: "h", type: "heading", level: 1, text: "Appendix" }],
          },
        ],
        { deleted: [{ source: ["b3"], reason: "Merged." }] },
      ),
      snapshot,
    );
    expect(review.risks.find((r) => r.kind === "headings-lost")).toEqual({
      kind: "headings-lost",
      count: 1,
      rowKey: "deleted:b3",
      items: [{ rowKey: "deleted:b3", text: "Chapter 2" }],
    });
  });

  it("reports a moved section boundary as a layout change naming the paragraph it ends after", () => {
    const snapshot = withParts(readySnapshot());
    snapshot.sections![0].afterBlock = "b2";
    snapshot.sections!.push({
      id: "s2",
      layout: {},
      headers: {},
      footers: {},
      xml: "",
    });
    const review = buildWordPlanReview(
      plan(snapshot, keepAll(snapshot), {
        scope: "document",
        sections: [
          { id: "n1", source: "s1", after: "b4" },
          { id: "n2", source: "s2" },
        ],
      }),
      snapshot,
    );
    expect(review.partsRows).toEqual([
      expect.objectContaining({
        key: "section:n1",
        status: "changed",
        changes: [
          {
            property: "boundary",
            length: false,
            before: "Two regions.",
            after: "Pilot in October.",
          },
        ],
      }),
    ]);
    expect(review.risks.map((r) => r.kind)).toEqual(["layout-changed"]);
    expect(review.noChange).toBe(false);
    expect(review.variant).toBe("layout");
  });

  it("keeps a section boundary that follows its paragraph into a replacement", () => {
    const snapshot = withParts(readySnapshot());
    snapshot.sections![0].afterBlock = "b2";
    snapshot.sections!.push({
      id: "s2",
      layout: {},
      headers: {},
      footers: {},
      xml: "",
    });
    const review = buildWordPlanReview(
      plan(
        snapshot,
        [
          { kind: "keep", source: ["b1"] },
          { kind: "replace", source: ["b2"], blocks: [para("n2", "Regions")] },
          ...keepAll(snapshot, ["b1", "b2"]),
        ],
        {
          scope: "document",
          sections: [
            { id: "n1", source: "s1", after: "n2" },
            { id: "n2", source: "s2" },
          ],
        },
      ),
      snapshot,
    );
    expect(review.partsRows).toEqual([]);
  });

  it("carries only as many replaced tables as the entry outputs and reports the rest as removed", () => {
    const snapshot = readySnapshot(
      packageXml(paragraph("Intro") + TABLE + paragraph("Gap") + TABLE),
    );
    const review = buildWordPlanReview(
      plan(snapshot, [
        { kind: "keep", source: ["b1"] },
        {
          kind: "replace",
          source: ["b2", "b3", "b4"],
          blocks: [
            para("p", "Merged"),
            {
              id: "t",
              type: "table",
              text: "",
              rows: [{ cells: [{ blocks: [para("c", "Only")] }] }],
            },
          ],
        },
      ]),
      snapshot,
    );
    expect(review.risks.find((r) => r.kind === "natives-removed")).toEqual({
      kind: "natives-removed",
      count: 1,
      rowKey: "replaced:b4",
      items: [{ rowKey: "replaced:b4", objectKind: "table" }],
    });
    expect(review.size).toBe("large");
  });

  it("marks a replaced table without cell, row or column differences as kept and leaves it out of the counts", () => {
    const snapshot = readySnapshot(
      packageXml(paragraph("Intro") + TABLE + paragraph("After")),
    );
    const table = snapshot.blocks[1];
    const review = buildWordPlanReview(
      plan(snapshot, [
        { kind: "replace", source: ["b1"], blocks: [para("n1", "Opening")] },
        {
          kind: "replace",
          source: [table.ref],
          blocks: [
            {
              id: "same",
              type: "table",
              text: "",
              sourceRef: table.ref,
              rows: table.content!.rows.map((r) => ({
                sourceIndex: r.sourceIndex,
                cells: r.cells.map((c) => ({ sourceIndex: c.sourceIndex })),
              })),
            },
          ],
        },
        { kind: "keep", source: ["b3"] },
      ]),
      snapshot,
    );
    expect(review.rows.find((r) => r.key === "output:same")?.status).toBe(
      "kept",
    );
    expect(review.changedBlocks).toBe(1);
    expect(review.title).toEqual({ kind: "paragraphs-changed", n: 1 });
    expect(review.groups[0].summary).toMatchObject({ text: 1, tables: 0 });
  });

  it("locates an insert without context at the block just before it", () => {
    const snapshot = readySnapshot();
    const review = buildWordPlanReview(
      plan(snapshot, [
        { kind: "keep", source: ["b1", "b2", "b3"] },
        { kind: "insert", blocks: [para("n1", "Inserted")] },
        ...keepAll(snapshot, ["b1", "b2", "b3"]),
      ]),
      snapshot,
    );
    expect(review.rows.find((r) => r.key === "output:n1")?.locateRef).toBe(
      "b3",
    );
  });
});

describe("plan helpers", () => {
  it("numbers list items per list and restarts deeper levels", () => {
    const next = createWordListNumbering();
    const item = (list: string, level = 0) => ({
      type: "list-item",
      list,
      level,
    });
    expect(
      [
        item("a"),
        item("a", 1),
        item("a", 1),
        item("b"),
        item("a"),
        item("a", 1),
        { type: "paragraph" },
      ].map(next),
    ).toEqual([1, 1, 2, 1, 2, 1, undefined]);
  });

  it("formats lengths in centimetres or millimetres", () => {
    expect(wordLength(72)).toEqual({ value: 2.54, unit: "cm" });
    expect(wordLength(144)).toEqual({ value: 5.08, unit: "cm" });
    expect(wordLength(14.4)).toEqual({ value: 5.1, unit: "mm" });
  });

  it("reports a plan that keeps every source in place as nothing to change", () => {
    const snapshot = readySnapshot();
    const review = buildWordPlanReview(
      plan(snapshot, keepAll(snapshot)),
      snapshot,
    );
    expect(review.noChange).toBe(true);
    expect(review.title).toEqual({ kind: "none" });
    const moved = buildWordPlanReview(
      plan(snapshot, keepAll(snapshot).reverse()),
      snapshot,
    );
    expect(moved.noChange).toBe(false);
  });

  it("counts inserted sections apart from the existing ones they update", () => {
    const snapshot = withParts(chapters(4));
    const bodies = snapshot.blocks.filter((b) => b.type === "paragraph");
    const review = buildWordPlanReview(
      plan(
        snapshot,
        [
          ...snapshot.blocks.map<WordPlanEntry>((b) =>
            b.ref === bodies[0].ref
              ? {
                  kind: "replace",
                  source: [b.ref],
                  blocks: [para("n1", "New body")],
                }
              : { kind: "keep", source: [b.ref] },
          ),
          {
            kind: "insert",
            contextRefs: [snapshot.blocks[snapshot.blocks.length - 1].ref],
            blocks: [
              { id: "h5", type: "heading", level: 1, text: "Chapter 5" },
            ],
          },
        ],
        {
          scope: "document",
          stories: [
            {
              kind: "upsert",
              type: "footer",
              id: "f1",
              blocks: [para("footer", "Final footer")],
            },
          ],
        },
      ),
      snapshot,
    );
    expect(review.size).toBe("large");
    expect(review.title).toMatchObject({
      kind: "sections",
      changed: 1,
      total: 4,
      added: 1,
    });
  });
});

describe("review size boundaries", () => {
  const longSection = (paragraphs: number) =>
    readySnapshot(
      packageXml(
        heading("Only") +
          Array.from({ length: paragraphs }, (_, i) =>
            paragraph(`Line ${i + 1}`),
          ).join(""),
      ),
    );
  const rewrite = (snapshot: WordAuthoringSnapshot, count: number) =>
    plan(
      snapshot,
      snapshot.blocks.map<WordPlanEntry>((b, i) =>
        i >= 1 && i <= count
          ? {
              kind: "replace",
              source: [b.ref],
              blocks: [para(`n-${b.ref}`, `New ${b.text}`)],
            }
          : { kind: "keep", source: [b.ref] },
      ),
    );

  it.each([
    [5, "small"],
    [6, "medium"],
    [39, "medium"],
    [40, "large"],
  ] as const)("sizes a paragraph-edit batch of %i as %s", (n, size) => {
    expect(wordEditBatchSize(n)).toBe(size);
  });

  it.each([
    [5, "small"],
    [6, "medium"],
    [39, "medium"],
    [40, "large"],
  ] as const)(
    "sizes %i replaced blocks in one section as %s",
    (count, size) => {
      const snapshot = longSection(45);
      expect(buildWordPlanReview(rewrite(snapshot, count), snapshot).size).toBe(
        size,
      );
    },
  );

  it("treats a one-section body change plus a document part as large", () => {
    const snapshot = withParts(chapters(1));
    const body = snapshot.blocks.find((b) => b.type === "paragraph")!;
    const review = buildWordPlanReview(
      plan(
        snapshot,
        snapshot.blocks.map<WordPlanEntry>((b) =>
          b.ref === body.ref
            ? {
                kind: "replace",
                source: [b.ref],
                blocks: [para("n1", "New body")],
              }
            : { kind: "keep", source: [b.ref] },
        ),
        {
          scope: "document",
          stories: [
            {
              kind: "upsert",
              type: "footer",
              id: "f1",
              blocks: [para("footer", "Final footer")],
            },
          ],
        },
      ),
      snapshot,
    );
    expect(review.touchedSections).toBe(1);
    expect(review.size).toBe("large");
  });

  it("keeps a one-paragraph whole-file rewrite small", () => {
    const snapshot = readySnapshot();
    snapshot.fullDocument = true;
    const review = buildWordPlanReview(
      plan(
        snapshot,
        snapshot.blocks.map<WordPlanEntry>((b, i) =>
          i === 0
            ? {
                kind: "replace",
                source: [b.ref],
                blocks: [para("n1", "New opening")],
              }
            : { kind: "keep", source: [b.ref] },
        ),
        { scope: "document" },
      ),
      snapshot,
    );
    expect(review.size).toBe("small");
    expect(review.scope.wholeFile).toBe(true);
  });
});
