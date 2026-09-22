import { describe, expect, it } from "vitest";

import afterXml from "../../../test/fixtures/word-authoring-state/unchanged-after.xml?raw";
import beforeXml from "../../../test/fixtures/word-authoring-state/unchanged-before.xml?raw";
import {
  captureWordAuthoringSnapshot,
  wordDocumentFingerprint,
  sameWordBodyContent,
  verifyWordPlanOutput,
} from "../wordDocumentXml";

import type { WordDocumentPlan } from "../wordDocumentPlan";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const parse = (xml: string) =>
  new DOMParser().parseFromString(xml, "application/xml");
const serialize = (node: Node) => new XMLSerializer().serializeToString(node);
const all = (e: Element | Document, ns: string, local: string) =>
  Array.from(e.getElementsByTagNameNS(ns, local));
const part = (doc: Document, path: string) =>
  all(doc, PKG, "part").find((p) => p.getAttributeNS(PKG, "name") === path)!;
const main = (doc: Document) => part(doc, "/word/document.xml");
const first = (e: Element | Document, ns: string, local: string) => {
  const n = all(e, ns, local)[0];
  if (!n) throw Error("Missing " + local);
  return n;
};
const setW = (e: Element, name: string, val: string) =>
  e.setAttributeNS(W, "w:" + name, val);
const changeText = (e: Element) => {
  const n = first(e, W, "t");
  n.textContent += " changed";
};
const mutate = (base: string, fn: (doc: Document) => void) => {
  const doc = parse(base);
  fn(doc);
  const changed = serialize(doc);
  expect(changed).not.toBe(serialize(parse(base)));
  expect(parse(changed).getElementsByTagName("parsererror")).toHaveLength(0);
  return changed;
};
const positives: [string, (d: Document) => void][] = [
  [
    "Revision-session metadata",
    (d) => all(d, W, "p").forEach((p) => setW(p, "rsidR", "11223344")),
  ],
  [
    "Text session IDs",
    (d) =>
      all(d, W, "p").forEach((p) =>
        p.setAttributeNS(W14, "w14:textId", "55667788"),
      ),
  ],
  [
    "Proofing markers",
    (d) => {
      const p = first(main(d), W, "p");
      for (const type of ["spellStart", "spellEnd"]) {
        const e = d.createElementNS(W, "w:proofErr");
        setW(e, "type", type);
        p.append(e);
      }
    },
  ],
  [
    "Calculated page-break marker",
    (d) => {
      first(main(d), W, "r").append(
        d.createElementNS(W, "w:lastRenderedPageBreak"),
      );
    },
  ],
  [
    "Package part order",
    (d) => {
      const pkg = first(d, PKG, "package");
      pkg.append(pkg.firstElementChild!);
    },
  ],
  [
    "Relationship collection order",
    (d) => {
      const rels = all(d, REL, "Relationships").find(
        (e) => e.children.length > 1,
      );
      rels!.append(rels!.firstElementChild!);
    },
  ],
  [
    "Consistent relationship ID rename",
    (d) => {
      const rels = part(d, "/word/_rels/document.xml.rels");
      const rel = first(rels, REL, "Relationship");
      const old = rel.getAttribute("Id");
      rel.setAttribute("Id", "diagnostic-rel");
      for (const e of [main(d), ...all(main(d), "*", "*")])
        for (const a of Array.from(e.attributes ?? []))
          if (a.namespaceURI === R && a.value === old)
            e.setAttributeNS(R, a.name, "diagnostic-rel");
    },
  ],
  [
    "Consistent paragraph ID and comment reference rename",
    (d) => {
      const ids = new Map<string, string>();
      let i = 1;
      for (const p of all(d, W, "p")) {
        const id = p.getAttributeNS(W14, "paraId");
        if (id && !ids.has(id)) ids.set(id, (0x60000000 + i++).toString(16));
      }
      for (const e of all(d, "*", "*"))
        for (const a of Array.from(e.attributes)) {
          if (
            ((a.namespaceURI === W14 && a.localName === "paraId") ||
              ([
                W15,
                "http://schemas.microsoft.com/office/word/2016/wordml/cid",
              ].includes(a.namespaceURI ?? "") &&
                ["paraId", "paraIdParent"].includes(a.localName))) &&
            ids.has(a.value)
          )
            e.setAttributeNS(a.namespaceURI, a.name, ids.get(a.value)!);
        }
    },
  ],
  [
    "Split a kept text run with identical formatting",
    (d) => {
      const r = all(main(d), W, "r").find(
        (r) =>
          r.children.length === 1 &&
          r.firstElementChild?.localName === "t" &&
          (r.textContent?.length ?? 0) > 5,
      );
      if (!r) throw Error("No simple text run");
      const text = r.textContent,
        cut = Math.floor(text.length / 2);
      const other = r.cloneNode(true) as Element;
      r.firstElementChild!.textContent = text.slice(0, cut);
      other.firstElementChild!.textContent = text.slice(cut);
      r.firstElementChild!.setAttribute("xml:space", "preserve");
      other.firstElementChild!.setAttribute("xml:space", "preserve");
      r.after(other);
    },
  ],
];
const negatives: [string, (d: Document) => void][] = [
  ["Body text", (d) => changeText(main(d))],
  [
    "Significant leading space",
    (d) => {
      const t = first(main(d), W, "t");
      t.setAttribute("xml:space", "preserve");
      t.textContent = " " + t.textContent;
    },
  ],
  [
    "Significant trailing space",
    (d) => {
      const t = first(main(d), W, "t");
      t.setAttribute("xml:space", "preserve");
      t.textContent += " ";
    },
  ],
  [
    "Paragraph order",
    (d) => {
      const body = first(main(d), W, "body");
      const ps = Array.from(body.children).filter((p) => p.localName === "p");
      ps[0].before(ps[1]);
    },
  ],
  ["Paragraph removal", (d) => first(main(d), W, "p").remove()],
  [
    "Bold run formatting",
    (d) => {
      const r = first(main(d), W, "r");
      let pr = all(r, W, "rPr")[0];
      if (!pr) {
        pr = d.createElementNS(W, "w:rPr");
        r.prepend(pr);
      }
      const b = d.createElementNS(W, "w:b");
      setW(b, "val", "0");
      pr.append(b);
    },
  ],
  [
    "Run font size",
    (d) => {
      const r = first(main(d), W, "r");
      let pr = all(r, W, "rPr")[0];
      if (!pr) {
        pr = d.createElementNS(W, "w:rPr");
        r.prepend(pr);
      }
      const sz = d.createElementNS(W, "w:sz");
      setW(sz, "val", "88");
      pr.append(sz);
    },
  ],
  [
    "Explicit page break",
    (d) => {
      const br = d.createElementNS(W, "w:br");
      setW(br, "type", "page");
      first(main(d), W, "r").append(br);
    },
  ],
  [
    "Tab character",
    (d) => first(main(d), W, "r").append(d.createElementNS(W, "w:tab")),
  ],
  [
    "Heading style assignment",
    (d) => setW(first(main(d), W, "pStyle"), "val", "Heading9"),
  ],
  [
    "Paragraph spacing",
    (d) => {
      const props = first(main(d), W, "pPr");
      const spacing = d.createElementNS(W, "w:spacing");
      setW(spacing, "after", "720");
      props.append(spacing);
    },
  ],
  [
    "Style definition",
    (d) => {
      const normal = all(part(d, "/word/styles.xml"), W, "style").find(
        (e) => e.getAttributeNS(W, "styleId") === "Normal",
      );
      const pr = d.createElementNS(W, "w:rPr"),
        sz = d.createElementNS(W, "w:sz");
      setW(sz, "val", "80");
      pr.append(sz);
      normal!.append(pr);
    },
  ],
  [
    "List number format",
    (d) =>
      setW(
        first(part(d, "/word/numbering.xml"), W, "numFmt"),
        "val",
        "upperRoman",
      ),
  ],
  [
    "List start number",
    (d) => setW(first(part(d, "/word/numbering.xml"), W, "start"), "val", "7"),
  ],
  ["Table cell text", (d) => changeText(first(main(d), W, "tc"))],
  ["Table width", (d) => setW(first(main(d), W, "tblW"), "w", "6666")],
  ["Table row removal", (d) => first(main(d), W, "tr").remove()],
  ["Page margins", (d) => setW(first(main(d), W, "pgMar"), "left", "2010")],
  [
    "Image bytes",
    (d) => {
      const binary = first(d, PKG, "binaryData");
      const bytes = atob(binary.textContent.replace(/\s/g, ""));
      binary.textContent = btoa(
        bytes.slice(0, -1) +
          String.fromCharCode(bytes.charCodeAt(bytes.length - 1) ^ 1),
      );
    },
  ],
  [
    "Image dimensions",
    (d) => {
      const e = first(
        main(d),
        "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        "extent",
      );
      e.setAttribute("cx", String(Number(e.getAttribute("cx")) + 10000));
    },
  ],
  ["Header text", (d) => changeText(part(d, "/word/header1.xml"))],
  ["Footer text", (d) => changeText(part(d, "/word/footer1.xml"))],
  ["Footnote text", (d) => changeText(part(d, "/word/footnotes.xml"))],
  ["Comment text", (d) => changeText(part(d, "/word/comments.xml"))],
  [
    "Comment reference target",
    (d) => setW(first(main(d), W, "commentReference"), "id", "999"),
  ],
  [
    "Bookmark name",
    (d) => setW(first(main(d), W, "bookmarkStart"), "name", "ChangedBookmark"),
  ],
  [
    "Bookmark anchor position",
    (d) => {
      const anchor = first(main(d), W, "bookmarkStart");
      anchor.parentElement!.append(anchor);
    },
  ],
  [
    "Field instruction",
    (d) => {
      first(main(d), W, "instrText").textContent += " changed";
    },
  ],
  [
    "Content control content",
    (d) => changeText(first(main(d), W, "sdtContent")),
  ],
  [
    "Content control identity",
    (d) => setW(first(first(main(d), W, "sdtPr"), W, "id"), "val", "7654321"),
  ],
  [
    "Hyperlink relationship target",
    (d) => {
      const rel = all(
        part(d, "/word/_rels/document.xml.rels"),
        REL,
        "Relationship",
      ).find((e) => e.getAttribute("TargetMode") === "External");
      rel!.setAttribute("Target", "https://example.invalid/changed");
    },
  ],
  [
    "Tracked insertion markup",
    (d) => {
      const r = first(main(d), W, "r"),
        ins = d.createElementNS(W, "w:ins");
      setW(ins, "id", "999");
      setW(ins, "author", "Validation");
      r.before(ins);
      ins.append(r);
    },
  ],
  [
    "Unknown extension value",
    (d) =>
      main(d).firstElementChild!.firstElementChild!.setAttributeNS(
        "urn:erato:unknown",
        "unknown:value",
        "changed",
      ),
  ],
];

describe("stable structured Word state and retained content", () => {
  it("accepts consecutive captured native Word reads without an edit", () => {
    expect(wordDocumentFingerprint(beforeXml)).toBe(
      wordDocumentFingerprint(afterXml),
    );
    expect(
      sameWordBodyContent(
        captureWordAuthoringSnapshot(beforeXml, "doc", "Off"),
        captureWordAuthoringSnapshot(afterXml, "doc", "Off"),
      ),
    ).toBe(true);
  });
  it.each(positives)("accepts representation only: %s", (_name, change) => {
    const changed = mutate(beforeXml, change);
    expect(wordDocumentFingerprint(changed)).toBe(
      wordDocumentFingerprint(beforeXml),
    );
    expect(
      sameWordBodyContent(
        captureWordAuthoringSnapshot(beforeXml, "doc", "Off"),
        captureWordAuthoringSnapshot(changed, "doc", "Off"),
      ),
    ).toBe(true);
  });
  it.each(negatives)("detects a real change: %s", (_name, change) => {
    expect(wordDocumentFingerprint(mutate(beforeXml, change))).not.toBe(
      wordDocumentFingerprint(beforeXml),
    );
  });
  it("resolves paragraph IDs within their part, including IDs shared by a header and comment", () => {
    const doc = parse(beforeXml),
      comment = first(part(doc, "/word/comments.xml"), W, "p"),
      header = first(part(doc, "/word/header1.xml"), W, "p");
    header.setAttributeNS(
      W14,
      "w14:paraId",
      comment.getAttributeNS(W14, "paraId")!,
    );
    const before = serialize(doc);
    header.setAttributeNS(W14, "w14:paraId", "71234567");
    expect(wordDocumentFingerprint(before)).toBe(
      wordDocumentFingerprint(serialize(doc)),
    );
  });
  it("detects a dangling modern comment reference after a partial ID rename", () => {
    const doc = parse(beforeXml),
      paragraph = first(part(doc, "/word/comments.xml"), W, "p");
    const old = paragraph.getAttributeNS(W14, "paraId");
    paragraph.setAttributeNS(W14, "w14:paraId", "71234567");
    for (const e of all(doc, W15, "commentEx"))
      if (e.getAttributeNS(W15, "paraId") === old)
        e.setAttributeNS(W15, "w15:paraId", "71234567");
    expect(first(doc, CID, "commentId").getAttributeNS(CID, "paraId")).toBe(
      old,
    );
    expect(wordDocumentFingerprint(serialize(doc))).not.toBe(
      wordDocumentFingerprint(beforeXml),
    );
  });
  it("keeps unknown paragraph reference namespaces significant", () => {
    const doc = parse(beforeXml),
      paragraph = first(main(doc), W, "p"),
      e = doc.createElementNS("urn:unknown", "unknown:anchor");
    e.setAttributeNS(
      "urn:unknown",
      "unknown:paraId",
      paragraph.getAttributeNS(W14, "paraId")!,
    );
    paragraph.append(e);
    const before = serialize(doc);
    paragraph.setAttributeNS(W14, "w14:paraId", "71234567");
    expect(wordDocumentFingerprint(serialize(doc))).not.toBe(
      wordDocumentFingerprint(before),
    );
  });
  it("verifies a retained native table moved by the plan without treating its paragraph positions as edits", () => {
    const before = captureWordAuthoringSnapshot(beforeXml, "doc", "Off");
    const table = before.blocks.find((b) => b.nativeKind === "table")!;
    const plan: WordDocumentPlan = {
      version: 1,
      snapshot: before.token,
      readToken: "proof",
      scope: "body",
      entries: [
        {
          kind: "keep",
          source: [
            table.ref,
            ...before.blocks
              .filter((b) => b.ref !== table.ref)
              .map((b) => b.ref),
          ],
        },
      ],
      deleted: [],
    };
    const doc = parse(beforeXml),
      body = first(main(doc), W, "body");
    body.prepend(first(body, W, "tbl"));
    const after = captureWordAuthoringSnapshot(serialize(doc), "doc", "Off");
    expect(wordDocumentFingerprint(serialize(doc))).not.toBe(
      before.fingerprint,
    );
    expect(verifyWordPlanOutput(plan, before, after)).toBe(true);
  });
});
