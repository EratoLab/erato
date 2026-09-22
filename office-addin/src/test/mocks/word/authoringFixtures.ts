import { captureWordAuthoringSnapshot } from "../../../word/utils/wordDocumentXml";

import type { WordDocumentPlan } from "../../../word/utils/wordDocumentPlan";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export const paragraph = (text: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
export function packageXml(body: string): string {
  return `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"><pkg:xmlData><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/styles.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"><pkg:xmlData><w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles></pkg:xmlData></pkg:part></pkg:package>`;
}
export const sixParagraphXml = () =>
  packageXml(
    [
      "Context",
      "Two regions.",
      "Two regions.",
      "Pilot in October.",
      "Retain support.",
      "Review at month end.",
    ]
      .map(paragraph)
      .join(""),
  );

export function wordSerializationNoise(ooxml: string): string {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  for (const p of Array.from(doc.getElementsByTagNameNS(W, "p")))
    p.setAttributeNS(W, "w:rsidR", "76543210");
  for (const run of Array.from(doc.getElementsByTagNameNS(W, "r"))) {
    const text = run.getElementsByTagNameNS(W, "t")[0];
    if (
      !text ||
      run.children.length !== 1 ||
      (text.textContent?.length ?? 0) < 3
    )
      continue;
    const value = text.textContent;
    const sibling = run.cloneNode(true) as Element;
    const cut = Math.floor(value.length / 2);
    text.textContent = value.slice(0, cut);
    text.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve",
    );
    sibling.firstElementChild!.textContent = value.slice(cut);
    sibling.firstElementChild!.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve",
    );
    run.after(sibling);
  }
  return new XMLSerializer().serializeToString(doc);
}
export function readySnapshot(ooxml = sixParagraphXml()) {
  const snapshot = captureWordAuthoringSnapshot(ooxml, "doc-A", "Off");
  snapshot.blocks.forEach((b) => snapshot.read.add(b.ref));
  snapshot.readToken = "read-proof";
  snapshot.ownerMessageId = "message-A";
  return snapshot;
}
export function examplePlan(snapshot: string): WordDocumentPlan {
  return {
    version: 1,
    snapshot,
    readToken: "read-proof",
    scope: "body",
    entries: [
      {
        kind: "insert",
        contextRefs: ["b4"],
        blocks: [
          { id: "n1", type: "heading", level: 1, text: "Recommendation" },
        ],
      },
      {
        kind: "replace",
        source: ["b4", "b5"],
        blocks: [
          {
            id: "n2",
            type: "paragraph",
            text: "Pilot in October. Retain support.",
          },
        ],
      },
      { kind: "keep", source: ["b1"] },
      {
        kind: "replace",
        source: ["b2"],
        blocks: [
          { id: "n3", type: "heading", level: 2, text: "Background" },
          { id: "n4", type: "paragraph", text: "Two regions." },
        ],
      },
      { kind: "keep", source: ["b6"] },
    ],
    deleted: [{ source: ["b3"], reason: "Remove duplicated background." }],
  };
}
