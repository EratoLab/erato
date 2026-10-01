import { afterEach, describe, expect, it, vi } from "vitest";

import {
  renderWordDiagnosticReport,
  strictDifferingParts,
  wordErrorText,
  wordPackageStats,
} from "../wordApplyDiagnostics";

const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const pkg = (parts: [string, string][]) =>
  `<pkg:package xmlns:pkg="${PKG}">${parts
    .map(
      ([name, xml]) =>
        `<pkg:part pkg:name="${name}" pkg:contentType="application/xml"><pkg:xmlData>${xml}</pkg:xmlData></pkg:part>`,
    )
    .join("")}</pkg:package>`;
const body = (text: string) =>
  `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;

afterEach(() => vi.unstubAllGlobals());

describe("Word apply diagnostics", () => {
  it("counts package and customXml parts", () => {
    const xml = pkg([
      ["/word/document.xml", body("a")],
      ["/customXml/item1.xml", "<x/>"],
      ["/customXml/item2.xml", "<x/>"],
      ["/customXml/itemProps1.xml", "<x/>"],
    ]);
    expect(wordPackageStats("actual", xml)).toEqual({
      label: "actual",
      parts: 4,
      customXmlItems: 2,
      customProperties: 0,
      abstractNums: 0,
      nums: 0,
      webextensionParts: 0,
    });
  });

  it("names changed and added parts without their content, capped", () => {
    const before = pkg([["/word/document.xml", body("Private before")]]);
    const extra = Array.from(
      { length: 14 },
      (_, i) => [`/customXml/item${i + 1}.xml`, "<x/>"] as [string, string],
    );
    const after = pkg([
      ["/word/document.xml", body("Private after")],
      ...extra,
    ]);
    const result = strictDifferingParts(before, after);
    expect(result.parts).toHaveLength(12);
    expect(result.parts).toContain("/word/document.xml");
    expect(result.partsOmitted).toBe(3);
    expect(JSON.stringify(result)).not.toMatch(/Private/);
  });

  it("keeps only the name of Office errors, which may quote document text", () => {
    expect(
      wordErrorText(
        Object.assign(new Error("private text"), { code: "GeneralException" }),
      ),
    ).toBe("Error");
    expect(
      wordErrorText(new Error("The expanded document is too large.")),
    ).toBe("Error: The expanded document is too large.");
  });

  it("renders a copyable report", () => {
    const report = renderWordDiagnosticReport("apply", "interrupted", {
      stage: "verify",
      reason: "output-mismatch",
      officeCode: "GeneralException",
      details: {
        parts: ["/customXml/item4.xml"],
        partsOmitted: 2,
        packages: [{ label: "actual", parts: 3472, customXmlItems: 1152 }],
      },
    });
    expect(report).toContain("Word add-in apply failed");
    expect(report).toContain("Stage: verify");
    expect(report).toContain("Reason: output-mismatch");
    expect(report).toContain("Office error: GeneralException");
    expect(report).toContain("Differing parts: /customXml/item4.xml (+2 more)");
    expect(report).toContain(
      "Package actual: 3472 parts, 1152 customXml items",
    );
    expect(report).toMatch(/^Host: /m);
  });

  it("reports the verify tier, known adjustment codes, numbering counts and requirement sets", () => {
    vi.stubGlobal("Office", {
      context: {
        diagnostics: { host: "Word", platform: "PC", version: "16.0.20326" },
        requirements: {
          isSetSupported: (_name: string, version: string) => version !== "1.7",
        },
      },
    });
    const report = renderWordDiagnosticReport("apply", "interrupted", {
      stage: "verify",
      reason: "package-growth",
      details: {
        verifyTier: "content",
        adjustments: [
          "numbering-identity",
          "<private>" as never,
          "first-paragraph-spacing",
        ],
        packages: [
          {
            label: "actual",
            parts: 40,
            customXmlItems: 6,
            customProperties: 8,
            abstractNums: 3,
            nums: 7,
            webextensionParts: 0,
          },
        ],
      },
    });
    expect(report).toContain("Reason: package-growth");
    expect(report).toContain("Verify tier: content");
    expect(report).toContain(
      "Adjustments: numbering-identity, first-paragraph-spacing",
    );
    expect(report).not.toContain("<private>");
    expect(report).toContain(
      "Package actual: 40 parts, 6 customXml items, 8 custom properties, 3 abstractNum, 7 num, 0 task pane parts",
    );
    expect(report).toContain(
      "Host: Word PC 16.0.20326 · WordApi 1.6: yes · WordApi 1.7: no",
    );
  });

  it("reports the route, why the import ran, paragraph counts and a partial write without free text", () => {
    vi.stubGlobal("Office", {
      context: {
        diagnostics: { host: "Word", platform: "PC", version: "16.0.20326" },
        requirements: { isSetSupported: () => true },
        document: { url: "file:///report.docx", getFileAsync: () => {} },
      },
    });
    window.WORD_FORCE_IMPORT_APPLY = true;
    try {
      const report = renderWordDiagnosticReport("apply", "interrupted", {
        stage: "write",
        reason: "host-error",
        details: {
          route: "in-place",
          routeReason: "<private>" as never,
          inPlaceOps: 3,
          paragraphs: { predicted: 16, live: 17 },
          partial: { applied: 2, untouched: 1 },
          verifyTier: "block",
        },
      });
      expect(report).toContain("Route: in-place\n");
      expect(report).not.toContain("<private>");
      expect(report).toContain("In-place changes: 3");
      expect(report).toContain("Paragraphs: 16 expected, 17 in Word");
      expect(report).toContain("Partly written: 2 changed, 1 untouched");
      expect(report).toContain("Verify tier: block");
      expect(report).toMatch(/· In-place: off \(disabled\)$/);
      expect(
        renderWordDiagnosticReport("apply", "interrupted", {
          stage: "verify",
          reason: "output-mismatch",
          details: { route: "import", routeReason: "alignment" },
        }),
      ).toContain("Route: import (alignment)");
    } finally {
      delete window.WORD_FORCE_IMPORT_APPLY;
    }
  });
});
