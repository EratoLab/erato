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
  pic,
  smartArtDataXml,
  smartArtFrame,
  sp,
  table,
} from "../../../test/mocks/powerpoint/pptxFixture";
import { powerpointTierText } from "../powerpointFacet";
import { POWERPOINT_FILE_LIMITS } from "../powerpointFile";
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
    slide: { unread?: string[]; notes?: string; [key: string]: unknown };
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

  it("says a slide has no notes rather than leaving them out", async () => {
    host = installFakePowerPoint(deck());
    const result = ok(await readPowerPointSlide(FULL, { slideId: SLIDE_2 }));
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
    POWERPOINT_FILE_LIMITS.exportTimeoutMs = 30;
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
        POWERPOINT_FILE_LIMITS.fileBudgetMs = 30;
      },
      { hangOpen: true },
      /did not hand over the presentation file in time/,
    ],
    [
      "a hanging slice",
      () => {
        POWERPOINT_FILE_LIMITS.fileBudgetMs = 50;
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
      expect(byId(result.shapes, "6").unread).toEqual([
        "table contents: this PowerPoint version cannot read them (needs PowerPointApi 1.10)",
      ]);
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
    expect(result.slide.notes).toMatch(/…\[cut: 1000 more characters\]$/);
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
