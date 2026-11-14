import { afterEach, describe, expect, it } from "vitest";

import {
  installFakePowerPoint,
  removeFakePowerPoint,
  requirementsUpTo,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import { powerpointReadSupport } from "../powerpointReadSupport";
import {
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
const smartArt: FakeShape = {
  id: "9",
  type: "SmartArt",
  top: 450,
  left: 40,
};

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

const shapesOf = (result: unknown) =>
  (result as { shapes: PowerPointShapeOut[] }).shapes;

describe("one slide, full tier", () => {
  it("reads roles, bullets, tables, groups and details in top-then-left order", async () => {
    installFakePowerPoint(deck());
    const read = await readPowerPointSlide(FULL, { slideId: "256#" });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const result = read.result as Record<string, unknown>;
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
    expect(shapes[1].text).toBe("Revenue up\nEurope\nand Asia\nCosts flat");
    expect(shapes[1].paragraphs).toEqual([
      { text: "Revenue up", level: 1, bullet: "Bullet" },
      { text: "Europe\nand Asia", level: 2, bullet: "Bullet" },
      { text: "Costs flat", level: 1, bullet: "Bullet" },
    ]);
    expect(shapes[2]).toMatchObject({
      type: "Chart",
      altText: { title: "Revenue chart" },
      unread: [expect.stringContaining("chart data")],
    });
    expect(shapes[2].text).toBeUndefined();
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
});

describe("one slide, basic tier", () => {
  it("reads text boxes and boxes only, never asking a table, group or chart for text", async () => {
    const host = installFakePowerPoint(deck());
    const read = await readPowerPointSlide(BASIC, { slideId: "256#" });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const result = read.result as Record<string, unknown>;
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
    const shapes = shapesOf(result);
    const byId = new Map(shapes.map((s) => [s.id, s]));
    expect(byId.get("2")).toMatchObject({
      text: "Quarterly review",
      box: { left: 40, top: 20, width: 100, height: 50 },
    });
    expect(byId.get("2")?.role).toBeUndefined();
    expect(byId.get("3")?.paragraphs).toBeUndefined();
    expect(byId.get("4")?.table).toBeUndefined();
    expect(byId.get("4")?.unread).toEqual([
      expect.stringContaining("table contents: this PowerPoint version"),
    ]);
    expect(byId.get("5")?.children).toBeUndefined();
    expect(byId.get("5")?.unread).toEqual([
      expect.stringContaining("group children: this PowerPoint version"),
    ]);
    expect(byId.get("8")?.unread).toEqual([
      expect.stringContaining("chart data"),
    ]);
    expect(byId.get("2")?.z).toBeUndefined();
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
    const read = await readPowerPointSlide(BASIC, { slideId: "256#" });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const shapes = shapesOf(read.result);
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

describe("truncation", () => {
  it("cuts the shape list under the byte cap and says where to continue", async () => {
    const long = "x".repeat(3000);
    const shapes: FakeShape[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(100 + i),
      type: "TextBox",
      top: i * 10,
      text: long,
    }));
    installFakePowerPoint({ slides: [{ id: "256#", shapes }] });
    const first = await readPowerPointSlide(FULL, { slideId: "256#" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const result = first.result as Record<string, unknown>;
    expect(
      new TextEncoder().encode(JSON.stringify(result)).length,
    ).toBeLessThanOrEqual(POWERPOINT_READ_MAX_BYTES);
    const taken = shapesOf(result).length;
    expect(taken).toBeLessThan(20);
    expect(result.nextStartShape).toBe(taken);
    expect(result.truncated).toContain(`startShape=${taken}`);

    const rest = await readPowerPointSlide(FULL, {
      slideId: "256#",
      startShape: taken,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(shapesOf(rest.result)[0].id).toBe(String(100 + taken));
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
    const read = await readPowerPointSlide(FULL, { slideId: "256#" });
    if (!read.ok) throw new Error(read.error);
    expect(shapesOf(read.result)[0].text).toMatch(
      /…\[cut: 5000 more characters\]$/,
    );
  });
});

describe("presentation overview", () => {
  it("lists slides with titles by role, the selection and the slide size on the full tier", async () => {
    installFakePowerPoint(deck());
    const read = await readPowerPointPresentation(FULL, {});
    if (!read.ok) throw new Error(read.error);
    expect(read.result).toMatchObject({
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
    const read = await readPowerPointPresentation(BASIC, {});
    if (!read.ok) throw new Error(read.error);
    const result = read.result as Record<string, unknown>;
    expect(result.headingSource).toContain("may be something else");
    expect(result.slideSize).toBeUndefined();
    expect(result.slides).toMatchObject([
      { id: "256#", heading: "Quarterly review" },
      { id: "257#", heading: "Next steps" },
    ]);
    expect(
      host.textFrameAccesses.every((id) => ["2", "3", "20"].includes(id)),
    ).toBe(true);
  });

  it("continues from startSlide", async () => {
    installFakePowerPoint(deck());
    const read = await readPowerPointPresentation(FULL, { startSlide: 2 });
    if (!read.ok) throw new Error(read.error);
    expect(
      (read.result as { slides: { id: string }[] }).slides.map((s) => s.id),
    ).toEqual(["257#"]);
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
    const read = await readPowerPointSelection(FULL);
    if (!read.ok) throw new Error(read.error);
    expect(read.result).toMatchObject({
      selectedSlides: [{ id: "256#", position: 1 }],
      selectedText: "Europe\nand Asia",
      selectedShapes: [{ id: "3", role: "Body" }],
    });
  });

  it("leaves selectedText out when no text is selected", async () => {
    installFakePowerPoint({ ...deck(), selectedShapeIds: ["4"] });
    const read = await readPowerPointSelection(BASIC);
    if (!read.ok) throw new Error(read.error);
    const result = read.result as Record<string, unknown>;
    expect(result.selectedText).toBeUndefined();
    expect(shapesOf({ shapes: result.selectedShapes })[0].unread).toEqual([
      expect.stringContaining("table contents"),
    ]);
  });
});
