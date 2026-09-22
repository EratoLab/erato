import { describe, expect, it } from "vitest";

import expectedFormatting from "../../../test/fixtures/word-rich-native/formatting-expected.xml?raw";
import observedFormatting from "../../../test/fixtures/word-rich-native/formatting-observed.xml?raw";
import oldTableExpected from "../../../test/fixtures/word-rich-native/table-patch-before-canonicalization.xml?raw";
import observedTable from "../../../test/fixtures/word-rich-native/table-patch-observed.xml?raw";
import {
  packageXml,
  paragraph,
  W,
} from "../../../test/mocks/word/authoringFixtures";
import {
  captureWordAuthoringSnapshot,
  sameWordBodyContent,
  wordDocumentFingerprint,
} from "../wordDocumentXml";
import {
  compileWordTableBlock,
  readWordTableContent,
} from "../wordTableContent";

const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const parse = (value: string) =>
  new DOMParser().parseFromString(value, "application/xml");
const all = (parent: Element | Document, name: string) =>
  Array.from(parent.getElementsByTagNameNS(W, name));
const change = (value: string, mutate: (doc: Document) => void) => {
  const doc = parse(value);
  mutate(doc);
  return new XMLSerializer().serializeToString(doc);
};
const matches = (before: string, after: string) =>
  sameWordBodyContent(
    captureWordAuthoringSnapshot(
      before,
      "native-formatting-fixture",
      "Off",
      true,
    ),
    captureWordAuthoringSnapshot(
      after,
      "native-formatting-fixture",
      "Off",
      true,
    ),
  );
const base = () =>
  packageXml(
    '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/></w:rPr><w:t>Formatted source</w:t></w:r></w:p>' +
      '<w:sdt><w:sdtPr><w:id w:val="42"/><w:alias w:val="Client"/></w:sdtPr><w:sdtEndPr/><w:sdtContent>' +
      paragraph("Client text") +
      "</w:sdtContent></w:sdt>",
  )
    .replace('w:styleId="Normal"', 'w:styleId="Normal" w:default="1"')
    .replace(
      "</pkg:package>",
      `<pkg:part pkg:name="/word/fontTable.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"><pkg:xmlData><w:fonts xmlns:w="${W}"><w:font w:name="Aptos"><w:family w:val="swiss"/><w:charset w:val="00"/></w:font></w:fonts></pkg:xmlData></pkg:part></pkg:package>`,
    );

describe("native full-document formatting normalization", () => {
  it("emits the centered-table row properties Word serializes, and removes ignored indentation", () => {
    const doc = parse(oldTableExpected);
    const source = all(doc, "tbl")[0];
    const inventory = readWordTableContent(source);
    const rebuilt = compileWordTableBlock(
      doc,
      {
        id: "centered-table",
        type: "table",
        text: "",
        sourceRef: "source-table",
        format: { alignment: "center", shading: "EAF2F8" },
        rows: inventory.rows.map((row) => ({
          sourceIndex: row.sourceIndex,
          cells: row.cells.map((cell) => ({
            sourceIndex: cell.sourceIndex,
            colSpan: cell.colSpan,
            rowSpan: cell.rowSpan,
          })),
        })),
      },
      () => [],
      source,
    );
    source.replaceWith(rebuilt);
    const corrected = new XMLSerializer().serializeToString(doc);
    expect(matches(oldTableExpected, observedTable)).toBe(false);
    expect(matches(corrected, observedTable)).toBe(true);
    expect(all(rebuilt, "tblInd")).toHaveLength(0);
    expect(
      all(rebuilt, "trPr").every(
        (row) => all(row, "jc")[0]?.getAttributeNS(W, "val") === "center",
      ),
    ).toBe(true);
    for (const property of ["jc", "shd"]) {
      const changed = change(observedTable, (current) => {
        const table = all(current, "tbl")[0];
        const value = all(table, property)[0];
        value.setAttributeNS(
          W,
          property === "jc" ? "w:val" : "w:fill",
          property === "jc" ? "right" : "FFFFFF",
        );
      });
      expect(matches(corrected, changed)).toBe(false);
    }
  });
  it("verifies the recorded Word Mac rich-formatting import without weakening requested formatting", () => {
    expect(
      captureWordAuthoringSnapshot(expectedFormatting, "fixture", "Off", true)
        .issue,
    ).toBeUndefined();
    expect(
      captureWordAuthoringSnapshot(observedFormatting, "fixture", "Off", true)
        .issue,
    ).toBeUndefined();
    expect(matches(expectedFormatting, observedFormatting)).toBe(true);
  });

  it("accepts omission of an explicit paragraph style only when it is the declared default", () => {
    const source = base();
    const after = change(source, (doc) => all(doc, "pStyle")[0].remove());
    expect(matches(source, after)).toBe(true);
    expect(wordDocumentFingerprint(source)).toBe(
      wordDocumentFingerprint(after),
    );
  });

  it("accepts Word also dropping the paragraph-properties wrapper that became empty", () => {
    const source = base();
    const after = change(source, (doc) =>
      all(doc, "pStyle")[0].parentElement!.remove(),
    );
    expect(matches(source, after)).toBe(true);
    expect(wordDocumentFingerprint(source)).toBe(
      wordDocumentFingerprint(after),
    );
  });

  it("retains otherwise empty paragraph properties with unknown extension attributes", () => {
    const source = change(base(), (doc) =>
      all(doc, "pStyle")[0].parentElement!.setAttributeNS(
        "urn:extension",
        "x:behavior",
        "keep",
      ),
    );
    const after = change(source, (doc) =>
      all(doc, "pStyle")[0].parentElement!.remove(),
    );
    expect(matches(source, after)).toBe(false);
  });

  it("detects omission of a nondefault paragraph style", () => {
    const source = change(base(), (doc) =>
      all(doc, "pStyle")[0].setAttributeNS(W, "w:val", "Heading1"),
    );
    expect(
      matches(
        source,
        change(source, (doc) => all(doc, "pStyle")[0].remove()),
      ),
    ).toBe(false);
  });

  it("does not assume that a style named Normal is the document default", () => {
    const source = change(base(), (doc) => {
      const normal = all(doc, "style").find(
        (s) => s.getAttributeNS(W, "styleId") === "Normal",
      )!;
      normal.removeAttributeNS(W, "default");
      const heading = all(doc, "style").find(
        (s) => s.getAttributeNS(W, "styleId") === "Heading1",
      )!;
      heading.setAttributeNS(W, "w:default", "1");
    });
    expect(
      matches(
        source,
        change(source, (doc) => all(doc, "pStyle")[0].remove()),
      ),
    ).toBe(false);
  });

  it("retains unknown attributes on an otherwise default paragraph-style reference", () => {
    const source = change(base(), (doc) =>
      all(doc, "pStyle")[0].setAttributeNS(
        "urn:extension",
        "x:behavior",
        "keep",
      ),
    );
    expect(
      matches(
        source,
        change(source, (doc) => all(doc, "pStyle")[0].remove()),
      ),
    ).toBe(false);
  });

  it("accepts Word dropping an empty content-control end-properties element", () => {
    const source = base();
    const after = change(source, (doc) => all(doc, "sdtEndPr")[0].remove());
    expect(matches(source, after)).toBe(true);
  });

  it.each(["formatting", "extension attribute"])(
    "retains nonempty content-control end properties: %s",
    (variant) => {
      const source = change(base(), (doc) => {
        const end = all(doc, "sdtEndPr")[0];
        if (variant === "extension attribute")
          end.setAttributeNS("urn:extension", "x:behavior", "keep");
        else {
          const props = doc.createElementNS(W, "w:rPr");
          const bold = doc.createElementNS(W, "w:b");
          props.append(bold);
          end.append(props);
        }
      });
      expect(
        matches(
          source,
          change(source, (doc) => all(doc, "sdtEndPr")[0].remove()),
        ),
      ).toBe(false);
    },
  );

  it("ignores Word's style revision-session IDs, but detects actual style changes", () => {
    const source = base();
    const after = change(source, (doc) => {
      for (const style of all(doc, "style")) {
        const id = doc.createElementNS(W, "w:rsid");
        id.setAttributeNS(W, "w:val", "12AB34CD");
        style.append(id);
      }
    });
    expect(matches(source, after)).toBe(true);
    const changed = change(after, (doc) => {
      const normal = all(doc, "style").find(
        (s) => s.getAttributeNS(W, "styleId") === "Normal",
      )!;
      const props = doc.createElementNS(W, "w:rPr");
      const size = doc.createElementNS(W, "w:sz");
      size.setAttributeNS(W, "w:val", "96");
      props.append(size);
      normal.append(props);
    });
    expect(matches(source, changed)).toBe(false);
  });

  it("allows Word registering additional fonts while preserving the original font definitions", () => {
    const source = base();
    const after = change(source, (doc) => {
      const font = doc.createElementNS(W, "w:font");
      font.setAttributeNS(W, "w:name", "Arial");
      const family = doc.createElementNS(W, "w:family");
      family.setAttributeNS(W, "w:val", "swiss");
      font.append(family);
      all(doc, "fonts")[0].append(font);
    });
    expect(matches(source, after)).toBe(true);
    expect(wordDocumentFingerprint(source)).not.toBe(
      wordDocumentFingerprint(after),
    );
    expect(
      matches(
        source,
        change(after, (doc) =>
          all(doc, "font")
            .find((f) => f.getAttributeNS(W, "name") === "Aptos")!
            .remove(),
        ),
      ),
    ).toBe(false);
    expect(
      matches(
        source,
        change(after, (doc) =>
          all(doc, "charset")[0].setAttributeNS(W, "w:val", "02"),
        ),
      ),
    ).toBe(false);
  });

  it("rejects replacement of the requested run font or font size in the recorded result", () => {
    for (const property of ["rFonts", "sz"]) {
      const changed = change(observedFormatting, (doc) => {
        const main = Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
          (p) => p.getAttributeNS(PKG, "name") === "/word/document.xml",
        )!;
        const run = all(main, property)[0];
        run.setAttributeNS(
          W,
          property === "rFonts" ? "w:ascii" : "w:val",
          property === "rFonts" ? "Courier New" : "80",
        );
      });
      expect(matches(expectedFormatting, changed)).toBe(false);
    }
  });
});
