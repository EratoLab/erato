import { afterEach, describe, expect, it, vi } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import { runWordInPlaceProbe } from "../wordInPlaceProbe";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const CODES = [
  "not-run",
  "error",
  "Off",
  "TrackAll",
  "TrackMineOnly",
  "unknown",
  "PC",
  "Mac",
  "OfficeOnline",
];

describe("in-place native probe", () => {
  it("refuses a document that already has content and writes nothing", async () => {
    const host = installWordOoxmlHost(
      packageXml(paragraph("Someone's real text")),
    );
    const before = host.ooxml();
    const result = await runWordInPlaceProbe({ idleMs: 0 });
    expect(result).toEqual({
      status: "refused",
      reason: "not-empty",
      platform: "OfficeOnline",
      trackingMode: "Off",
      probes: {},
    });
    expect(host.ooxml()).toBe(before);
    expect(host.events.filter((e) => e.startsWith("mutation:"))).toEqual([]);
  });

  it("reports booleans, counts and codes only for an empty scratch document", async () => {
    const host = installWordOoxmlHost(packageXml(paragraph("")), {
      profile: "word-pc-16.0.20326",
    });
    const setter = vi.spyOn(host.document, "changeTrackingMode", "set");
    const result = await runWordInPlaceProbe({ idleMs: 0 });
    expect(result.status).toBe("completed");
    expect(result.platform).toBe("PC");
    expect(result.trackingMode).toBe("Off");
    expect(setter).not.toHaveBeenCalled();
    expect(Object.keys(result.probes).sort()).toEqual(
      [
        "P1",
        "P2",
        "P3",
        "P4",
        "P5",
        "P6",
        "P7",
        "P8",
        "P9",
        "P10",
        "P11",
        "P12",
      ].sort(),
    );
    for (const values of Object.values(result.probes))
      for (const value of Object.values(values ?? {}))
        expect(
          typeof value === "boolean" ||
            typeof value === "number" ||
            CODES.includes(value),
        ).toBe(true);
    expect(result.probes.P2).toMatchObject({
      keepsId: true,
      replaceKeepsFirstRunMarks: true,
      boldWritesBCs: true,
    });
    expect(result.probes.P4).toEqual({
      forwardChanged: true,
      inverseExact: true,
    });
    expect(result.probes.P3).toEqual({ stableWhenIdle: true });
    // What the mock host does; the native run decides which mechanisms ship.
    expect(result.probes.P5).toMatchObject({
      afterInheritsStyle: true,
      afterInheritsDirectFormat: false,
      insertedHasId: true,
    });
    expect(result.probes.P6).toEqual({
      startsClean: true,
      insertInheritsList: true,
      attachKeepsNumId: true,
      listIdIsNumId: true,
      levelWritesIlvl: true,
      detachRemovesNumbering: true,
      detachKeepsStyle: true,
      attachThenStyleKeepsList: true,
      attachThenStyleSetsStyle: true,
    });
    expect(result.probes.P7).toEqual({
      startsClean: true,
      headingTyped: true,
      numberingUnchanged: true,
      stylesAdded: 1,
      inverseExact: true,
    });
    // The mock keeps the final paragraph mark as Word does: the tail is emptied, not removed.
    expect(result.probes.P8).toEqual({
      startsClean: true,
      countDropsByOne: true,
      neighboursUnchanged: true,
      recreateExact: true,
      finalDeleteDropsCount: false,
      finalDeleteKeepsPrevious: false,
    });
    for (const id of ["P9", "P11", "P12"] as const)
      expect(result.probes[id]).toEqual({ result: "not-run" });
    expect(JSON.stringify(result)).not.toContain("Probe");
  });
});
