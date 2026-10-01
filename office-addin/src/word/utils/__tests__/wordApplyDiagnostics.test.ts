import { describe, expect, it } from "vitest";

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
});
