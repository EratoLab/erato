import { packageXml, paragraph, W } from "./authoringFixtures";

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
const part = (name: string, kind: string, content: string) =>
  `<pkg:part pkg:name="/word/${name}" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"><pkg:xmlData>${content}</pkg:xmlData></pkg:part>`;
export const nativeTable = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>${[
  ["Region", "Budget"],
  ["North", "€42,000"],
]
  .map(
    (row) =>
      `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`,
  )
  .join("")}</w:tbl>`;
export const nativeImage = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Fixture image" descr="Synthetic one pixel test image"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="fixture.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="${R}" r:embed="image1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
export function mixedAuthoringXml() {
  const body = [
    paragraph("Background: the pilot starts in October."),
    nativeTable,
    nativeImage,
    '<w:p><w:fldSimple w:instr="MERGEFIELD ClientName" w:fldLock="true"><w:r><w:t>Example customer</w:t></w:r></w:fldSimple></w:p>',
    '<w:sdt><w:sdtPr><w:alias w:val="Project"/><w:id w:val="42"/></w:sdtPr><w:sdtContent>' +
      paragraph("Bound project content") +
      "</w:sdtContent></w:sdt>",
    '<w:p><w:bookmarkStart w:id="5" w:name="Evidence"/><w:r><w:t>Evidence start</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Evidence end</w:t></w:r><w:bookmarkEnd w:id="5"/></w:p>',
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Reviewed assumption</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    '<w:p><w:r><w:t>Note-bearing statement</w:t><w:footnoteReference w:id="2"/></w:r></w:p>',
    paragraph("Recommendation: retain support and review at month end."),
  ].join("");
  const relationships = `<pkg:part pkg:name="/word/_rels/document.xml.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="${REL}">${[
    ["styles", "styles", "styles.xml"],
    ["image1", "image", "media/fixture.png"],
    ["header1", "header", "header1.xml"],
    ["footer1", "footer", "footer1.xml"],
    ["comments", "comments", "comments.xml"],
    ["notes", "footnotes", "footnotes.xml"],
  ]
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`,
    )
    .join("")}</Relationships></pkg:xmlData></pkg:part>`;
  const extras =
    relationships +
    `<pkg:part pkg:name="/word/media/fixture.png" pkg:contentType="image/png"><pkg:binaryData>${png}</pkg:binaryData></pkg:part>` +
    part(
      "header1.xml",
      "header",
      `<w:hdr xmlns:w="${W}">${paragraph("CONFIDENTIAL · Example project")}</w:hdr>`,
    ) +
    part(
      "footer1.xml",
      "footer",
      `<w:ftr xmlns:w="${W}">${paragraph("Example company · Internal")}</w:ftr>`,
    ) +
    part(
      "comments.xml",
      "comments",
      `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Fixture reviewer" w:date="2026-09-18T10:00:00Z">${paragraph("Retain this review note.")}</w:comment></w:comments>`,
    ) +
    part(
      "footnotes.xml",
      "footnotes",
      `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="2">${paragraph("Source: the October pilot decision.")}</w:footnote></w:footnotes>`,
    );
  return packageXml(body)
    .replace(
      "<w:sectPr>",
      `<w:sectPr><w:headerReference xmlns:r="${R}" w:type="default" r:id="header1"/><w:footerReference xmlns:r="${R}" w:type="default" r:id="footer1"/>`,
    )
    .replace("</pkg:package>", extras + "</pkg:package>");
}
