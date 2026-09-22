import { describe, expect, it } from "vitest";

import { packageXml } from "../../../test/mocks/word/authoringFixtures";
import {
  compileWordDrawing,
  compileWordImage,
  inventoryWordMedia,
  isWordDrawingSpec,
  isWordImageSpec,
  reserveWordNativeIds,
} from "../wordMediaContent";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WP =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const png = {
  mime: "image/png" as const,
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
};
const doc = () =>
  new DOMParser().parseFromString(packageXml("<w:p/>"), "application/xml");
const serialize = (node: Node) => new XMLSerializer().serializeToString(node);

describe("typed Word media", () => {
  it("restyles legacy VML pictures in place without losing image relationships or opaque attributes", () => {
    const document = doc();
    const source =
      '<w:p xmlns:w="' +
      W +
      '" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="' +
      R +
      '"><w:r><w:pict><v:shape id="legacy1" style="width:120pt;height:60pt" custom="retained"><v:imagedata r:id="oldImage"/></v:shape></w:pict></w:r></w:p>';
    const changed = compileWordImage(
      document,
      {
        sourceRef: "b1",
        widthPt: 60,
        crop: { left: 10, right: 0, top: 20, bottom: 0 },
        border: { color: "AA0000", widthPt: 2 },
        wrap: "square",
        alt: "Legacy photo",
      },
      { sourceXml: source },
    );
    const shape = changed.getElementsByTagNameNS(
      "urn:schemas-microsoft-com:vml",
      "shape",
    )[0];
    expect(shape.getAttribute("style")).toContain("height:30pt");
    expect(shape.getAttribute("custom")).toBe("retained");
    expect(shape.getAttribute("strokecolor")).toBe("#AA0000");
    const image = changed.getElementsByTagNameNS(
      "urn:schemas-microsoft-com:vml",
      "imagedata",
    )[0];
    expect(image.getAttributeNS(R, "id")).toBe("oldImage");
    expect(image.getAttribute("cropleft")).toBe("0.1");
    expect(
      changed
        .getElementsByTagNameNS(
          "urn:schemas-microsoft-com:office:word",
          "wrap",
        )[0]
        .getAttributeNS("urn:schemas-microsoft-com:office:word", "type"),
    ).toBe("square");
    expect(inventoryWordMedia(changed, "b2")[0]).toMatchObject({
      widthPt: 60,
      heightPt: 30,
      alt: "Legacy photo",
    });
  });

  it("keeps a drawing and nested image distinct, resizing only the outer geometry", () => {
    const document = doc();
    const outer = compileWordDrawing(document, {
      shape: "rect",
      text: "Caption",
      widthPt: 300,
      heightPt: 150,
    });
    const inner = compileWordImage(document, {
      data: png,
      widthPt: 80,
      heightPt: 40,
    });
    outer.getElementsByTagNameNS(W, "txbxContent")[0].append(inner);
    const inventory = inventoryWordMedia(outer, "b1");
    expect(inventory.map((v) => v.kind)).toEqual(["drawing", "image"]);
    const copy = compileWordDrawing(
      document,
      { sourceRef: "b1_drawing_1", widthPt: 150 },
      { sourceXml: serialize(outer) },
    );
    expect(inventoryWordMedia(copy, "b2")).toMatchObject([
      { widthPt: 150, heightPt: 75 },
      { widthPt: 80, heightPt: 40 },
    ]);
    const ids = Array.from(copy.getElementsByTagNameNS(WP, "docPr")).map((p) =>
      p.getAttribute("id"),
    );
    expect(new Set(ids).size).toBe(2);
  });
  it("edits a legacy drawing's text and colors and can explicitly replace its shape", () => {
    const document = doc();
    const source = `<w:p xmlns:w="${W}" xmlns:v="urn:schemas-microsoft-com:vml"><w:r><w:pict><v:rect id="legacy-box" style="width:120pt;height:60pt"><v:textbox><w:txbxContent><w:p><w:r><w:t>Old label</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect></w:pict></w:r></w:p>`;
    const edited = compileWordDrawing(
      document,
      {
        sourceRef: "b1",
        text: "New label",
        fill: "EEEEFF",
        line: { color: "112233", widthPt: 1 },
      },
      { sourceXml: source },
    );
    const rect = edited.getElementsByTagNameNS(
      "urn:schemas-microsoft-com:vml",
      "rect",
    )[0];
    expect(rect.getAttribute("fillcolor")).toBe("#EEEEFF");
    expect(rect.getAttribute("strokecolor")).toBe("#112233");
    expect(inventoryWordMedia(edited, "b2")[0].text).toBe("New label");
    const replacement = compileWordDrawing(
      document,
      { sourceRef: "b1", shape: "ellipse", fill: "EEEEFF" },
      { sourceXml: source },
    );
    expect(replacement.getElementsByTagNameNS(W, "pict")).toHaveLength(0);
    expect(inventoryWordMedia(replacement, "b3")[0]).toMatchObject({
      shape: "ellipse",
      text: "Old label",
      widthPt: 120,
      heightPt: 60,
    });
  });

  it("preserves anchor position and extension data when changing wrapping", () => {
    const document = doc();
    const original = compileWordImage(document, { data: png, wrap: "square" });
    const anchor = original.getElementsByTagNameNS(WP, "anchor")[0];
    anchor.setAttribute("layoutInCell", "0");
    anchor.getElementsByTagNameNS(WP, "posOffset")[0].textContent = "12345";
    anchor.append(document.createElementNS("urn:test", "x:metadata"));
    const changed = compileWordImage(
      document,
      { sourceRef: "b1", wrap: "top-bottom" },
      { sourceXml: serialize(original) },
    );
    expect(changed.getElementsByTagNameNS(WP, "posOffset")[0].textContent).toBe(
      "12345",
    );
    expect(
      changed
        .getElementsByTagNameNS(WP, "anchor")[0]
        .getAttribute("layoutInCell"),
    ).toBe("0");
    expect(changed.getElementsByTagNameNS("urn:test", "metadata")).toHaveLength(
      1,
    );
  });
  it("reserves original object IDs before the source body is cleared", () => {
    const document = doc();
    const original = compileWordImage(document, { data: png });
    original.getElementsByTagNameNS(WP, "docPr")[0].setAttribute("id", "900");
    const body = document.getElementsByTagNameNS(W, "body")[0];
    body.append(original);
    reserveWordNativeIds(document);
    body.replaceChildren();
    const inserted = compileWordImage(document, { data: png });
    expect(
      Number(
        inserted.getElementsByTagNameNS(WP, "docPr")[0].getAttribute("id"),
      ),
    ).toBeGreaterThan(900);
  });
  it("embeds explicit image bytes as a correctly typed package part and local relationship", () => {
    const document = doc();
    const p = compileWordImage(document, {
      data: png,
      widthPt: 144,
      heightPt: 72,
      alt: '<script> & "caption"',
    });
    document.getElementsByTagNameNS(W, "body")[0].append(p);
    const binary = document.getElementsByTagNameNS(PKG, "binaryData")[0];
    expect(binary.textContent).toBe(png.base64);
    expect(binary.parentElement?.getAttributeNS(PKG, "contentType")).toBe(
      "image/png",
    );
    const blip = p.getElementsByTagNameNS(A, "blip")[0];
    const rel = Array.from(
      document.getElementsByTagNameNS(REL, "Relationship"),
    ).find((r) => r.getAttribute("Id") === blip.getAttributeNS(R, "embed"));
    expect(rel?.getAttribute("Target")).toBe(
      binary.parentElement?.getAttributeNS(PKG, "name"),
    );
    expect(inventoryWordMedia(p, "b1")).toMatchObject([
      {
        ref: "b1_image_1",
        target: "image-1",
        widthPt: 144,
        heightPt: 72,
        alt: '<script> & "caption"',
      },
    ]);
    expect(
      new DOMParser()
        .parseFromString(serialize(document), "application/xml")
        .getElementsByTagName("parsererror"),
    ).toHaveLength(0);
  });

  it("resizes an existing image proportionally without changing its bytes or unknown extension data", () => {
    const document = doc();
    const original = compileWordImage(document, {
      data: png,
      widthPt: 200,
      heightPt: 100,
    });
    const blip = original.getElementsByTagNameNS(A, "blip")[0];
    blip.append(document.createElementNS("urn:test:extension", "x:metadata"));
    const before = document.getElementsByTagNameNS(PKG, "binaryData")[0]
      .textContent;
    const resized = compileWordImage(
      document,
      { sourceRef: "b1_image_1", widthPt: 80 },
      { sourceXml: serialize(original) },
    );
    expect(inventoryWordMedia(resized, "b2")[0]).toMatchObject({
      widthPt: 80,
      heightPt: 40,
    });
    expect(
      resized.getElementsByTagNameNS("urn:test:extension", "metadata"),
    ).toHaveLength(1);
    expect(document.getElementsByTagNameNS(PKG, "binaryData")).toHaveLength(1);
    expect(
      document.getElementsByTagNameNS(PKG, "binaryData")[0].textContent,
    ).toBe(before);
  });

  it("rebinds an image moved to a header and supports crop, border, rotation and text wrap", () => {
    const document = doc();
    const original = compileWordImage(document, { data: png });
    const moved = compileWordImage(
      document,
      {
        sourceRef: "b1_image_1",
        crop: { left: 10, right: 0, top: 5, bottom: 0 },
        border: { widthPt: 2, color: "ff0000" },
        wrap: "square",
        rotation: 30,
      },
      { sourceXml: serialize(original), storyPart: "/word/header1.xml" },
    );
    const parts = Array.from(document.getElementsByTagNameNS(PKG, "part"));
    const rels = parts.find(
      (p) => p.getAttributeNS(PKG, "name") === "/word/_rels/header1.xml.rels",
    );
    expect(rels?.getElementsByTagNameNS(REL, "Relationship")).toHaveLength(1);
    expect(moved.getElementsByTagNameNS(WP, "anchor")).toHaveLength(1);
    expect(
      moved.getElementsByTagNameNS(A, "srcRect")[0].getAttribute("l"),
    ).toBe("10000");
    expect(moved.getElementsByTagNameNS(A, "ln")[0].getAttribute("w")).toBe(
      "25400",
    );
    expect(moved.getElementsByTagNameNS(A, "xfrm")[0].getAttribute("rot")).toBe(
      "1800000",
    );
  });

  it("creates editable Word shapes with rich object metadata and literal text", () => {
    const document = doc();
    const p = compileWordDrawing(document, {
      shape: "roundRect",
      text: "A < B\nsecond line",
      widthPt: 200,
      heightPt: 100,
      fill: "ddeeff",
      line: { widthPt: 1, color: "112233" },
      alt: "Process step",
    });
    expect(p.getElementsByTagNameNS(W, "txbxContent")[0].children).toHaveLength(
      2,
    );
    expect(
      p.getElementsByTagNameNS(A, "prstGeom")[0].getAttribute("prst"),
    ).toBe("roundRect");
    expect(inventoryWordMedia(p, "b4")).toMatchObject([
      {
        kind: "drawing",
        ref: "b4_drawing_1",
        text: "A < Bsecond line",
        widthPt: 200,
        heightPt: 100,
      },
    ]);
  });

  it("rejects invented image URLs, mismatched signatures, malformed sizes and over-crops", () => {
    expect(isWordImageSpec({ url: "https://example.test/private.png" })).toBe(
      false,
    );
    expect(
      isWordImageSpec({ data: { mime: "image/jpeg", base64: png.base64 } }),
    ).toBe(false);
    expect(isWordImageSpec({ data: png, widthPt: Number.NaN })).toBe(false);
    expect(
      isWordImageSpec({
        sourceRef: "b1",
        crop: { left: 50, right: 50, top: 0, bottom: 0 },
      }),
    ).toBe(false);
    expect(isWordDrawingSpec({ shape: "arbitrary-XML", text: "text" })).toBe(
      false,
    );
    expect(isWordDrawingSpec({ shape: "ellipse", fill: "#00ff00" })).toBe(
      false,
    );
  });
});
