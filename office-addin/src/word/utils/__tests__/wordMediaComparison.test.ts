import { describe, expect, it } from "vitest";

import expectedXml from "../../../test/fixtures/word-rich-native/all-content-expected.xml?raw";
import observedXml from "../../../test/fixtures/word-rich-native/all-content-observed.xml?raw";
import {
  inventoryWordNativeStructures,
  normalizeWordInlineForComparison,
} from "../wordInlineStructures";
import {
  cloneWordMediaNode,
  effectiveWordMediaChildren,
  normalizeWordMediaForComparison,
} from "../wordMediaComparison";
import {
  compileWordDrawing,
  inventoryWordMedia,
  reserveWordNativeIds,
} from "../wordMediaContent";
import { createWordXmlComparison } from "../wordXmlComparison";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
const parse = (value: string) =>
  new DOMParser().parseFromString(value, "application/xml");
const all = (node: Element | Document, namespace: string, local: string) =>
  Array.from(node.getElementsByTagNameNS(namespace, local));
const normalize = (doc: Document) => {
  normalizeWordMediaForComparison(doc);
  normalizeWordInlineForComparison(doc);
  return doc;
};
function identities(doc: Document) {
  const comparison = createWordXmlComparison(normalize(doc));
  const body = all(doc, W, "body")[0];
  return Array.from(body.children)
    .filter(
      (node) =>
        node.localName === "sdt" ||
        all(node, W, "drawing").length ||
        all(node, W, "fldChar").length ||
        all(node, W, "fldSimple").length,
    )
    .map((node) => comparison.signature(node));
}

describe("native Word media and inline structure equivalence", () => {
  it("normalizes omitted zero crop edges while preserving nonzero crops and unknown attributes", () => {
    const first = parse(
      `<a:blipFill xmlns:a="${A}"><a:srcRect l="10000" t="0" r="0" b="0"/></a:blipFill>`,
    );
    const second = parse(
      `<a:blipFill xmlns:a="${A}"><a:srcRect l="10000"/></a:blipFill>`,
    );
    const identity = (doc: Document) => {
      normalizeWordMediaForComparison(doc);
      return createWordXmlComparison(doc).signature(doc.documentElement);
    };
    expect(identity(first)).toBe(identity(second));
    for (const changed of ['r="1000"', 'xmlns:x="urn:unknown" x:r="0"']) {
      const doc = parse(
        `<a:blipFill xmlns:a="${A}"><a:srcRect l="10000" ${changed}/></a:blipFill>`,
      );
      expect(identity(doc)).not.toBe(identity(second));
    }
  });
  it("matches the recorded image, editable shape, control and field without dropping their content", () => {
    expect(identities(parse(expectedXml))).toEqual(
      identities(parse(observedXml)),
    );
  });

  it("still detects drawing text/geometry, image crop, relationship and control/field changes", () => {
    const expected = identities(parse(expectedXml));
    const mutations = [
      (doc: Document) => {
        all(all(doc, WPS, "wsp")[0], W, "t")[0].textContent =
          "Changed shape label";
      },
      (doc: Document) => {
        all(doc, WP, "extent")[1].setAttribute("cx", "999999");
      },
      (doc: Document) => {
        all(doc, A, "blip")[0].setAttributeNS(R, "r:embed", "unknown-media");
      },
      (doc: Document) => {
        const crop = doc.createElementNS(A, "a:srcRect");
        crop.setAttribute("l", "10000");
        const fill = all(
          doc,
          "http://schemas.openxmlformats.org/drawingml/2006/picture",
          "blipFill",
        )[0];
        fill.insertBefore(crop, fill.lastElementChild);
      },
      (doc: Document) => {
        all(doc, W, "tag")[0].setAttributeNS(W, "w:val", "Changed-tag");
      },
      (doc: Document) => {
        all(doc, W, "instrText").at(-1)!.textContent = "NUMPAGES";
      },
      (doc: Document) => {
        all(doc, W, "fldChar").at(-3)!.removeAttributeNS(W, "fldLock");
      },
    ];
    for (const mutate of mutations) {
      const actual = parse(observedXml);
      mutate(actual);
      expect(identities(actual)).not.toEqual(expected);
    }
  });

  it("selects the supported DrawingML branch once and retains Requires bindings in detached source captures", () => {
    const document = parse(observedXml);
    const alternate = all(document, MC, "AlternateContent")[0];
    expect(effectiveWordMediaChildren(alternate)).toHaveLength(1);
    expect(effectiveWordMediaChildren(alternate)[0].localName).toBe("drawing");
    const paragraph = alternate.parentElement!.parentElement!;
    const detached = cloneWordMediaNode(paragraph);
    const reloaded = parse(new XMLSerializer().serializeToString(detached));
    expect(inventoryWordMedia(reloaded.documentElement, "b1")).toMatchObject([
      { kind: "drawing", text: "Editable Word shape" },
    ]);
    expect(inventoryWordMedia(reloaded.documentElement, "b1")).toHaveLength(1);
  });

  it("retains unknown compatibility requirements and meaningful shape locks", () => {
    const expected = identities(parse(expectedXml));
    const unknown = parse(observedXml);
    all(unknown, MC, "Choice")[0].setAttribute(
      "Requires",
      "unrecognizedFeature",
    );
    expect(identities(unknown)).not.toEqual(expected);
    const lock = parse(observedXml);
    all(lock, A, "spLocks")[0].setAttribute("noChangeShapeType", "1");
    expect(identities(lock)).not.toEqual(expected);
  });

  it("keeps source drawing identities and allocates distinct IDs for copied active shapes", () => {
    const document = parse(observedXml);
    const alternate = all(document, MC, "AlternateContent")[0];
    const paragraph = alternate.parentElement!.parentElement!;
    const originalIds = all(document, WP, "docPr").map((node) =>
      node.getAttribute("id"),
    );
    const sourceXml = new XMLSerializer().serializeToString(
      cloneWordMediaNode(paragraph),
    );
    reserveWordNativeIds(document);
    const copied = compileWordDrawing(
      document,
      { sourceRef: "b1", widthPt: 90 },
      { sourceXml },
    );
    const copiedIds = all(copied, WP, "docPr").map((node) =>
      node.getAttribute("id"),
    );
    expect(copiedIds).toHaveLength(1);
    expect(originalIds).not.toContain(copiedIds[0]);
    expect(
      all(document, WP, "docPr").map((node) => node.getAttribute("id")),
    ).toEqual(originalIds);
    expect(inventoryWordMedia(copied, "b2")).toMatchObject([
      {
        ref: "b2_drawing_1",
        target: "drawing-1",
        widthPt: 90,
        text: "Editable Word shape",
      },
    ]);
    expect(inventoryWordMedia(paragraph, "b1")).toMatchObject([
      { ref: "b1_drawing_1", target: "drawing-1", widthPt: 200 },
    ]);
  });

  it("normalizes only known field representations and retains locking/results", () => {
    const simple = parse(
      `<w:p xmlns:w="${W}"><w:fldSimple w:instr="PAGE" w:fldLock="true"><w:r><w:t>42</w:t></w:r></w:fldSimple></w:p>`,
    );
    normalizeWordInlineForComparison(simple);
    expect(inventoryWordNativeStructures(simple.documentElement)).toMatchObject(
      [{ kind: "field", instruction: "PAGE", text: "42" }],
    );
    expect(all(simple, W, "fldChar")[0].getAttributeNS(W, "fldLock")).toBe("1");
    const unknown = parse(
      `<w:p xmlns:w="${W}" xmlns:x="urn:unknown"><w:fldSimple w:instr="PAGE" x:behavior="preserve"><w:r><w:t>42</w:t></w:r></w:fldSimple></w:p>`,
    );
    normalizeWordInlineForComparison(unknown);
    expect(all(unknown, W, "fldSimple")).toHaveLength(1);
  });

  it("does not remove text-run proofing settings or repeated/unknown control properties", () => {
    const document = parse(
      `<w:p xmlns:w="${W}"><w:r><w:rPr><w:noProof/></w:rPr><w:t>Visible text</w:t></w:r></w:p>`,
    );
    normalizeWordMediaForComparison(document);
    expect(all(document, W, "noProof")).toHaveLength(1);
    const control = parse(
      `<w:sdt xmlns:w="${W}" xmlns:x="urn:unknown"><w:sdtPr><w:id w:val="7"/><x:meaningful/><w:alias w:val="A"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>`,
    );
    const before = new XMLSerializer().serializeToString(control);
    normalizeWordInlineForComparison(control);
    expect(new XMLSerializer().serializeToString(control)).toBe(before);
  });
});
