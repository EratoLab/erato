import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  installFakePowerPoint,
  removeFakePowerPoint,
  requirementsUpTo,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import { SAVED_FILE_NOTE } from "../powerpointFileContent";
import { powerpointReadSupport } from "../powerpointReadSupport";
import { readPowerPointSlide } from "../powerpointReads";

import type { FakeDeck } from "../../../test/mocks/powerpoint/fakePowerPoint";
import type { PowerPointShapeOut } from "../powerpointShapeRead";
import type { ClientToolExecutionResult } from "@erato/frontend/library";

// Built and saved by PowerPoint for Windows 16.0.20527 with build-powerpoint-saved-six-slides.ps1
// next to the deck (German Windows, so COM wrote the percent format as "#,#00%"). The live side
// below is what Office.js reported for the same deck in that PowerPoint, so ids, texts and control
// characters are PowerPoint's own.
const FILE = new Uint8Array(
  readFileSync(
    `${process.cwd()}/src/test/fixtures/powerpoint/PowerPoint_Saved_Six_Slides.pptx`,
  ),
);

const title = (text: string) => ({
  id: "2",
  name: "Title 1",
  type: "Placeholder",
  role: "Title",
  text,
});

const LIVE: FakeDeck["slides"] = [
  {
    id: "256#3231780476",
    layout: "Title and Text",
    shapes: [
      title("Quarterly review"),
      {
        id: "3",
        name: "Text Placeholder 2",
        type: "Placeholder",
        role: "Body",
        text: "Revenue grew in every region\rEurope\vled by Germany\rNew customers\rEnterprise\rMid-market\rRisks ahead",
        paragraphs: [0, 1, 0, 1, 2, 0].map((level) => ({ level })),
      },
    ],
  },
  {
    id: "257#1121149395",
    layout: "Title Only",
    shapes: [
      title("Regional figures"),
      {
        id: "3",
        name: "Table 2",
        type: "Table",
        table: [
          ["Region", "Revenue", "Change"],
          ["Europe", "1,240", "+12%\v(best)"],
          ["Asia", "980", "-3%"],
        ],
      },
    ],
  },
  {
    id: "258#3951154745",
    layout: "Title Only",
    shapes: [
      title("Conversion rate"),
      { id: "3", name: "Chart 2", type: "Chart" },
    ],
  },
  {
    id: "259#2478323431",
    layout: "Title Only",
    shapes: [
      title("Project phases"),
      { id: "3", name: "Diagram 2", type: "SmartArt" },
    ],
  },
  {
    id: "260#1261169432",
    layout: "Title Only",
    shapes: [
      title("Team"),
      {
        id: "7",
        name: "Org chart",
        type: "Group",
        children: [
          { id: "3", name: "Lead box", type: "GeometricShape", text: "Lead" },
          {
            id: "6",
            name: "Members",
            type: "Group",
            children: [
              {
                id: "4",
                name: "Engineer box",
                type: "GeometricShape",
                text: "Engineer",
              },
              {
                id: "5",
                name: "Designer box",
                type: "GeometricShape",
                text: "Designer",
              },
            ],
          },
        ],
      },
      {
        id: "9",
        name: "Logo",
        type: "Image",
        altTextDescription: "Company logo",
      },
    ],
  },
  {
    id: "261#219885122",
    layout: "Title and 2-Column Text",
    shapes: [
      title(""),
      {
        id: "3",
        name: "Text Placeholder 2",
        type: "Placeholder",
        role: "Body",
        text: "Keep\rWeekly sync\rShared roadmap",
      },
      {
        id: "4",
        name: "Text Placeholder 3",
        type: "Placeholder",
        role: "Body",
        text: "Drop\rMonthly report\rManual exports",
      },
    ],
  },
];

// Office LTSC 2024 on Windows: the whole file is the only route, and it is not measured there.
const BASIC = powerpointReadSupport(requirementsUpTo("1.5"), {
  fileApi: true,
  platform: "PC",
});
// The measured host; without slide exports in the fake, reads fall back to the whole file.
const FULL_ON_WINDOWS = powerpointReadSupport(requirementsUpTo("1.10"), {
  fileApi: true,
  platform: "PC",
});

afterEach(() => removeFakePowerPoint());

const read = async (slideId: string, support = BASIC) => {
  const host = installFakePowerPoint({ slides: LIVE, file: { bytes: FILE } });
  const result: ClientToolExecutionResult = await readPowerPointSlide(support, {
    slideId,
  });
  expect(host.openFiles).toBe(0);
  if (!result.ok) throw new Error(result.error);
  return result.result as {
    slide: Record<string, unknown> & { unread?: string[] };
    shapes: PowerPointShapeOut[];
  };
};
const byId = (shapes: PowerPointShapeOut[], id: string) =>
  shapes.find((shape) => shape.id === id)!;

describe("a deck PowerPoint saved itself, read from the whole file", () => {
  it("matches every slide to the file, with notes only where the slide has them", async () => {
    const notes: Record<string, unknown> = {};
    for (const slide of LIVE) {
      const result = await read(slide.id);
      expect(result.slide.unread).toBeUndefined();
      expect(result.slide.fileContent).toBe(SAVED_FILE_NOTE);
      notes[slide.id] = result.slide.notes;
    }
    expect(Object.values(notes)).toEqual([
      "Open with the numbers.\nThen ask for questions.",
      "",
      "April is the record month.",
      "",
      "",
      "",
    ]);
  });

  it("keeps a soft line break in a table cell", async () => {
    const { shapes } = await read("257#1121149395");
    expect(byId(shapes, "3").table?.values[1]).toEqual([
      "Europe",
      "1,240",
      "+12%\n(best)",
    ]);
  });

  it("gives chart categories saved as dates as dates, with the values as saved", async () => {
    const { shapes } = await read("258#3951154745");
    expect(byId(shapes, "3").chart).toMatchObject({
      type: "line",
      title: "Conversion rate 2026",
      categories: ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"],
      series: [{ name: "Conversion", values: [0.12, 0.155, 0.18, 0.205] }],
    });
  });

  it("reads SmartArt text in node order", async () => {
    const { shapes } = await read("259#2478323431");
    expect(byId(shapes, "3").smartArt?.map((node) => node.text)).toEqual([
      "Plan",
      "Build",
      "Pilot with two teams",
      "Launch",
    ]);
  });

  it("fills a nested group from the file and reports the slide as hidden", async () => {
    const { slide, shapes } = await read("260#1261169432");
    expect(slide.hidden).toBe(true);
    const group = byId(shapes, "7");
    expect(group.children?.map((child) => child.id)).toEqual(["3", "6"]);
    expect(
      byId(group.children!, "6").children?.map((child) => child.text),
    ).toEqual(["Engineer", "Designer"]);
  });

  it("does not take an empty title as a difference from the file", async () => {
    const { slide, shapes } = await read("261#219885122");
    expect(slide.unread).toBeUndefined();
    expect(byId(shapes, "4").text).toBe("Drop\nMonthly report\nManual exports");
  });

  it("does not label the content as saved on Microsoft 365 for Windows, where the file includes unsaved edits", async () => {
    const { slide } = await read("256#3231780476", FULL_ON_WINDOWS);
    expect(slide.fileContent).toBeUndefined();
    expect(slide.notes).toBe("Open with the numbers.\nThen ask for questions.");
  });
});
