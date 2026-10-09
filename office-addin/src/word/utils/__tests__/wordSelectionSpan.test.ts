import { afterEach, describe, expect, it } from "vitest";

import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import {
  scanWordSelectionSpan,
  wordSelectionStyleToggles,
} from "../wordSelectionSpan";

import type {
  MockSelectionDocument,
  MockSelectionTarget,
} from "../../../test/mocks/word/selectionHost";

const HOSTS = ["mac", "pc", "web"] as const;

afterEach(uninstallWordSelectionHost);

const DOC: MockSelectionDocument = {
  body: [
    "PL Plain words here.",
    { runs: [{ text: "AB All bold words.", font: { bold: true } }] },
    { runs: ["MB ", { text: "Mixed", font: { bold: true } }, " bold words."] },
    {
      runs: [
        { text: "CL Colored words.", font: { color: "#C00000", size: 14 } },
      ],
    },
    {
      runs: ["CP ", { text: "Part", font: { color: "#C00000" } }, " colored."],
    },
    {
      runs: [
        { text: "HL Highlighted words.", font: { highlightColor: "Yellow" } },
      ],
    },
    {
      runs: [
        "CS ",
        { text: "cs size", font: { sizeBidirectional: 20 } },
        " only.",
      ],
    },
    {
      runs: [
        {
          text: "TW Twin bold.",
          font: { bold: true, boldBidirectional: true },
        },
      ],
    },
    { runs: ["RS ", { text: "styled", rStyle: "Strong" }, " words."] },
    { runs: ["RL ", { text: "right", font: { rtl: true } }, " to left."] },
    { runs: "HD Heading words.", style: "Heading 1" },
  ],
};

describe.each(HOSTS)("scanWordSelectionSpan on %s", (host) => {
  const scan = (target: MockSelectionTarget, document = SV2_MAIN_DOCUMENT) =>
    scanWordSelectionSpan(
      installWordSelectionHost(document, {
        host,
        styles: { Strong: { type: "character", font: { bold: true } } },
      }).ooxml(target),
    );

  it("finds nothing in a plain paragraph", () => {
    expect(scan({ p: "PL1" })).toEqual({ hazards: {}, format: {} });
  });

  it.each([
    ["MX1", "hyperlink"],
    ["FD1", "field"],
    ["HT1", "hiddenText"],
    ["TC1", "trackedChange"],
    ["CM1", "commentMark"],
    ["FN1", "noteReference"],
    ["PC1", "inlinePicture"],
  ] as const)("reports %s's hazard as %s", (p, hazard) => {
    expect(scan({ p }).hazards).toMatchObject({ [hazard]: true });
  });

  it("reads a uniform direct property as direct and a partial one as mixed", () => {
    expect(scan({ p: "AB" }, DOC).format).toEqual({
      bold: { state: "direct", value: true },
    });
    expect(scan({ p: "MB" }, DOC).format).toEqual({ bold: { state: "mixed" } });
    expect(scan({ p: "CL" }, DOC).format).toEqual({
      color: { state: "direct", value: "#C00000" },
      size: { state: "direct", value: 14 },
    });
    expect(scan({ p: "CP" }, DOC).format).toEqual({
      color: { state: "mixed" },
    });
    expect(scan({ p: "HL" }, DOC).format).toEqual({
      highlightColor: { state: "direct", value: "#FFFF00" },
    });
  });

  it("treats complex-script formatting that differs from its Latin value as a hazard", () => {
    expect(scan({ p: "CS" }, DOC).hazards).toEqual({ complexScript: true });
    expect(scan({ p: "RL" }, DOC).hazards).toEqual({ complexScript: true });
    expect(scan({ p: "RT1" }).hazards).toMatchObject({ complexScript: true });
    expect(scan({ p: "TW" }, DOC).hazards).toEqual({});
  });

  it("refuses a character style", () => {
    expect(scan({ p: "RS" }, DOC).hazards).toEqual({
      unsupportedFormatting: true,
    });
  });

  it("fails closed on a package it cannot read", () => {
    expect(scanWordSelectionSpan("<not ooxml").hazards).toEqual({
      unsupportedFormatting: true,
    });
  });
});

describe.each(HOSTS)("wordSelectionStyleToggles on %s", (host) => {
  it("resolves the paragraph style's toggles by pStyle or by name", () => {
    const word = installWordSelectionHost(DOC, { host });
    const heading = word.ooxml({ p: "HD" });
    expect(
      wordSelectionStyleToggles(
        heading,
        host === "web" ? "heading 1" : "Heading 1",
      ),
    ).toMatchObject({ bold: true, italic: false, underline: "None" });
    expect(
      wordSelectionStyleToggles(word.ooxml({ p: "PL" }), "Normal"),
    ).toMatchObject({ bold: false, italic: false });
    expect(
      wordSelectionStyleToggles(word.ooxml({ p: "PL" }), "No Such Style"),
    ).toBeNull();
  });
});
