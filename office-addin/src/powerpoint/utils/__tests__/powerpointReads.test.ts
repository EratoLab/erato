import { afterEach, describe, expect, it } from "vitest";

import {
  installFakePowerPoint,
  removeFakePowerPoint,
  requirementsUpTo,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import { powerpointReadSupport } from "../powerpointReadSupport";
import {
  MAX_LISTED_SELECTED_SLIDES,
  POWERPOINT_READ_MAX_BYTES,
  readPowerPointPresentation,
  readPowerPointSelection,
  readPowerPointSlide,
} from "../powerpointReads";

import type {
  FakeDeck,
  FakeShape,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import type { PowerPointShapeOut } from "../powerpointShapeRead";
import type { ClientToolExecutionResult } from "@erato/frontend/library";

const FULL = powerpointReadSupport(requirementsUpTo("1.10"));
const BASIC = powerpointReadSupport(requirementsUpTo("1.5"));

afterEach(removeFakePowerPoint);

const title: FakeShape = {
  id: "2",
  name: "Title 1",
  type: "Placeholder",
  role: "Title",
  top: 20,
  left: 40,
  text: "Quarterly review",
};
const bullets: FakeShape = {
  id: "3",
  name: "Content Placeholder 2",
  type: "Placeholder",
  role: "Body",
  top: 120,
  left: 40,
  text: "Revenue up\rEurope\vand Asia\rCosts flat",
  paragraphs: [
    { level: 1, bullet: "Bullet" },
    { level: 2, bullet: "Bullet" },
    { level: 1, bullet: "Bullet" },
  ],
};
const table: FakeShape = {
  id: "4",
  name: "Table 3",
  type: "Table",
  top: 300,
  left: 40,
  table: [
    ["Region", "Q1"],
    ["EU", "10"],
  ],
};
const group: FakeShape = {
  id: "5",
  name: "Group 4",
  type: "Group",
  top: 300,
  left: 500,
  children: [
    { id: "6", type: "TextBox", top: 320, left: 520, text: "Inside" },
    { id: "7", type: "Image", top: 310, left: 600, altTextDescription: "Logo" },
  ],
};
const chart: FakeShape = {
  id: "8",
  name: "Chart 5",
  type: "Chart",
  top: 120,
  left: 500,
  altTextTitle: "Revenue chart",
};
const smartArt: FakeShape = { id: "9", type: "SmartArt", top: 450, left: 40 };

const deck = (): FakeDeck => ({
  slides: [
    {
      id: "256#",
      layout: "Title and Content",
      shapes: [chart, table, group, bullets, title, smartArt],
    },
    {
      id: "257#",
      layout: "Title Only",
      shapes: [{ ...title, id: "20", text: "Next steps" }],
    },
  ],
  selectedSlideIds: ["257#"],
  slideWidth: 960,
  slideHeight: 540,
});

const ok = (read: ClientToolExecutionResult) => {
  if (!read.ok) throw new Error(read.error);
  return read.result as Record<string, unknown>;
};
const shapesOf = (result: unknown) =>
  (result as { shapes: PowerPointShapeOut[] }).shapes;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

describe("one slide, full tier", () => {
  it("reads roles, bullets, tables, groups and details in top-then-left order", async () => {
    installFakePowerPoint(deck());
    const result = ok(await readPowerPointSlide(FULL, { slideId: "256#" }));
    expect(result.tier).toBe("full");
    expect(result.notReadableOnThisHost).toBeUndefined();
    expect(result.slide).toEqual({
      id: "256#",
      position: 1,
      layout: "Title and Content",
    });
    const shapes = shapesOf(result);
    expect(shapes.map((s) => s.id)).toEqual(["2", "3", "8", "4", "5", "9"]);
    expect(shapes[0]).toMatchObject({
      role: "Title",
      text: "Quarterly review",
    });
    expect(shapes[0].holds).toBeUndefined();
    expect(shapes[0].unread).toBeUndefined();
    expect(shapes[2]).toMatchObject({
      type: "Chart",
      altText: { title: "Revenue chart" },
      unread: [expect.stringContaining("chart data")],
    });
    expect(shapes[3].table).toEqual({
      rows: 2,
      columns: 2,
      values: table.table,
    });
    expect(shapes[4].children?.map((c) => c.id)).toEqual(["7", "6"]);
    expect(shapes[4].children?.[1].text).toBe("Inside");
    expect(shapes[4].children?.[0].altText).toEqual({ description: "Logo" });
    expect(shapes[5].unread).toEqual([expect.stringContaining("SmartArt")]);
  });

  it("sends a bulleted shape's text once, in its paragraphs", async () => {
    installFakePowerPoint(deck());
    const [, body] = shapesOf(
      ok(await readPowerPointSlide(FULL, { slideId: "256#" })),
    );
    expect(body.text).toBeUndefined();
    expect(body.paragraphs).toEqual([
      { text: "Revenue up", level: 1, bullet: "Bullet" },
      { text: "Europe\nand Asia", level: 2, bullet: "Bullet" },
      { text: "Costs flat", level: 1, bullet: "Bullet" },
    ]);
  });

  it("reads a table in a placeholder once, without an unread note", async () => {
    installFakePowerPoint({
      slides: [
        {
          id: "256#",
          shapes: [
            {
              id: "2",
              type: "Placeholder",
              role: "Table",
              holds: "Table",
              table: [["a", "b"]],
            },
          ],
        },
      ],
    });
    const [shape] = shapesOf(
      ok(await readPowerPointSlide(FULL, { slideId: "256#" })),
    );
    expect(shape).toMatchObject({
      holds: "Table",
      table: { values: [["a", "b"]] },
    });
    expect(shape.unread).toBeUndefined();
  });

  it("names the paragraphs past 60 whose levels were not read", async () => {
    const text = Array.from({ length: 80 }, (_, i) => `Point ${i + 1}`).join(
      "\r",
    );
    installFakePowerPoint({
      slides: [
        {
          id: "256#",
          shapes: [
            {
              id: "2",
              type: "TextBox",
              text,
              paragraphs: Array.from({ length: 80 }, () => ({
                level: 1,
                bullet: "Bullet",
              })),
            },
          ],
        },
      ],
    });
    const [shape] = shapesOf(
      ok(await readPowerPointSlide(FULL, { slideId: "256#" })),
    );
    expect(shape.paragraphs).toHaveLength(80);
    expect(shape.paragraphs?.[60]).toEqual({ text: "Point 61" });
    expect(shape.unread).toEqual([
      "bullet levels of paragraphs 61-80: not read",
    ]);
  });

  it("marks a shape of an undescribed type instead of returning nothing", async () => {
    installFakePowerPoint({
      slides: [{ id: "256#", shapes: [{ id: "2", type: "Unsupported" }] }],
    });
    for (const support of [FULL, BASIC]) {
      const [shape] = shapesOf(
        ok(await readPowerPointSlide(support, { slideId: "256#" })),
      );
      expect(shape.unread).toEqual([
        "content: PowerPoint does not describe this shape type",
      ]);
    }
  });

  it("reports an unknown slide id as invalid input", async () => {
    installFakePowerPoint(deck());
    const read = await readPowerPointSlide(FULL, { slideId: "999#" });
    expect(read).toMatchObject({
      ok: false,
      validationErrors: [{ path: "/slideId" }],
    });
  });

  it("refuses a missing slide id without touching PowerPoint", async () => {
    const host = installFakePowerPoint(deck());
    const read = await readPowerPointSlide(FULL, {});
    expect(read.ok).toBe(false);
    expect(host.runs).toBe(0);
  });

  it("reads 50 groups in a constant number of syncs", async () => {
    const host = installFakePowerPoint({
      slides: [
        {
          id: "256#",
          shapes: Array.from({ length: 50 }, (_, i) => ({
            id: String(100 + i),
            type: "Group",
            top: i,
            children: [
              { id: `${100 + i}a`, type: "TextBox", text: "a" },
              { id: `${100 + i}b`, type: "Image" },
            ],
          })),
        },
      ],
    });
    const shapes = shapesOf(
      ok(await readPowerPointSlide(FULL, { slideId: "256#" })),
    );
    expect(shapes.every((s) => s.children?.length === 2)).toBe(true);
    expect(host.syncs).toBeLessThanOrEqual(12);
  });
});

describe("one slide, basic tier", () => {
  it("reads text boxes and boxes only, never asking a table, group or chart for text", async () => {
    const host = installFakePowerPoint(deck());
    const result = ok(await readPowerPointSlide(BASIC, { slideId: "256#" }));
    expect(result.tier).toBe("basic");
    expect(result.notReadableOnThisHost).toEqual(
      expect.arrayContaining([
        "placeholder roles (which shape is the title)",
        "table contents",
        "shapes inside groups",
      ]),
    );
    expect(host.textFrameAccesses).not.toContain("4");
    expect(host.textFrameAccesses).not.toContain("5");
    expect(host.textFrameAccesses).not.toContain("8");
    expect(host.failedSyncs).toBe(0);
    const byId = new Map(shapesOf(result).map((s) => [s.id, s]));
    expect(byId.get("2")).toMatchObject({
      text: "Quarterly review",
      box: { left: 40, top: 20, width: 100, height: 50 },
    });
    expect(byId.get("2")?.role).toBeUndefined();
    expect(byId.get("3")?.paragraphs).toBeUndefined();
    expect(byId.get("3")?.text).toBe(
      "Revenue up\nEurope\nand Asia\nCosts flat",
    );
    expect(byId.get("4")?.table).toBeUndefined();
    expect(byId.get("4")?.unread).toEqual([
      "table contents: this PowerPoint version cannot read them (needs PowerPointApi 1.10)",
    ]);
    expect(byId.get("5")?.children).toBeUndefined();
    expect(byId.get("5")?.unread).toEqual([
      "shapes inside groups: this PowerPoint version cannot read them (needs PowerPointApi 1.10)",
    ]);
    expect(byId.get("8")?.unread).toEqual([
      expect.stringContaining("chart data"),
    ]);
    expect(byId.get("2")?.z).toBeUndefined();
  });

  it("reads a PowerPointApi 1.9 host exactly like the basic tier", async () => {
    installFakePowerPoint(deck());
    const at19 = powerpointReadSupport(requirementsUpTo("1.9"));
    expect(ok(await readPowerPointSlide(at19, { slideId: "256#" }))).toEqual(
      ok(await readPowerPointSlide(BASIC, { slideId: "256#" })),
    );
  });

  it("keeps the other shapes when a placeholder holding a picture refuses its text", async () => {
    const host = installFakePowerPoint({
      slides: [
        {
          id: "256#",
          shapes: [
            title,
            { id: "30", type: "Placeholder", holds: "Image", top: 100 },
            { id: "31", type: "TextBox", top: 200, text: "Footnote" },
          ],
        },
      ],
    });
    const shapes = shapesOf(
      ok(await readPowerPointSlide(BASIC, { slideId: "256#" })),
    );
    expect(host.failedSyncs).toBeGreaterThan(0);
    expect(shapes.map((s) => s.text)).toEqual([
      "Quarterly review",
      undefined,
      "Footnote",
    ]);
    expect(shapes[1].unread).toEqual([
      expect.stringContaining("placeholder content"),
    ]);
  });
});

describe("the 20 KB cap", () => {
  it("cuts the shape list and says where to continue", async () => {
    const long = "x".repeat(3000);
    const shapes: FakeShape[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(100 + i),
      type: "TextBox",
      top: i * 10,
      text: long,
    }));
    installFakePowerPoint({ slides: [{ id: "256#", shapes }] });
    const result = ok(await readPowerPointSlide(FULL, { slideId: "256#" }));
    expect(bytes(result)).toBeLessThanOrEqual(POWERPOINT_READ_MAX_BYTES);
    const taken = shapesOf(result).length;
    expect(taken).toBeLessThan(20);
    expect(result.nextStartShape).toBe(taken);
    expect(result.truncated).toContain(`startShape=${taken}`);
    const rest = ok(
      await readPowerPointSlide(FULL, { slideId: "256#", startShape: taken }),
    );
    expect(shapesOf(rest)[0].id).toBe(String(100 + taken));
  });

  it("holds for one large table and names the rows it cut", async () => {
    const values = Array.from({ length: 20 }, () =>
      Array.from({ length: 20 }, () => "c".repeat(100)),
    );
    installFakePowerPoint({
      slides: [
        { id: "256#", shapes: [{ id: "2", type: "Table", table: values }] },
      ],
    });
    const result = ok(await readPowerPointSlide(FULL, { slideId: "256#" }));
    expect(bytes(result)).toBeLessThanOrEqual(POWERPOINT_READ_MAX_BYTES);
    const [shape] = shapesOf(result);
    expect(shape.table!.values.length).toBeLessThan(20);
    expect(shape.unread).toEqual([
      expect.stringMatching(
        /^table rows \d+-20: cut to keep the result small$/,
      ),
    ]);
  });

  it("holds for one group of 40 long text boxes and names the children it cut", async () => {
    installFakePowerPoint({
      slides: [
        {
          id: "256#",
          shapes: [
            {
              id: "2",
              type: "Group",
              children: Array.from({ length: 40 }, (_, i) => ({
                id: `c${i}`,
                type: "TextBox",
                top: i,
                text: "t".repeat(1500),
              })),
            },
          ],
        },
      ],
    });
    const result = ok(await readPowerPointSlide(FULL, { slideId: "256#" }));
    expect(bytes(result)).toBeLessThanOrEqual(POWERPOINT_READ_MAX_BYTES);
    expect(shapesOf(result)[0].unread).toEqual([
      expect.stringMatching(/^group children \d+-40 of 40: cut/),
    ]);
  });

  it("caps a bulleted body like plain text", async () => {
    installFakePowerPoint({
      slides: [
        {
          id: "256#",
          shapes: [
            {
              id: "2",
              type: "TextBox",
              text: Array.from({ length: 30 }, () => "b".repeat(600)).join(
                "\r",
              ),
              paragraphs: Array.from({ length: 30 }, () => ({
                level: 2,
                bullet: "Bullet",
              })),
            },
          ],
        },
      ],
    });
    const result = ok(await readPowerPointSlide(FULL, { slideId: "256#" }));
    const [shape] = shapesOf(result);
    const characters = shape.paragraphs!.reduce((n, p) => n + p.text.length, 0);
    expect(characters).toBeLessThan(4100);
    expect(shape.text).toBeUndefined();
    expect(shape.unread).toEqual([
      expect.stringMatching(/^paragraphs \d+-30: cut/),
    ]);
  });

  it("cuts a very long text inside its shape", async () => {
    installFakePowerPoint({
      slides: [
        {
          id: "256#",
          shapes: [{ id: "2", type: "TextBox", text: "y".repeat(9000) }],
        },
      ],
    });
    const [shape] = shapesOf(
      ok(await readPowerPointSlide(FULL, { slideId: "256#" })),
    );
    expect(shape.text).toMatch(/…\[cut: 5000 more characters\]$/);
  });
});

describe("presentation overview", () => {
  it("lists slides with titles by role, the selection and the slide size on the full tier", async () => {
    installFakePowerPoint(deck());
    expect(ok(await readPowerPointPresentation(FULL, {}))).toMatchObject({
      tier: "full",
      slideCount: 2,
      selectedSlideIds: ["257#"],
      slideSize: { width: 960, height: 540 },
      headingSource: "the slide's title placeholder",
      slides: [
        {
          id: "256#",
          position: 1,
          layout: "Title and Content",
          heading: "Quarterly review",
        },
        {
          id: "257#",
          position: 2,
          layout: "Title Only",
          heading: "Next steps",
        },
      ],
    });
  });

  it("takes the topmost placeholder on the basic tier and says it may not be the title", async () => {
    const host = installFakePowerPoint(deck());
    const result = ok(await readPowerPointPresentation(BASIC, {}));
    expect(result.headingSource).toContain("may be something else");
    expect(result.slideSize).toBeUndefined();
    expect(result.slides).toMatchObject([
      { id: "256#", heading: "Quarterly review" },
      { id: "257#", heading: "Next steps" },
    ]);
    expect(host.textFrameAccesses.sort()).toEqual(["2", "20"]);
  });

  it("never touches a chart placeholder under the title, so 100 such slides cost a few syncs", async () => {
    const host = installFakePowerPoint({
      slides: Array.from({ length: 100 }, (_, i) => ({
        id: `${256 + i}#`,
        shapes: [
          { ...title, id: `t${i}` },
          { id: `c${i}`, type: "Placeholder", holds: "Chart", top: 150 },
        ],
      })),
    });
    const result = ok(await readPowerPointPresentation(BASIC, {}));
    expect((result.slides as unknown[]).length).toBeGreaterThan(0);
    expect(host.failedSyncs).toBe(0);
    expect(host.syncs).toBeLessThanOrEqual(5);
  });

  it("bounds the retries when picture placeholders sit on top", async () => {
    const host = installFakePowerPoint({
      slides: Array.from({ length: 100 }, (_, i) => ({
        id: `${256 + i}#`,
        shapes: [
          ...(i === 7
            ? [{ id: `p${i}`, type: "Placeholder", holds: "Image", top: 0 }]
            : []),
          { ...title, id: `t${i}` },
        ],
      })),
    });
    const result = ok(await readPowerPointPresentation(BASIC, {}));
    expect((result.slides as { heading?: string }[])[7].heading).toBe(
      "Quarterly review",
    );
    expect(host.syncs).toBeLessThanOrEqual(25);
  });

  it("says when the selection could not be read instead of leaving it out", async () => {
    installFakePowerPoint({ ...deck(), selectionFails: true });
    const result = ok(await readPowerPointPresentation(FULL, {}));
    expect(result.selectedSlideIds).toBeUndefined();
    expect(result.unread).toEqual([
      "selected slides: PowerPoint refused to read them",
    ]);
  });

  it("continues from startSlide", async () => {
    installFakePowerPoint(deck());
    const result = ok(
      await readPowerPointPresentation(FULL, { startSlide: 2 }),
    );
    expect((result.slides as { id: string }[]).map((s) => s.id)).toEqual([
      "257#",
    ]);
  });
});

describe("current selection", () => {
  it("returns the selected slides, shapes and text", async () => {
    installFakePowerPoint({
      ...deck(),
      selectedSlideIds: ["256#"],
      selectedShapeIds: ["3"],
      selectedText: "Europe\vand Asia",
    });
    expect(ok(await readPowerPointSelection(FULL))).toMatchObject({
      selectedSlides: [{ id: "256#", position: 1 }],
      selectedText: "Europe\nand Asia",
      selectedShapes: [{ id: "3", role: "Body" }],
    });
  });

  it("leaves selectedText out when no text is selected", async () => {
    installFakePowerPoint({ ...deck(), selectedShapeIds: ["4"] });
    const result = ok(await readPowerPointSelection(BASIC));
    expect(result.selectedText).toBeUndefined();
    expect((result.selectedShapes as PowerPointShapeOut[])[0].unread).toEqual([
      expect.stringContaining("table contents"),
    ]);
  });

  it("names 500 selected slides by count past the first 50", async () => {
    installFakePowerPoint({
      slides: Array.from({ length: 500 }, (_, i) => ({
        id: `${256 + i}#`,
        shapes: [],
      })),
      selectedSlideIds: Array.from({ length: 500 }, (_, i) => `${256 + i}#`),
    });
    const result = ok(await readPowerPointSelection(FULL));
    expect(result.selectedSlides).toHaveLength(MAX_LISTED_SELECTED_SLIDES);
    expect(result.selectedSlideCount).toBe(500);
    expect(bytes(result)).toBeLessThanOrEqual(POWERPOINT_READ_MAX_BYTES);
  });
});
