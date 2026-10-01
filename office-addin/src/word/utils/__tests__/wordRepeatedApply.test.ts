import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  duplicateWordCustomXml,
  editWordPackage,
  installWordOoxmlHost,
} from "../../../test/mocks/word/ooxmlHost";
import {
  captureRealisticSnapshot,
  realisticWordPackageXml,
  statusRewritePlan,
} from "../../../test/mocks/word/realisticWordFixtures";
import { renderWordDiagnosticReport } from "../wordApplyDiagnostics";
import {
  applyWordDocumentPlan,
  revertWordDocumentPlan,
} from "../wordApplyDocumentPlan";
import {
  wordDocumentFileToOoxml,
  wordDocumentOoxmlToFile,
} from "../wordDocumentPackage";
import { wordDocumentFingerprint } from "../wordDocumentXml";
import { wordPackageCounts } from "../wordFullDocumentComparison";

import type { WordOoxmlHostOptions } from "../../../test/mocks/word/ooxmlHost";
import type { WordDocumentApplyResult } from "../wordApplyDocumentPlan";

afterEach(() => vi.unstubAllGlobals());

/** Shape that must not change: parts other than Word's own task-pane records, customXml, custom properties. */
const shape = (ooxml: string) => {
  const counts = wordPackageCounts(ooxml);
  return {
    parts: counts.parts - counts.webextensionParts,
    customXmlItems: counts.customXmlItems,
    customProperties: counts.customProperties,
  };
};
/** In place nothing but the touched paragraphs may change: not even Word's own records or numbering. */
const fullShape = (ooxml: string) => {
  const counts = wordPackageCounts(ooxml);
  return {
    parts: counts.parts,
    customXmlItems: counts.customXmlItems,
    customProperties: counts.customProperties,
    abstractNums: counts.abstractNums,
    nums: counts.nums,
    webextensionParts: counts.webextensionParts,
  };
};

async function applyCycles(options: WordOoxmlHostOptions, cycles: number) {
  const host = installWordOoxmlHost(realisticWordPackageXml(), options);
  const shapes = [shape(host.ooxml())];
  const results: WordDocumentApplyResult[] = [];
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const snapshot = await captureRealisticSnapshot(`message-${cycle}`);
    expect(snapshot.issue).toBeUndefined();
    const result = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, `Status update ${cycle}.`)),
      snapshot,
      `message-${cycle}`,
    );
    results.push(result);
    if (result.status !== "applied") break;
    shapes.push(shape(host.ooxml()));
  }
  return { host, shapes, results };
}

// Each cycle captures, compiles, imports and verifies a complete DOCX twice over.
describe("repeated full-document Apply", { timeout: 60_000 }, () => {
  // The status rewrite is in-place eligible; these cases exercise the import fallback.
  beforeEach(() => {
    window.WORD_FORCE_IMPORT_APPLY = true;
  });
  afterEach(() => {
    delete window.WORD_FORCE_IMPORT_APPLY;
  });
  it("verifies every Word PC import at the content tier without growing the package, then reverts", async () => {
    const { host, shapes, results } = await applyCycles(
      {
        profile: "word-pc-16.0.20326",
        rePointKeptLists: true,
        spacingDrift: true,
      },
      5,
    );
    for (const result of results) {
      expect(
        result.status,
        renderWordDiagnosticReport("apply", result.status, result.diagnostic),
      ).toBe("applied");
      expect(result.outcome).toEqual({
        route: "import",
        tier: "content",
        adjustments: [
          "numbering-identity",
          "list-instance-renumbered",
          "first-paragraph-spacing",
        ],
      });
    }
    expect(results).toHaveLength(5);
    expect(host.importOptions).toHaveLength(5);
    for (const options of host.importOptions)
      expect(options).toMatchObject({
        importCustomXmlParts: false,
        importCustomProperties: false,
      });
    expect(new Set(shapes.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(shapes[0]).toMatchObject({ customXmlItems: 3, customProperties: 4 });
    expect(wordPackageCounts(host.ooxml()).webextensionParts).toBe(0);
    expect(host.ooxml()).toContain("Status update 5.");

    const last = results.at(-1)!;
    const reverted = await revertWordDocumentPlan(
      last.before!,
      last.afterFingerprint!,
    );
    expect(
      reverted.status,
      renderWordDiagnosticReport(
        "revert",
        reverted.status,
        reverted.diagnostic,
      ),
    ).toBe("reverted");
    expect(reverted.outcome).toMatchObject({
      route: "import",
      tier: "content",
    });
    expect(host.ooxml()).toContain("Status update 4.");
    expect(shape(host.ooxml())).toEqual(shapes[0]);
  });

  it("stops with a package-growth report when Word duplicates customXml despite the import options", async () => {
    const { host, results } = await applyCycles(
      { profile: "word-pc-16.0.20326", ignoreImportOptions: true },
      1,
    );
    const [result] = results;
    expect(result.status).toBe("interrupted");
    expect(result.diagnostic).toMatchObject({
      stage: "verify",
      reason: "package-growth",
    });
    expect(result.before).toBeTruthy();
    const items = Object.fromEntries(
      result.diagnostic!.details!.packages!.map((p) => [
        p.label,
        p.customXmlItems,
      ]),
    );
    expect(items).toEqual({ live: 3, expected: 3, actual: 6 });
    const report = renderWordDiagnosticReport(
      "apply",
      result.status,
      result.diagnostic,
    );
    expect(report).toContain("Reason: package-growth");
    expect(report).toMatch(/^Package live: \d+ parts, 3 customXml items/m);
    expect(report).toMatch(/^Package expected: \d+ parts, 3 customXml items/m);
    expect(report).toMatch(/^Package actual: \d+ parts, 6 customXml items/m);
    expect(wordPackageCounts(host.ooxml()).customXmlItems).toBe(6);
  });

  it("cannot restore away customXml that Word duplicated during an Apply", async () => {
    const host = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const snapshot = await captureRealisticSnapshot("message-1");
    host.transform((bytes) =>
      wordDocumentOoxmlToFile(
        editWordPackage(wordDocumentFileToOoxml(bytes), duplicateWordCustomXml),
      ),
    );
    const applied = await applyWordDocumentPlan(
      JSON.stringify(statusRewritePlan(snapshot, "Status update.")),
      snapshot,
      "message-1",
    );
    expect(applied.status).toBe("interrupted");
    expect(applied.diagnostic).toMatchObject({
      stage: "verify",
      reason: "package-growth",
    });
    host.transform((bytes) => bytes);
    const reverted = await revertWordDocumentPlan(
      applied.before!,
      applied.afterFingerprint!,
    );
    expect(reverted.status).toBe("interrupted");
    expect(reverted.diagnostic).toMatchObject({
      stage: "restore",
      reason: "package-growth",
    });
    expect(host.importOptions).toHaveLength(2);
    expect(host.importOptions[1]).toMatchObject({
      importCustomXmlParts: false,
      importCustomProperties: false,
    });
    expect(shape(host.ooxml())).toMatchObject({
      customXmlItems: 6,
      customProperties: 4,
    });
  });

  it("verifies every Word for the web import strictly", async () => {
    const { shapes, results } = await applyCycles({ profile: "word-web" }, 5);
    expect(results.map((r) => r.status)).toEqual(Array(5).fill("applied"));
    for (const result of results)
      expect(result.outcome).toEqual({
        route: "import",
        tier: "strict",
        adjustments: [],
      });
    expect(new Set(shapes.map((s) => JSON.stringify(s))).size).toBe(1);
  });
});

describe("repeated in-place Apply", { timeout: 60_000 }, () => {
  it("keeps every package count constant on Word PC and reverts the last write exactly", async () => {
    const { host, results } = await applyCycles(
      {
        profile: "word-pc-16.0.20326",
        rePointKeptLists: true,
        spacingDrift: true,
      },
      5,
    );
    expect(results.map((r) => r.status)).toEqual(Array(5).fill("applied"));
    for (const result of results)
      expect(result.outcome).toEqual({
        route: "in-place",
        tier: "block",
        adjustments: [],
        ops: 1,
      });
    expect(host.insert).not.toHaveBeenCalled();
    expect(fullShape(host.ooxml())).toEqual(
      fullShape(realisticWordPackageXml()),
    );
    expect(fullShape(host.ooxml())).toMatchObject({
      customXmlItems: 3,
      webextensionParts: 3,
    });
    const beforeLast = wordDocumentFingerprint(
      editWordPackage(host.ooxml(), (doc) => {
        const text = Array.from(
          doc.getElementsByTagNameNS(
            "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            "t",
          ),
        ).find((t) => t.textContent === "Status update 5.")!;
        text.textContent = "Status update 4.";
      }),
    );
    const last = results.at(-1)!;
    const reverted = await revertWordDocumentPlan(
      last.before!,
      last.afterFingerprint!,
    );
    expect(reverted.status).toBe("reverted");
    expect(wordDocumentFingerprint(host.ooxml())).toBe(beforeLast);
  });
});
