import { escapeXml, W } from "./authoringFixtures";
import { captureWordDocumentPackage } from "../../../word/utils/wordDocumentPackage";
import { wordSourceReadRefs } from "../../../word/utils/wordDocumentPlan";
import { captureWordAuthoringSnapshot } from "../../../word/utils/wordDocumentXml";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "../../../word/utils/wordDocumentPlan";

/** Appears in body, header, comment, customXml and custom-property content; diagnostics must never show it. */
export const SENTINEL = "SENTINEL-PRIVATE-TEXT";

const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WML = "application/vnd.openxmlformats-officedocument.wordprocessingml";
const RELS = "application/vnd.openxmlformats-package.relationships+xml";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const FMTID = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";

const part = (name: string, contentType: string, xml: string) =>
  `<pkg:part pkg:name="${name}" pkg:contentType="${contentType}"><pkg:xmlData>${xml}</pkg:xmlData></pkg:part>`;
const relationships = (entries: [string, string, string][]) =>
  `<Relationships xmlns="${REL}">${entries
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="${type.includes("://") ? type : `${R}/${type}`}" Target="${target}"/>`,
    )
    .join("")}</Relationships>`;
const run = (text: string) =>
  `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const p = (text: string, pPr = "") =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${run(text)}</w:p>`;
const listItem = (text: string, numId: number) =>
  p(
    text,
    `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`,
  );
const level = (format: string, text: string) =>
  `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;

export const REALISTIC_STATUS_TEXT = `Status: ${SENTINEL} the pilot is on track.`;

/**
 * A synthetic SharePoint-style document: three customXml items with their
 * properties, custom document properties (pids 2-5), a saved task pane, decimal
 * and bullet lists plus a restarted list, a table, a header, a footer and a comment.
 */
export function realisticWordPackageXml(): string {
  const body = [
    p(`${SENTINEL} quarterly brief`, '<w:pStyle w:val="Heading1"/>'),
    p(REALISTIC_STATUS_TEXT),
    listItem("Confirm the regions.", 1),
    listItem("Schedule the pilot.", 1),
    listItem("Review at month end.", 1),
    p("Open questions follow."),
    listItem("Budget owner", 2),
    listItem("Support model", 2),
    listItem("Restarted step one", 3),
    listItem("Restarted step two", 3),
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>${[
      ["Region", "Budget"],
      ["North", "42"],
    ]
      .map(
        (row) =>
          `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${p(cell)}</w:tc>`).join("")}</w:tr>`,
      )
      .join("")}</w:tbl>`,
    `<w:p><w:commentRangeStart w:id="0"/>${run("Reviewed assumption")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`,
    p("Closing paragraph."),
  ].join("");
  const document = `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:w14="${W14}" xmlns:mc="${MC}" mc:Ignorable="w14"><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style></w:styles>`;
  const numbering = `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:nsid w:val="1A2B3C4D"/><w:multiLevelType w:val="hybridMultilevel"/><w:tmpl w:val="0409000F"/>${level("decimal", "%1.")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:nsid w:val="5E6F7A8B"/><w:multiLevelType w:val="hybridMultilevel"/><w:tmpl w:val="04090001"/>${level("bullet", "•")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num></w:numbering>`;
  const theme = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
  const customXml = [
    `<p:properties xmlns:p="http://schemas.microsoft.com/office/2006/metadata/properties"><documentManagement><ProjectName xmlns="urn:example:sharepoint">${SENTINEL}</ProjectName><TaxCatchAll xmlns="urn:example:taxonomy"/></documentManagement></p:properties>`,
    `<ct:contentTypeSchema xmlns:ct="http://schemas.microsoft.com/office/2006/metadata/contentType" xmlns:ma="http://schemas.microsoft.com/office/2006/metadata/properties/metaAttributes" ma:contentTypeName="Document" ma:contentTypeID="0x0101009B1E8A2C3D4E5F" ma:contentTypeVersion="12"/>`,
    `<b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography" SelectedStyle="/APA.XSL" StyleName="APA"/>`,
  ];
  const itemProps = (n: number) =>
    `<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{6E0C7B4A-1D2F-4E3A-9B8C-00000000000${n}}"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.microsoft.com/office/2006/metadata/properties"/></ds:schemaRefs></ds:datastoreItem>`;
  const property = (pid: number, name: string, value: string) =>
    `<property fmtid="${FMTID}" pid="${pid}" name="${name}">${value}</property>`;
  const customProperties = `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${[
    property(
      2,
      "ContentTypeId",
      "<vt:lpwstr>0x0101009B1E8A2C3D4E5F</vt:lpwstr>",
    ),
    property(3, "MediaServiceImageTags", "<vt:lpwstr></vt:lpwstr>"),
    property(4, "Order", "<vt:r8>100</vt:r8>"),
    property(5, "ProjectCode", `<vt:lpwstr>${SENTINEL}</vt:lpwstr>`),
  ].join("")}</Properties>`;
  return `<pkg:package xmlns:pkg="${PKG}">${[
    part(
      "/_rels/.rels",
      RELS,
      relationships([
        ["rId1", "officeDocument", "word/document.xml"],
        ["rId2", "custom-properties", "docProps/custom.xml"],
        [
          "rId3",
          "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes",
          "word/webextensions/taskpanes.xml",
        ],
      ]),
    ),
    part("/word/document.xml", `${WML}.document.main+xml`, document),
    part(
      "/word/_rels/document.xml.rels",
      RELS,
      relationships([
        ["rIdStyles", "styles", "styles.xml"],
        ["rIdNumbering", "numbering", "numbering.xml"],
        ["rIdSettings", "settings", "settings.xml"],
        ["rIdTheme", "theme", "theme/theme1.xml"],
        ["rIdHeader1", "header", "header1.xml"],
        ["rIdFooter1", "footer", "footer1.xml"],
        ["rIdComments", "comments", "comments.xml"],
        ["rIdCustomXml1", "customXml", "../customXml/item1.xml"],
        ["rIdCustomXml2", "customXml", "../customXml/item2.xml"],
        ["rIdCustomXml3", "customXml", "../customXml/item3.xml"],
      ]),
    ),
    part("/word/styles.xml", `${WML}.styles+xml`, styles),
    part("/word/numbering.xml", `${WML}.numbering+xml`, numbering),
    part(
      "/word/settings.xml",
      `${WML}.settings+xml`,
      `<w:settings xmlns:w="${W}" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml"><w:defaultTabStop w:val="720"/><w:shapeDefaults><o:shapedefaults v:ext="edit" spidmax="2049" fillcolor="white"/><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout></w:shapeDefaults></w:settings>`,
    ),
    part(
      "/word/theme/theme1.xml",
      "application/vnd.openxmlformats-officedocument.theme+xml",
      theme,
    ),
    part(
      "/word/header1.xml",
      `${WML}.header+xml`,
      `<w:hdr xmlns:w="${W}">${p(`${SENTINEL} header`)}</w:hdr>`,
    ),
    part(
      "/word/footer1.xml",
      `${WML}.footer+xml`,
      `<w:ftr xmlns:w="${W}">${p("Internal")}</w:ftr>`,
    ),
    part(
      "/word/comments.xml",
      `${WML}.comments+xml`,
      `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="${SENTINEL} Reviewer" w:date="2026-09-18T10:00:00Z" w:initials="SR">${p("Check this assumption.")}</w:comment></w:comments>`,
    ),
    ...customXml.flatMap((xml, i) => [
      part(`/customXml/item${i + 1}.xml`, "application/xml", xml),
      part(
        `/customXml/itemProps${i + 1}.xml`,
        "application/vnd.openxmlformats-officedocument.customXmlProperties+xml",
        itemProps(i + 1),
      ),
      part(
        `/customXml/_rels/item${i + 1}.xml.rels`,
        RELS,
        relationships([["rId1", "customXmlProps", `itemProps${i + 1}.xml`]]),
      ),
    ]),
    part(
      "/docProps/custom.xml",
      "application/vnd.openxmlformats-officedocument.custom-properties+xml",
      customProperties,
    ),
    part(
      "/word/webextensions/taskpanes.xml",
      "application/vnd.ms-office.webextensiontaskpanes+xml",
      `<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11"><wetp:taskpane dockstate="right" visibility="0" width="350" row="0"><wetp:webextensionref xmlns:r="${R}" r:id="rId1"/></wetp:taskpane></wetp:taskpanes>`,
    ),
    part(
      "/word/webextensions/_rels/taskpanes.xml.rels",
      RELS,
      relationships([
        [
          "rId1",
          "http://schemas.microsoft.com/office/2011/relationships/webextension",
          "webextension1.xml",
        ],
      ]),
    ),
    part(
      "/word/webextensions/webextension1.xml",
      "application/vnd.ms-office.webextension+xml",
      `<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11" id="{2B1F6C3D-0A4E-4B5C-8D9E-0F1A2B3C4D5E}"><we:reference id="wa200000000" version="1.0.0.0" store="en-US" storeType="OMEX"/><we:alternateReferences/><we:properties/><we:bindings/><we:snapshot/></we:webextension>`,
    ),
  ].join("")}</pkg:package>`;
}

/** A complete, fully read snapshot owned by `messageId`, as the read tool would leave it. */
export function realisticSnapshot(
  ooxml: string,
  messageId = "message-A",
  tracking = "Off",
): WordAuthoringSnapshot {
  const snapshot = captureWordAuthoringSnapshot(ooxml, "doc-A", tracking, true);
  snapshot.read = new Set(wordSourceReadRefs(snapshot));
  snapshot.readToken = "read-proof";
  snapshot.ownerMessageId = messageId;
  return snapshot;
}

/** Capture the open document from the installed host. */
export async function captureRealisticSnapshot(
  messageId = "message-A",
  tracking = "Off",
): Promise<WordAuthoringSnapshot> {
  const file = await captureWordDocumentPackage();
  const snapshot = realisticSnapshot(file.ooxml, messageId, tracking);
  snapshot.documentUrl = file.documentUrl;
  return snapshot;
}

/** Keep every block and rewrite the status paragraph. */
export function statusRewritePlan(
  snapshot: WordAuthoringSnapshot,
  text: string,
): WordDocumentPlan {
  const refs = snapshot.blocks.map((b) => b.ref);
  const target = snapshot.blocks.findIndex((b) => b.text.startsWith("Status"));
  if (target < 1) throw new Error("The fixture has no status paragraph.");
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries: [
      { kind: "keep", source: refs.slice(0, target) },
      {
        kind: "replace",
        source: [refs[target]],
        blocks: [{ id: "status", type: "paragraph", text }],
      },
      { kind: "keep", source: refs.slice(target + 1) },
    ],
    deleted: [],
  };
}
