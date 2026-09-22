import { describe, expect, it } from "vitest";

import { packageXml, W } from "../../../test/mocks/word/authoringFixtures";
import { wordDocumentFingerprint } from "../wordDocumentXml";
import { normalizeWordTablesForComparison } from "../wordTableComparison";
import { createWordXmlComparison } from "../wordXmlComparison";

const source = (grid: number[] = [4513, 4513], extra = "") =>
  packageXml(
    `<w:tbl><w:tblPr><w:tblW w:type="pct" w:w="5000"/>${extra}</w:tblPr><w:tblGrid>${grid.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid><w:tr>${[1, 2].map((i) => `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="4500"/></w:tcPr><w:p><w:r><w:t>Cell ${i}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr></w:tbl>`,
  );
const signature = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  normalizeWordTablesForComparison(doc);
  return createWordXmlComparison(doc).signature(
    doc.getElementsByTagNameNS(W, "tbl")[0],
  );
};

describe("semantic AutoFit table comparison", () => {
  it("permits native reflow under a narrower section with unchanged authored widths", () => {
    const before = source();
    const after = source([3350, 3389]);
    expect(signature(before)).toBe(signature(after));
    expect(wordDocumentFingerprint(before)).not.toBe(
      wordDocumentFingerprint(after),
    );
  });
  it("keeps fixed grid widths authoritative, including inherited fixed layout", () => {
    expect(
      signature(source(undefined, '<w:tblLayout w:type="fixed"/>')),
    ).not.toBe(
      signature(source([3350, 3389], '<w:tblLayout w:type="fixed"/>')),
    );
    const styled = (grid: number[]) =>
      source(grid, '<w:tblStyle w:val="Fixed"/>').replace(
        "</w:styles>",
        '<w:style w:type="table" w:styleId="Fixed"><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr></w:style></w:styles>',
      );
    expect(signature(styled([4513, 4513]))).not.toBe(
      signature(styled([3350, 3389])),
    );
  });
  it("keeps every authored width, grid column and layout property", () => {
    const before = source();
    expect(signature(before)).not.toBe(
      signature(source([3350, 3389]).replace('w:w="4500"', 'w:w="4600"')),
    );
    expect(signature(before)).not.toBe(
      signature(source([3350, 3389]).replace('w:w="5000"', 'w:w="4500"')),
    );
    expect(signature(before)).not.toBe(signature(source([3350, 3389, 100])));
    expect(signature(before)).not.toBe(
      signature(source([3350, 3389], '<w:tblLayout w:type="fixed"/>')),
    );
  });
  it("does not discard grid information without independent positive cell constraints", () => {
    for (const transform of [
      (xml: string) => xml.replace(/w:w="4500"/g, 'w:w="0"'),
      (xml: string) => xml.replace(/w:type="dxa"/g, 'w:type="auto"'),
      (xml: string) =>
        xml.replace(
          "<w:tr>",
          '<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>',
        ),
      (xml: string) =>
        xml.replace("<w:tcPr>", '<w:tcPr><w:hMerge w:val="restart"/>'),
      (xml: string) =>
        xml.replace("<w:tblPr>", '<w:tblPr><w:tblStyle w:val="UnknownStyle"/>'),
    ])
      expect(signature(transform(source()))).not.toBe(
        signature(transform(source([3350, 3389]))),
      );
  });
  it("treats only zero border spacing as the omitted default", () => {
    const border =
      '<w:tblBorders><w:top w:val="single" w:sz="8" w:color="112233"/></w:tblBorders>';
    expect(signature(source(undefined, border))).toBe(
      signature(
        source(
          undefined,
          border.replace('w:val="single"', 'w:val="single" w:space="0"'),
        ),
      ),
    );
    expect(signature(source(undefined, border))).not.toBe(
      signature(
        source(
          undefined,
          border.replace('w:val="single"', 'w:val="single" w:space="1"'),
        ),
      ),
    );
  });
});
