import { readFileSync } from "node:fs";

import * as CFB from "cfb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installFakePowerPoint,
  removeFakePowerPoint,
  requirementsUpTo,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import {
  buildPptx,
  chartFrame,
  chartXml,
  group,
  ink,
  oleFrame,
  pic,
  smartArtDataXml,
  smartArtFrame,
  sp,
  table,
} from "../../../test/mocks/powerpoint/pptxFixture";
import { powerpointTierText } from "../powerpointFacet";
import { POWERPOINT_FILE_LIMITS } from "../powerpointFile";
import { SAVED_FILE_NOTE } from "../powerpointFileContent";
import { powerpointReadSupport } from "../powerpointReadSupport";
import {
  POWERPOINT_READ_MAX_BYTES,
  readPowerPointPresentation,
  readPowerPointSelection,
  readPowerPointSlide,
} from "../powerpointReads";

import type {
  FakeDeck,
  FakePowerPointHost,
  FakeShape,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import type { FixtureSlide } from "../../../test/mocks/powerpoint/pptxFixture";
import type { PowerPointShapeOut } from "../powerpointShapeRead";
import type { ClientToolExecutionResult } from "@erato/frontend/library";

const FULL = powerpointReadSupport(requirementsUpTo("1.10"), { fileApi: true });
const BASIC = powerpointReadSupport(requirementsUpTo("1.5"), { fileApi: true });
const LIMITS = { ...POWERPOINT_FILE_LIMITS };

let host: FakePowerPointHost | null = null;
beforeEach(() => Object.assign(POWERPOINT_FILE_LIMITS, LIMITS));
afterEach(() => {
  // Every route closes what it opened, whatever happened.
  expect(host?.openFiles ?? 0).toBe(0);
  host = null;
  removeFakePowerPoint();
});

const SLIDE_1 = "256#3077428485";
const SLIDE_2 = "257#1149237011";

const sales = chartXml({
  title: "Sales",
  categories: ["Q1", "Q2", "Q3"],
  series: [
    { name: "North", values: [10, 12.5, null] },
    { name: "South", values: [7, 8, 9] },
  ],
});
const plan = smartArtDataXml([
  { text: "Plan", children: [{ text: "Scope" }, { text: "Budget" }] },
  { text: "Build" },
]);

const fileSlide1: FixtureSlide = {
  sldId: 256,
  hidden: true,
  notes: "Open with the numbers.\nThen ask for questions.",
  shapes: [
    sp(
      "2",
      "Quarterly review",
      { left: 40, top: 20 },
      { placeholder: "title" },
    ),
    chartFrame("4", "rIdChart", {
      left: 40,
      top: 120,
      width: 300,
      height: 200,
    }),
    smartArtFrame("5", "rIdData", {
      left: 400,
      top: 120,
      width: 300,
      height: 200,
    }),
    table(
      "6",
      [
        ["Region", "Q1"],
        ["EU", "10"],
      ],
      { left: 40, top: 340 },
    ),
    group(
      "7",
      { left: 400, top: 340, width: 200, height: 100 },
      [
        sp(
          "8",
          "Left note",
          { left: 0, top: 0, width: 100, height: 50 },
          { textBox: true },
        ),
        table(
          "9",
          [
            ["a", "<merged>"],
            ["c", "d"],
          ],
          { left: 100, top: 50, width: 100, height: 50 },
        ),
      ],
      0.5,
    ),
  ],
  charts: { rIdChart: sales },
  smartArt: { rIdData: plan },
};
const fileSlide2: FixtureSlide = {
  sldId: 257,
  shapes: [
    sp("2", "Second", { left: 40, top: 20 }, { textBox: true }),
    table(
      "3",
      [
        ["Owner", "Due"],
        ["Ana", "May"],
      ],
      { left: 40, top: 100 },
      "body",
    ),
    pic("14", { left: 300, top: 100 }),
  ],
};

const liveSlide1: FakeShape[] = [
  {
    id: "2",
    type: "Placeholder",
    role: "Title",
    top: 20,
    left: 40,
    text: "Quarterly review",
  },
  { id: "4", type: "Chart", top: 120, left: 40 },
  { id: "5", type: "SmartArt", top: 120, left: 400 },
  {
    id: "6",
    type: "Table",
    top: 340,
    left: 40,
    table: [
      ["Region", "Q1"],
      ["EU", "10"],
    ],
  },
  {
    id: "7",
    type: "Group",
    top: 340,
    left: 400,
    children: [
      { id: "8", type: "TextBox", text: "Left note" },
      {
        id: "9",
        type: "Table",
        top: 25,
        table: [
          ["a", ""],
          ["c", "d"],
        ],
      },
    ],
  },
];
const liveSlide2: FakeShape[] = [
  { id: "2", type: "TextBox", top: 20, left: 40, text: "Second" },
  {
    id: "3",
    type: "Placeholder",
    holds: "Table",
    top: 100,
    left: 40,
    table: [
      ["Owner", "Due"],
      ["Ana", "May"],
    ],
  },
  { id: "14", type: "Image", top: 100, left: 300 },
];

function deck(overrides: Partial<FakeDeck> = {}, file?: Uint8Array): FakeDeck {
  return {
    slides: [
      { id: SLIDE_1, shapes: liveSlide1 },
      { id: SLIDE_2, shapes: liveSlide2 },
    ],
    file: { bytes: file ?? buildPptx([fileSlide1, fileSlide2]) },
    slideExports: {
      [SLIDE_1]: buildPptx([{ ...fileSlide1, sldId: 256 }]),
      [SLIDE_2]: buildPptx([{ ...fileSlide2, sldId: 256 }]),
    },
    ...overrides,
  };
}

const ok = (read: ClientToolExecutionResult) => {
  if (!read.ok) throw new Error(read.error);
  return read.result as Record<string, unknown> & {
    slide: {
      unread?: string[];
      notes?: string;
      fileContent?: string;
      notesOnFirstPage?: boolean;
      [key: string]: unknown;
    };
    shapes: PowerPointShapeOut[];
  };
};
const byId = (shapes: PowerPointShapeOut[], id: string) =>
  shapes.find((shape) => shape.id === id)!;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

describe("full tier: the one-slide export", () => {
  it("adds notes, the hidden flag, chart data and SmartArt text", async () => {
    host = installFakePowerPoint(deck());
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    expect(result.neverReadable).toEqual(["comments", "animations"]);
    expect(result.slide).toMatchObject({
      hidden: true,
      notes: "Open with the numbers.\nThen ask for questions.",
    });
    expect(result.slide.unread).toBeUndefined();
    const chart = byId(result.shapes, "4");
    expect(chart.unread).toBeUndefined();
    expect(chart.chart).toEqual({
      type: "column",
      title: "Sales",
      categories: ["Q1", "Q2", "Q3"],
      series: [
        { name: "North", values: [10, 12.5, null] },
        { name: "South", values: [7, 8, 9] },
      ],
    });
    const smartArt = byId(result.shapes, "5");
    expect(smartArt.unread).toBeUndefined();
    expect(smartArt.smartArt).toEqual([
      { text: "Plan", level: 1 },
      { text: "Scope", level: 2 },
      { text: "Budget", level: 2 },
      { text: "Build", level: 1 },
    ]);
    // Tables and groups stay live reads on this tier.
    expect(byId(result.shapes, "7").children).toHaveLength(2);
    expect(host.exports).toBe(1);
    expect(host.fileOpens).toBe(0);
  });

  it("says a slide has no notes when its export names no notes page", async () => {
    host = installFakePowerPoint(deck());
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_2 }));
    expect(result.slide.notes).toBe("");
    expect(result.slide.unread).toBeUndefined();
    expect(result.slide.fileContent).toBeUndefined();
  });

  it("says a slide has no notes when the whole file names none", async () => {
    host = installFakePowerPoint(deck());
    const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_2 }));
    expect(result.slide).toMatchObject({ hidden: false, notes: "" });
  });

  it("falls back to the whole file when the export leaves out a part the slide names", async () => {
    host = installFakePowerPoint(
      deck({
        slideExports: {
          [SLIDE_1]: buildPptx([{ ...fileSlide1, dropParts: ["rIdChart"] }]),
        },
      }),
    );
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    expect(byId(result.shapes, "4").chart?.series).toHaveLength(2);
    expect(host.fileOpens).toBe(1);
  });

  it("returns the live read with reasons when the export hangs, and later reads still run", async () => {
    POWERPOINT_FILE_LIMITS.fileDeadlineMs = 30;
    host = installFakePowerPoint(deck({ slideExports: { [SLIDE_1]: "hang" } }));
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    expect(result.slide.unread).toEqual([
      "speaker notes and whether the slide is hidden: PowerPoint did not hand over the presentation file in time",
    ]);
    expect(byId(result.shapes, "4").unread).toEqual([
      "chart data: PowerPoint did not hand over the presentation file in time",
    ]);
    // No time is left for the slower whole file.
    expect(host.fileOpens).toBe(0);
    const overview = ok(await readPowerPointPresentation(FULL, {}));
    expect(overview.slideCount).toBe(2);
    expect(overview.onlyInSlideReads).toEqual([
      "speaker notes",
      "chart data",
      "SmartArt text",
      "whether a slide is hidden",
    ]);
  });

  it("falls back to the whole file when the export fails", async () => {
    host = installFakePowerPoint(deck({ slideExports: { [SLIDE_1]: "fail" } }));
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    expect(result.slide.notes).toContain("Open with the numbers.");
    expect(host.fileOpens).toBe(1);
  });
});

describe("basic tier: the whole file", () => {
  it("adds tables, group children, placeholder contents, notes, charts and SmartArt", async () => {
    host = installFakePowerPoint(deck());
    const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_1 }));
    expect(result.notReadableOnThisHost).not.toContain("table contents");
    expect(result.notReadableOnThisHost).not.toContain("shapes inside groups");
    expect(result.slide).toMatchObject({ hidden: true });
    expect(byId(result.shapes, "6")).toMatchObject({
      table: {
        rows: 2,
        columns: 2,
        values: [
          ["Region", "Q1"],
          ["EU", "10"],
        ],
      },
    });
    expect(byId(result.shapes, "6").unread).toBeUndefined();
    const groupOut = byId(result.shapes, "7");
    expect(groupOut.unread).toBeUndefined();
    // Child space is twice the group's size, so children land at half scale inside it.
    expect(groupOut.children).toEqual([
      {
        id: "8",
        name: "Shape 8",
        type: "TextBox",
        box: { left: 400, top: 340, width: 50, height: 25 },
        text: "Left note",
      },
      {
        id: "9",
        name: "Table 9",
        type: "Table",
        box: { left: 450, top: 365, width: 50, height: 25 },
        table: {
          rows: 2,
          columns: 2,
          values: [
            ["a", ""],
            ["c", "d"],
          ],
        },
      },
    ]);
    expect(byId(result.shapes, "4").chart?.title).toBe("Sales");
    expect(byId(result.shapes, "5").smartArt).toHaveLength(4);
    expect(host.exports).toBe(0);
    expect(host.fileOpens).toBe(1);
  });

  it("tells a placeholder's table from other content", async () => {
    host = installFakePowerPoint(deck());
    const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_2 }));
    expect(byId(result.shapes, "3")).toMatchObject({
      holds: "Table",
      table: {
        values: [
          ["Owner", "Due"],
          ["Ana", "May"],
        ],
      },
    });
    expect(byId(result.shapes, "3").unread).toBeUndefined();
    expect(byId(result.shapes, "14").unread).toEqual(["picture content"]);
  });

  it("reads only the slices that hold the parts it needs", async () => {
    POWERPOINT_FILE_LIMITS.sliceBytes = 64 * 1024;
    const file = buildPptx([fileSlide1, fileSlide2], {
      mediaBytes: 600 * 1024,
    });
    host = installFakePowerPoint(deck({}, file));
    const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_2 }));
    expect(byId(result.shapes, "3").table).toBeDefined();
    const slices = Math.ceil(file.length / (64 * 1024));
    expect(slices).toBeGreaterThan(9);
    expect(new Set(host.slicesRead).size).toBeLessThan(slices / 2);
  });

  it.each([
    [
      "too large",
      () => {
        POWERPOINT_FILE_LIMITS.fileMaxBytes = 100;
      },
      {},
      /files up to .* MB are read/,
    ],
    [
      "slow to open",
      () => {
        POWERPOINT_FILE_LIMITS.fileDeadlineMs = 30;
      },
      { hangOpen: true },
      /did not hand over the presentation file in time/,
    ],
    [
      "a hanging slice",
      () => {
        POWERPOINT_FILE_LIMITS.fileDeadlineMs = 50;
      },
      { hangSlice: 0 },
      /did not hand over the presentation file in time/,
    ],
    ["a failing slice", () => {}, { failSlice: 0 }, /could not read part/],
    ["refused", () => {}, { refuseCode: 5001 }, /refused to hand over/],
    [
      "sliced unexpectedly",
      () => {},
      { sliceSize: 1000 },
      /sliced the presentation file in an unexpected way/,
    ],
  ])(
    "keeps the live read when the file is %s",
    async (_, setup, file, reason) => {
      setup();
      host = installFakePowerPoint(
        deck({ file: { bytes: buildPptx([fileSlide1, fileSlide2]), ...file } }),
      );
      const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_1 }));
      expect(result.slide.unread?.[0]).toMatch(reason);
      expect(result.slide.notes).toBeUndefined();
      expect(byId(result.shapes, "6").unread?.[0]).toMatch(
        /^table contents: (?!this PowerPoint version)/,
      );
      expect(byId(result.shapes, "4").unread?.[0]).toMatch(/^chart data: /);
    },
  );
});

describe("a file that does not show the slide on screen", () => {
  it("is not used when a text differs (unsaved edit)", async () => {
    const saved = {
      ...fileSlide1,
      shapes: [
        sp("2", "Old title", { left: 40, top: 20 }, { placeholder: "title" }),
        ...fileSlide1.shapes.slice(1),
      ],
    };
    host = installFakePowerPoint(deck({}, buildPptx([saved, fileSlide2])));
    const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_1 }));
    expect(result.slide.unread?.[0]).toMatch(
      /does not match the slide on screen/,
    );
    expect(result.slide.notes).toBeUndefined();
    expect(byId(result.shapes, "6").table).toBeUndefined();
  });

  it("is not used when a shape on screen is missing from it", async () => {
    const saved = { ...fileSlide1, shapes: fileSlide1.shapes.slice(0, 2) };
    host = installFakePowerPoint(deck({}, buildPptx([saved, fileSlide2])));
    const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_1 }));
    expect(result.slide.unread?.[0]).toMatch(/does not match/);
  });

  it("is not used when slides were added or reordered since", async () => {
    host = installFakePowerPoint(deck({}, buildPptx([fileSlide2, fileSlide1])));
    // Position 1 in the file is now sldId 257.
    const swapped = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_1 }));
    expect(swapped.slide.unread?.[0]).toMatch(/does not match/);
    removeFakePowerPoint();
    host = installFakePowerPoint(deck({}, buildPptx([fileSlide1])));
    const fewer = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_1 }));
    expect(fewer.slide.unread?.[0]).toMatch(/does not match/);
  });

  it("maps by position when the slide id has no number", async () => {
    host = installFakePowerPoint(
      deck({
        slides: [
          { id: "first", shapes: liveSlide1 },
          { id: "second", shapes: liveSlide2 },
        ],
      }),
    );
    const result = ok(await readPowerPointSlide(BASIC, { slideId: "second" }));
    expect(byId(result.shapes, "3").table).toBeDefined();
  });

  it("ignores field text, which the saved file may show differently", async () => {
    const saved = {
      ...fileSlide2,
      shapes: [
        sp("2", "Second {slide}", { left: 40, top: 20 }),
        ...fileSlide2.shapes.slice(1),
      ],
    };
    host = installFakePowerPoint(
      deck(
        {
          slides: [
            { id: SLIDE_1, shapes: liveSlide1 },
            {
              id: SLIDE_2,
              shapes: [
                { ...liveSlide2[0], text: "Second 2" },
                ...liveSlide2.slice(1),
              ],
            },
          ],
        },
        buildPptx([fileSlide1, saved]),
      ),
    );
    const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_2 }));
    expect(result.slide.unread).toBeUndefined();
  });
});

describe("caps", () => {
  it("cuts a large chart to fit the page and says what was cut", async () => {
    const big = chartXml({
      categories: Array.from({ length: 300 }, (_, i) => `Category ${i}`),
      series: Array.from({ length: 30 }, (_, s) => ({
        name: `Series ${s}`,
        values: Array.from({ length: 300 }, (_, i) => i * 1.5 + s),
      })),
    });
    const fileSlide = { ...fileSlide1, charts: { rIdChart: big } };
    host = installFakePowerPoint(
      deck({
        slideExports: { [SLIDE_1]: buildPptx([fileSlide]) },
      }),
    );
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    expect(bytes(result)).toBeLessThanOrEqual(POWERPOINT_READ_MAX_BYTES);
    const chart = byId(result.shapes, "4").chart!;
    expect(chart.unread).toEqual(
      expect.arrayContaining([
        "series 21-30: cut to keep the result small",
        "points 201-300 of each series: cut to keep the result small",
        expect.stringMatching(/^chart points \d+-200 of every series: cut/),
      ]),
    );
  });

  it("names chart values that were not saved", async () => {
    const fileSlide = {
      ...fileSlide1,
      charts: {
        rIdChart: chartXml({
          categories: ["A"],
          series: [{ name: "Linked", values: [1] }],
          noCache: true,
        }),
      },
    };
    host = installFakePowerPoint(
      deck({ slideExports: { [SLIDE_1]: buildPptx([fileSlide]) } }),
    );
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    expect(byId(result.shapes, "4").chart?.unread).toEqual([
      'series "Linked" values: not saved with the chart',
    ]);
  });

  it("cuts long speaker notes", async () => {
    const fileSlide = { ...fileSlide1, notes: "n".repeat(5000) };
    host = installFakePowerPoint(
      deck({ slideExports: { [SLIDE_1]: buildPptx([fileSlide]) } }),
    );
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    expect(result.slide.notes).toMatch(/…\[cut: \d+ more characters\]$/);
    expect(
      new TextEncoder().encode(result.slide.notes).length,
    ).toBeLessThanOrEqual(4000);
  });
});

describe("selection", () => {
  it("fills a selected chart from the slide's file", async () => {
    host = installFakePowerPoint(
      deck({ selectedSlideIds: [SLIDE_1], selectedShapeIds: ["4"] }),
    );
    const result = ok(await readPowerPointSelection(FULL));
    const [shape] = result.selectedShapes as PowerPointShapeOut[];
    expect(shape.chart?.series).toHaveLength(2);
    expect(result.neverReadable).toEqual(["comments", "animations"]);
  });

  it("leaves shapes as they are when several slides are selected", async () => {
    host = installFakePowerPoint(
      deck({ selectedSlideIds: [SLIDE_1, SLIDE_2], selectedShapeIds: ["4"] }),
    );
    const result = ok(await readPowerPointSelection(FULL));
    const [shape] = result.selectedShapes as PowerPointShapeOut[];
    expect(shape.unread).toEqual(["chart data (no PowerPoint API reads it)"]);
    expect(host.exports).toBe(0);
  });

  it("does not read the file when nothing selected needs it", async () => {
    host = installFakePowerPoint(
      deck({ selectedSlideIds: [SLIDE_1], selectedShapeIds: ["2"] }),
    );
    await readPowerPointSelection(FULL);
    expect(host.exports + host.fileOpens).toBe(0);
  });
});

describe("the facet's tier text", () => {
  it("tells the model what slide reads take from the file", () => {
    const text = powerpointTierText(BASIC);
    expect(text).toMatch(
      /slide reads also return speaker notes, chart data, SmartArt text and whether a slide is hidden from the presentation file$/,
    );
    expect(text).not.toContain("table contents");
    expect(
      powerpointTierText(powerpointReadSupport(requirementsUpTo("1.5"))),
    ).toContain("table contents");
  });
});

describe("hosts without a file route", () => {
  it("keep today's results", async () => {
    const live = powerpointReadSupport(requirementsUpTo("1.5"));
    host = installFakePowerPoint(deck());
    const result = ok(await readPowerPointSlide(live, { slideId: SLIDE_1 }));
    expect(result.slide.unread).toBeUndefined();
    expect(result.slide.notes).toBeUndefined();
    expect(result.neverReadable).toContain("speaker notes");
    expect(host.fileOpens).toBe(0);
  });
});

describe("where file content comes from", () => {
  it("labels whole-file content as possibly the last saved version, and the export not", async () => {
    host = installFakePowerPoint(deck());
    const basic = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_1 }));
    expect(basic.slide.fileContent).toBe(SAVED_FILE_NOTE);
    const full = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    expect(full.slide.fileContent).toBeUndefined();
  });

  it("checks a selection's file against the whole slide, as a slide read does", async () => {
    const edited = liveSlide1.map((shape) =>
      shape.id === "2" ? { ...shape, text: "Unsaved title" } : shape,
    );
    host = installFakePowerPoint(
      deck({
        slides: [
          { id: SLIDE_1, shapes: edited },
          { id: SLIDE_2, shapes: liveSlide2 },
        ],
        selectedSlideIds: [SLIDE_1],
        selectedShapeIds: ["4"],
      }),
    );
    const result = ok(await readPowerPointSelection(BASIC));
    const [chart] = result.selectedShapes as PowerPointShapeOut[];
    expect(chart.chart).toBeUndefined();
    expect(chart.unread?.[0]).toMatch(
      /^chart data: .*does not match the slide on screen/,
    );
    expect(result.fileContent).toBeUndefined();
  });

  it("does not label the whole file where it includes unsaved edits", async () => {
    const current = powerpointReadSupport(requirementsUpTo("1.5"), {
      fileApi: true,
      fileIsCurrent: true,
    });
    host = installFakePowerPoint(
      deck({ selectedSlideIds: [SLIDE_1], selectedShapeIds: ["6"] }),
    );
    const slide = ok(await readPowerPointSlide(current, { slideId: SLIDE_1 }));
    expect(slide.slide.fileContent).toBeUndefined();
    expect(slide.slide.notes).toBeDefined();
    const selection = ok(await readPowerPointSelection(current));
    expect(selection.fileContent).toBeUndefined();
  });

  it("does not ask to save first where the file includes unsaved edits", async () => {
    const current = powerpointReadSupport(requirementsUpTo("1.5"), {
      fileApi: true,
      fileIsCurrent: true,
    });
    const edited = liveSlide1.map((shape) =>
      shape.id === "2" ? { ...shape, text: "Changed during the read" } : shape,
    );
    host = installFakePowerPoint(
      deck({
        slides: [
          { id: SLIDE_1, shapes: edited },
          { id: SLIDE_2, shapes: liveSlide2 },
        ],
        selectedSlideIds: [SLIDE_1],
        selectedShapeIds: ["4"],
      }),
    );
    const result = ok(await readPowerPointSelection(current));
    const [chart] = result.selectedShapes as PowerPointShapeOut[];
    expect(chart.unread?.[0]).toMatch(/\(it changed during the read\)$/);
  });

  it("labels a selection filled from the whole file", async () => {
    host = installFakePowerPoint(
      deck({ selectedSlideIds: [SLIDE_1], selectedShapeIds: ["6"] }),
    );
    const result = ok(await readPowerPointSelection(BASIC));
    const [tableShape] = result.selectedShapes as PowerPointShapeOut[];
    expect(tableShape.table?.values[1]).toEqual(["EU", "10"]);
    expect(result.fileContent).toBe(SAVED_FILE_NOTE);
  });
});

describe("reads issued together", () => {
  it("each end by their own deadline and fall back, instead of queueing past the tool timeout", async () => {
    POWERPOINT_FILE_LIMITS.fileDeadlineMs = 150;
    host = installFakePowerPoint(
      deck({
        file: { bytes: buildPptx([fileSlide1, fileSlide2]), hangOpen: true },
      }),
    );
    const started = Date.now();
    const reads = await Promise.all(
      [SLIDE_1, SLIDE_2, SLIDE_1, SLIDE_2].map(async (slideId) => {
        const result = ok(await readPowerPointSlide(BASIC, { slideId }));
        return { result, at: Date.now() - started };
      }),
    );
    for (const { result, at } of reads) {
      expect(at).toBeLessThan(600);
      expect(result.slide.unread?.[0]).toMatch(/in time/);
    }
  });
});

describe("the page cap with notes", () => {
  const long = "漢".repeat(3900);
  const fileSlide = {
    ...fileSlide2,
    notes: "注".repeat(6000),
    shapes: [
      sp("2", long, { left: 40, top: 20 }, { textBox: true }),
      ...fileSlide2.shapes.slice(1),
    ],
  };
  const slides = [
    { id: SLIDE_1, shapes: liveSlide1 },
    {
      id: SLIDE_2,
      shapes: [{ ...liveSlide2[0], text: long }, ...liveSlide2.slice(1)],
    },
  ];

  it("keeps notes and a large shape within 20 KB, and sends notes on the first page only", async () => {
    host = installFakePowerPoint(
      deck({ slides, slideExports: { [SLIDE_2]: buildPptx([fileSlide]) } }),
    );
    const first = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_2 }));
    expect(bytes(first)).toBeLessThanOrEqual(POWERPOINT_READ_MAX_BYTES);
    expect(first.slide.notes).toMatch(/^注+…\[cut: \d+ more characters\]$/);
    const next = ok(
      await readPowerPointSlide(FULL, { slideId: SLIDE_2, startShape: 1 }),
    );
    expect(next.slide.notes).toBeUndefined();
    expect(next.slide.notesOnFirstPage).toBe(true);
  });
});

describe("shapes the reader handles specially", () => {
  it("matches ink by its p14 id, so the slide still gets its file content", async () => {
    const withInk = {
      ...fileSlide1,
      shapes: [...fileSlide1.shapes, ink("10", { left: 600, top: 20 })],
    };
    host = installFakePowerPoint(
      deck({
        slides: [
          { id: SLIDE_1, shapes: [...liveSlide1, { id: "10", type: "Ink" }] },
          { id: SLIDE_2, shapes: liveSlide2 },
        ],
        slideExports: { [SLIDE_1]: buildPptx([withInk]) },
      }),
    );
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    expect(result.slide.unread).toBeUndefined();
    expect(result.slide.notes).toContain("Open with the numbers.");
  });

  it("names a shape it cannot model instead of asking to save", async () => {
    const odd = {
      ...fileSlide1,
      shapes: [
        ...fileSlide1.shapes,
        "<p:futureShape><p:nvFuturePr/></p:futureShape>",
      ],
    };
    host = installFakePowerPoint(
      deck({
        slides: [
          {
            id: SLIDE_1,
            shapes: [...liveSlide1, { id: "11", type: "Unsupported" }],
          },
          { id: SLIDE_2, shapes: liveSlide2 },
        ],
        slideExports: { [SLIDE_1]: buildPptx([odd]) },
      }),
    );
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    expect(result.slide.unread?.[0]).toMatch(
      /a kind of shape this reader cannot match to the file$/,
    );
  });

  it("keeps a note for an embedded object in a placeholder", async () => {
    const withObject = {
      ...fileSlide2,
      shapes: [
        fileSlide2.shapes[0],
        oleFrame("3", { left: 40, top: 100 }, "body"),
        fileSlide2.shapes[2],
      ],
    };
    host = installFakePowerPoint(
      deck(
        {
          slides: [
            { id: SLIDE_1, shapes: liveSlide1 },
            {
              id: SLIDE_2,
              shapes: [
                liveSlide2[0],
                {
                  id: "3",
                  type: "Placeholder",
                  holds: "Ole",
                  top: 100,
                  left: 40,
                },
                liveSlide2[2],
              ],
            },
          ],
        },
        buildPptx([fileSlide1, withObject]),
      ),
    );
    const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_2 }));
    expect(byId(result.shapes, "3")).toMatchObject({
      holds: "Ole",
      unread: ["embedded object content"],
    });
  });

  it("does not give a chart another chart's data when the file repeats an id", async () => {
    const other = chartXml({
      categories: ["X"],
      series: [{ name: "Other", values: [1] }],
    });
    const twice = {
      ...fileSlide1,
      shapes: [
        ...fileSlide1.shapes,
        chartFrame("4", "rIdOther", { left: 0, top: 0 }),
      ],
      charts: { rIdChart: sales, rIdOther: other },
    };
    host = installFakePowerPoint(
      deck({ slideExports: { [SLIDE_1]: buildPptx([twice]) } }),
    );
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_1 }));
    const chart = byId(result.shapes, "4");
    expect(chart.chart).toBeUndefined();
    expect(chart.unread).toContain(
      "content from the file: the file has two shapes with this id",
    );
  });
});

describe("a file made outside these tests", () => {
  it("reads the chart and title of a generated deck with masters, layouts and embedded workbooks", async () => {
    const bytes = new Uint8Array(
      readFileSync(
        `${process.cwd()}/src/test/fixtures/powerpoint/Acme_Inc_Company_Overview.pptx`,
      ),
    );
    host = installFakePowerPoint({
      slides: [
        { id: "256#1", shapes: [] },
        {
          id: "257#2",
          shapes: [
            {
              id: "2",
              type: "Placeholder",
              role: "Title",
              text: "Revenue Development (2000–2025)",
            },
            { id: "3", type: "Chart", top: 100 },
          ],
        },
        { id: "258#3", shapes: [] },
        { id: "259#4", shapes: [] },
      ],
      file: { bytes },
    });
    const result = ok(await readPowerPointSlide(BASIC, { slideId: "257#2" }));
    expect(result.slide).toMatchObject({ hidden: false, notes: "" });
    const chart = byId(result.shapes, "3").chart!;
    expect(chart.type).toBe("line");
    expect(chart.categories?.slice(0, 2)).toEqual(["2000", "2001"]);
    expect(chart.series[0]).toMatchObject({
      name: "Revenue (Million USD)",
      values: expect.arrayContaining([120, 125]),
    });
  });
});

describe("the zip reader", () => {
  it("skips a part with an unusual name instead of failing the package", async () => {
    const zip = CFB.read(buildPptx([fileSlide1, fileSlide2]), {
      type: "array",
    });
    CFB.utils.cfb_add(
      zip,
      "ppt/media/my picture.png",
      new Uint8Array([1, 2, 3]),
    );
    const file = new Uint8Array(
      CFB.write(zip, {
        type: "array",
        fileType: "zip",
        compression: true,
      }) as number[],
    );
    host = installFakePowerPoint(deck({}, file));
    const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_1 }));
    expect(result.slide.unread).toBeUndefined();
  });

  it("stops a part that inflates past its declared size", async () => {
    const file = buildPptx([fileSlide1, fileSlide2]);
    declareSize(file, "ppt/slides/slide1.xml", 100);
    host = installFakePowerPoint(deck({}, file));
    const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_1 }));
    expect(result.slide.unread?.[0]).toMatch(/inflates past its declared size/);
  });

  it("says so when the web view cannot unpack", async () => {
    const original = globalThis.DecompressionStream;
    (globalThis as { DecompressionStream?: unknown }).DecompressionStream =
      undefined;
    try {
      host = installFakePowerPoint(deck());
      const result = ok(await readPowerPointSlide(BASIC, { slideId: SLIDE_1 }));
      expect(result.slide.unread?.[0]).toMatch(/cannot unpack the file/);
    } finally {
      globalThis.DecompressionStream = original;
    }
  });
});

/** Rewrites the central directory's uncompressed size of `name`, as a crafted file would. */
function declareSize(file: Uint8Array, name: string, size: number) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const wanted = new TextEncoder().encode(name);
  for (let i = 0; i < file.length - 46; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const length = view.getUint16(i + 28, true);
    const candidate = file.subarray(i + 46, i + 46 + length);
    if (
      candidate.every((byte, k) => byte === wanted[k]) &&
      length === wanted.length
    ) {
      view.setUint32(i + 24, size, true);
      return;
    }
  }
  throw new Error(`no entry ${name}`);
}
