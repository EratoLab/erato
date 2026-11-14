import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installFakePowerPoint,
  removeFakePowerPoint,
  requirementsUpTo,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import {
  POWERPOINT_READ_PRESENTATION_TOOL,
  POWERPOINT_READ_SELECTION_TOOL,
  POWERPOINT_READ_SLIDE_TOOL,
  registerPowerPointClientTools,
} from "../powerpointClientTools";
import {
  powerpointPresentationName,
  readPowerPointSelectionSummary,
  resolvePowerPointFacet,
  POWERPOINT_PRESENTATION_FACET_ID,
} from "../powerpointFacet";
import { powerpointReadSupport } from "../powerpointReadSupport";

import type { ClientToolExecutor } from "@erato/frontend/library";

const mocks = vi.hoisted(() => ({
  registered: [] as {
    name: string;
    executor: ClientToolExecutor;
    isAvailable: () => boolean;
  }[],
}));
vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    registerClientToolExecutor: (
      name: string,
      executor: ClientToolExecutor,
      isAvailable: () => boolean = () => true,
    ) => {
      mocks.registered.push({ name, executor, isAvailable });
      return () => {};
    },
  });
});

afterEach(() => {
  mocks.registered.length = 0;
  removeFakePowerPoint();
});

const FULL = powerpointReadSupport(requirementsUpTo("1.10"));
const DECK = {
  slides: [
    {
      id: "256#",
      shapes: [{ id: "2", name: "Title 1", type: "TextBox", text: "Hello" }],
    },
  ],
  selectedSlideIds: ["256#"],
  selectedShapeIds: ["2"],
};
const tool = (name: string) =>
  mocks.registered.find((entry) => entry.name === name)!;

describe("PowerPoint client tool registration", () => {
  it("registers only the reads the host can do", () => {
    registerPowerPointClientTools({
      support: powerpointReadSupport(requirementsUpTo("1.4")),
      readEnabled: () => true,
      listed: () => true,
    });
    expect(mocks.registered.map((entry) => entry.name)).toEqual([
      POWERPOINT_READ_PRESENTATION_TOOL,
      POWERPOINT_READ_SLIDE_TOOL,
    ]);
  });

  it("registers nothing below PowerPointApi 1.4", () => {
    registerPowerPointClientTools({
      support: powerpointReadSupport(requirementsUpTo("1.3")),
      readEnabled: () => true,
      listed: () => true,
    });
    expect(mocks.registered).toEqual([]);
  });

  it("lists the tools only while the presentation goes with the turn", () => {
    let listed = false;
    registerPowerPointClientTools({
      support: FULL,
      readEnabled: () => listed,
      listed: () => listed,
    });
    expect(mocks.registered.map((entry) => entry.isAvailable())).toEqual([
      false,
      false,
      false,
    ]);
    listed = true;
    expect(mocks.registered.every((entry) => entry.isAvailable())).toBe(true);
  });

  it("answers that inclusion is off, without reading, once the user turned it off", async () => {
    const host = installFakePowerPoint(DECK);
    registerPowerPointClientTools({
      support: FULL,
      readEnabled: () => false,
      listed: () => true,
    });
    for (const name of [
      POWERPOINT_READ_PRESENTATION_TOOL,
      POWERPOINT_READ_SLIDE_TOOL,
      POWERPOINT_READ_SELECTION_TOOL,
    ]) {
      await expect(tool(name).executor({ slideId: "256#" })).resolves.toEqual({
        ok: false,
        error: "Presentation inclusion is off.",
      });
    }
    expect(host.runs).toBe(0);
  });

  it("reads when included", async () => {
    installFakePowerPoint(DECK);
    registerPowerPointClientTools({
      support: FULL,
      readEnabled: () => true,
      listed: () => true,
    });
    const read = await tool(POWERPOINT_READ_SLIDE_TOOL).executor({
      slideId: "256#",
    });
    expect(read).toMatchObject({ ok: true, result: { tier: "full" } });
  });
});

describe("PowerPoint facet", () => {
  const available = new Set([POWERPOINT_PRESENTATION_FACET_ID]);
  const args = new Map([
    [
      POWERPOINT_PRESENTATION_FACET_ID,
      new Set(["presentation_name", "read_tier", "selection_summary"]),
    ],
  ]);

  it("goes only when the server advertises it, with the advertised args", () => {
    const facet = resolvePowerPointFacet({
      support: powerpointReadSupport(requirementsUpTo("1.5")),
      presentationName: "Q3",
      selectionSummary: "Nothing is selected.",
      availableFacetIds: available,
      availableFacetArgs: new Map([
        [
          POWERPOINT_PRESENTATION_FACET_ID,
          new Set(["presentation_name", "read_tier"]),
        ],
      ]),
    });
    expect(facet).toEqual({
      id: POWERPOINT_PRESENTATION_FACET_ID,
      args: {
        presentation_name: "Q3",
        read_tier: expect.stringMatching(
          /^basic \(PowerPointApi 1\.5\); this host cannot read placeholder roles/,
        ),
      },
    });
    expect(
      resolvePowerPointFacet({
        support: FULL,
        presentationName: "Q3",
        selectionSummary: "",
        availableFacetIds: new Set(),
        availableFacetArgs: args,
      }),
    ).toBeUndefined();
  });

  it("summarises the selection by position, id and shape name", async () => {
    installFakePowerPoint(DECK);
    await expect(readPowerPointSelectionSummary(FULL)).resolves.toBe(
      'Selected slides: 1 (id 256#); selected shapes: "Title 1" (id 2).',
    );
  });

  it("names the presentation after its file", () => {
    expect(
      powerpointPresentationName(
        "https://contoso.sharepoint.com/sites/x/Shared%20Documents/Q3%20Review.pptx?web=1",
      ),
    ).toBe("Q3 Review");
    expect(powerpointPresentationName("C:\\Decks\\Plan.pptm")).toBe("Plan");
    expect(powerpointPresentationName(undefined)).toBe("Presentation");
  });
});

describe("PowerPoint manifest", () => {
  it("declares no minimum PowerPoint API set, so LTSC keeps the add-in", () => {
    const manifest = readFileSync(
      path.resolve(
        __dirname,
        "../../../../manifests/manifest-local-powerpoint.xml",
      ),
      "utf8",
    );
    expect(manifest).not.toMatch(/PowerPointApi/);
    expect(manifest).not.toMatch(/<Requirements>/);
  });
});
