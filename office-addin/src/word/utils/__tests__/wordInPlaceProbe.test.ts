import { afterEach, describe, expect, it, vi } from "vitest";

import {
  W,
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import {
  editWordPackage,
  installWordOoxmlHost,
} from "../../../test/mocks/word/ooxmlHost";
import {
  SENTINEL,
  realisticWordPackageXml,
} from "../../../test/mocks/word/realisticWordFixtures";
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

  it("measures tracked writes under the developer's own mode and reads an existing header", async () => {
    const host = installWordOoxmlHost(scratchWithHeader(), {
      profile: "word-pc-16.0.20326",
      trackChanges: true,
    });
    host.setTrackingMode("TrackAll");
    const setter = vi.spyOn(host.document, "changeTrackingMode", "set");
    const result = await runWordInPlaceProbe({ idleMs: 0 });
    expect(result.status).toBe("completed");
    expect(result.trackingMode).toBe("TrackAll");
    expect(setter).not.toHaveBeenCalled();
    expect(result.probes.P9).toEqual({
      revisions: 2,
      recordsInsertion: true,
      recordsDeletion: true,
      currentText: true,
      originalText: true,
      textExcludesDeleted: true,
      insertedParagraphTracked: true,
      modeUnchanged: true,
      rejectExact: true,
      rejectRemovesInserted: true,
    });
    expect(result.probes.P10).toMatchObject({ tokensRejoin: true });
    expect(result.probes.P11).toEqual({
      predicted: 1,
      live: 1,
      aligned: true,
      createsNoPart: true,
    });
    expect(JSON.stringify(result)).not.toContain("Probe");
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });
});

/** An empty body with the realistic document's header and footer. */
function scratchWithHeader(): string {
  return editWordPackage(realisticWordPackageXml(), (doc) => {
    const body = doc.getElementsByTagNameNS(W, "body")[0];
    for (const child of Array.from(body.children))
      if (child.localName !== "sectPr") child.remove();
    body.prepend(doc.createElementNS(W, "w:p"));
  });
}
