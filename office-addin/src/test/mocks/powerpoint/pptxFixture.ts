import * as CFB from "cfb";

/**
 * Small real .pptx files for the file reader's tests, written part by part the way PowerPoint
 * lays them out: presentation → slides → notes, charts and SmartArt data through relationships.
 */
const NS = {
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  dgm: "http://schemas.openxmlformats.org/drawingml/2006/diagram",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
};
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ROOT_NS = `xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"`;
const EMU = 12700;

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface Box {
  left: number;
  top: number;
  width?: number;
  height?: number;
}

const xfrm = (box: Box, tag = "a:xfrm") =>
  `<${tag}><a:off x="${box.left * EMU}" y="${box.top * EMU}"/><a:ext cx="${(box.width ?? 100) * EMU}" cy="${(box.height ?? 50) * EMU}"/></${tag}>`;

/** Paragraphs split on "\n"; "\v" inside a paragraph is a line break; "{slide}" is a field. */
export function txBody(text: string, tag = "p:txBody") {
  const paragraphs = text.split("\n").map((paragraph) => {
    const runs = paragraph
      .split("\v")
      .map((part) =>
        part
          .split(/(\{slide\})/)
          .filter(Boolean)
          .map((piece) =>
            piece === "{slide}"
              ? `<a:fld id="{1}" type="slidenum"><a:t>1</a:t></a:fld>`
              : `<a:r><a:t>${escape(piece)}</a:t></a:r>`,
          )
          .join(""),
      )
      .join("<a:br/>");
    return `<a:p>${runs}</a:p>`;
  });
  return `<${tag}><a:bodyPr/>${paragraphs.join("")}</${tag}>`;
}

export function sp(
  id: string,
  text: string,
  box: Box,
  options: { name?: string; placeholder?: string; textBox?: boolean } = {},
) {
  const ph = options.placeholder
    ? `<p:nvPr><p:ph type="${options.placeholder}"/></p:nvPr>`
    : "<p:nvPr/>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${options.name ?? `Shape ${id}`}"/><p:cNvSpPr${options.textBox ? ' txBox="1"' : ""}/>${ph}</p:nvSpPr><p:spPr>${xfrm(box)}</p:spPr>${text ? txBody(text) : ""}</p:sp>`;
}

export function pic(id: string, box: Box) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/><p:spPr>${xfrm(box)}</p:spPr></p:pic>`;
}

function frame(
  id: string,
  name: string,
  box: Box,
  data: string,
  placeholder?: string,
) {
  const ph = placeholder
    ? `<p:nvPr><p:ph type="${placeholder}" idx="1"/></p:nvPr>`
    : "<p:nvPr/>";
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/>${ph}</p:nvGraphicFramePr>${xfrm(box, "p:xfrm")}<a:graphic>${data}</a:graphic></p:graphicFrame>`;
}

export function table(
  id: string,
  rows: string[][],
  box: Box,
  placeholder?: string,
) {
  const grid = (rows[0] ?? []).map(() => `<a:gridCol w="100"/>`).join("");
  const body = rows
    .map(
      (row) =>
        `<a:tr h="10">${row
          .map((cell) =>
            cell === "<merged>"
              ? `<a:tc hMerge="1">${txBody("", "a:txBody")}</a:tc>`
              : `<a:tc>${txBody(cell, "a:txBody")}</a:tc>`,
          )
          .join("")}</a:tr>`,
    )
    .join("");
  return frame(
    id,
    `Table ${id}`,
    box,
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid>${grid}</a:tblGrid>${body}</a:tbl></a:graphicData>`,
    placeholder,
  );
}

export function chartFrame(
  id: string,
  relId: string,
  box: Box,
  placeholder?: string,
) {
  return frame(
    id,
    `Chart ${id}`,
    box,
    `<a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" r:id="${relId}"/></a:graphicData>`,
    placeholder,
  );
}

/** Ink as PowerPoint 2010 and later write it: its id sits in the p14 namespace. */
export function ink(id: string, box: Box) {
  return `<mc:AlternateContent xmlns:mc="${NS.mc}"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:contentPart p14:bwMode="auto" r:id="rIdInk"><p14:nvContentPartPr><p14:cNvPr id="${id}" name="Ink ${id}"/><p14:cNvContentPartPr/><p14:nvPr/></p14:nvContentPartPr><p14:xfrm><a:off x="${box.left * EMU}" y="${box.top * EMU}"/><a:ext cx="100" cy="100"/></p14:xfrm></p:contentPart></mc:Choice><mc:Fallback>${pic(id, box)}</mc:Fallback></mc:AlternateContent>`;
}

export function oleFrame(id: string, box: Box, placeholder?: string) {
  return frame(
    id,
    `Object ${id}`,
    box,
    `<a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj r:id="rIdOle" progId="Excel.Sheet.12"/></a:graphicData>`,
    placeholder,
  );
}

export function smartArtFrame(id: string, relId: string, box: Box) {
  return frame(
    id,
    `Diagram ${id}`,
    box,
    `<a:graphicData uri="${NS.dgm}"><dgm:relIds xmlns:dgm="${NS.dgm}" r:dm="${relId}" r:lo="" r:qs="" r:cs=""/></a:graphicData>`,
  );
}

/** A group whose child space is scaled by `scale` against its own box. */
export function group(id: string, box: Box, members: string[], scale = 1) {
  const width = box.width ?? 100;
  const height = box.height ?? 50;
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${box.left * EMU}" y="${box.top * EMU}"/><a:ext cx="${width * EMU}" cy="${height * EMU}"/><a:chOff x="0" y="0"/><a:chExt cx="${(width / scale) * EMU}" cy="${(height / scale) * EMU}"/></a:xfrm></p:grpSpPr>${members.join("")}</p:grpSp>`;
}

export interface ChartSpec {
  kind?: string;
  title?: string;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
  /** Leave the value cache out, as a chart linked to a missing workbook can. */
  noCache?: boolean;
}

export function chartXml(spec: ChartSpec) {
  const kind = spec.kind ?? "barChart";
  const cats = `<c:cat><c:strRef><c:f>Sheet1!$A$2</c:f><c:strCache><c:ptCount val="${spec.categories.length}"/>${spec.categories
    .map((cat, i) => `<c:pt idx="${i}"><c:v>${escape(cat)}</c:v></c:pt>`)
    .join("")}</c:strCache></c:strRef></c:cat>`;
  const series = spec.series
    .map((s, i) => {
      const points = s.values
        .map((v, idx) =>
          v === null ? "" : `<c:pt idx="${idx}"><c:v>${v}</c:v></c:pt>`,
        )
        .join("");
      const val = spec.noCache
        ? `<c:val><c:numRef><c:f>Sheet1!$B$2</c:f></c:numRef></c:val>`
        : `<c:val><c:numRef><c:f>Sheet1!$B$2</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${s.values.length}"/>${points}</c:numCache></c:numRef></c:val>`;
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escape(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>${cats}${val}</c:ser>`;
    })
    .join("");
  const barDir = kind === "barChart" ? `<c:barDir val="col"/>` : "";
  const title = spec.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${escape(spec.title)}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:autoTitleDeleted val="0"/>`
    : `<c:autoTitleDeleted val="1"/>`;
  return `<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:chart>${title}<c:plotArea><c:layout/><c:${kind}>${barDir}${series}</c:${kind}></c:plotArea></c:chart></c:chartSpace>`;
}

export interface SmartArtNode {
  text: string;
  children?: SmartArtNode[];
}

export function smartArtDataXml(nodes: SmartArtNode[]) {
  const points: string[] = [
    `<dgm:pt modelId="{0}" type="doc"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:endParaRPr/></a:p></dgm:t></dgm:pt>`,
  ];
  const connections: string[] = [];
  let next = 1;
  const add = (node: SmartArtNode, parent: string, order: number) => {
    const id = `{${next++}}`;
    points.push(
      `<dgm:pt modelId="${id}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:r><a:t>${escape(node.text)}</a:t></a:r></a:p></dgm:t></dgm:pt>`,
    );
    // PowerPoint also writes transition and presentation points; they carry no text the user typed.
    points.push(
      `<dgm:pt modelId="{t${id}}" type="parTrans"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:r><a:t>x</a:t></a:r></a:p></dgm:t></dgm:pt>`,
    );
    connections.push(
      `<dgm:cxn modelId="{c${id}}" srcId="${parent}" destId="${id}" srcOrd="${order}" destOrd="0" parTransId="{t${id}}"/>`,
    );
    node.children?.forEach((child, i) => add(child, id, i));
  };
  nodes.forEach((node, i) => add(node, "{0}", i));
  return `<dgm:dataModel xmlns:dgm="${NS.dgm}" xmlns:a="${NS.a}"><dgm:ptLst>${points.join("")}</dgm:ptLst><dgm:cxnLst>${connections.join("")}</dgm:cxnLst><dgm:bg/><dgm:whole/></dgm:dataModel>`;
}

export interface FixtureSlide {
  /** p:sldId/@id; Office.js reports it as "<sldId>#…". */
  sldId: number;
  hidden?: boolean;
  /** p:spTree members. */
  shapes: string[];
  notes?: string;
  charts?: Record<string, string>;
  smartArt?: Record<string, string>;
  /** Relationship ids whose part is left out, as an export that drops it would. */
  dropParts?: string[];
}

/** `mediaBytes` adds an incompressible picture before the slides, as a deck's media would be. */
export function buildPptx(
  slides: FixtureSlide[],
  { mediaBytes = 0 }: { mediaBytes?: number } = {},
): Uint8Array {
  const zip = CFB.utils.cfb_new();
  if (mediaBytes > 0) {
    const media = new Uint8Array(mediaBytes);
    let seed = 7;
    for (let i = 0; i < media.length; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      media[i] = seed >>> 24;
    }
    CFB.utils.cfb_add(zip, "ppt/media/image1.png", media);
  }
  const add = (path: string, xml: string) =>
    CFB.utils.cfb_add(
      zip,
      path,
      new TextEncoder().encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`,
      ),
    );
  const rels = (items: { id: string; type: string; target: string }[]) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
      .map(
        (rel) =>
          `<Relationship Id="${rel.id}" Type="${REL}/${rel.type}" Target="${rel.target}"/>`,
      )
      .join("")}</Relationships>`;

  add(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
  );
  add(
    "_rels/.rels",
    rels([
      { id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" },
    ]),
  );
  add(
    "ppt/presentation.xml",
    `<p:presentation ${ROOT_NS}><p:sldIdLst>${slides
      .map((slide, i) => `<p:sldId id="${slide.sldId}" r:id="rId${i + 1}"/>`)
      .join("")}</p:sldIdLst></p:presentation>`,
  );
  add(
    "ppt/_rels/presentation.xml.rels",
    rels(
      slides.map((_, i) => ({
        id: `rId${i + 1}`,
        type: "slide",
        target: `slides/slide${i + 1}.xml`,
      })),
    ),
  );
  let chartCount = 0;
  let dataCount = 0;
  slides.forEach((slide, i) => {
    const n = i + 1;
    const slideRels: { id: string; type: string; target: string }[] = [];
    if (slide.notes !== undefined) {
      slideRels.push({
        id: "rIdNotes",
        type: "notesSlide",
        target: `../notesSlides/notesSlide${n}.xml`,
      });
      if (!slide.dropParts?.includes("rIdNotes"))
        add(
          `ppt/notesSlides/notesSlide${n}.xml`,
          `<p:notes ${ROOT_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${sp("2", "", { left: 0, top: 0 }, { placeholder: "sldImg" })}${sp("3", slide.notes, { left: 0, top: 0 }, { placeholder: "body" })}${sp("4", "{slide}", { left: 0, top: 0 }, { placeholder: "sldNum" })}</p:spTree></p:cSld></p:notes>`,
        );
    }
    for (const [relId, xml] of Object.entries(slide.charts ?? {})) {
      chartCount += 1;
      slideRels.push({
        id: relId,
        type: "chart",
        target: `../charts/chart${chartCount}.xml`,
      });
      if (!slide.dropParts?.includes(relId))
        add(`ppt/charts/chart${chartCount}.xml`, xml);
    }
    for (const [relId, xml] of Object.entries(slide.smartArt ?? {})) {
      dataCount += 1;
      slideRels.push({
        id: relId,
        type: "diagramData",
        target: `../diagrams/data${dataCount}.xml`,
      });
      if (!slide.dropParts?.includes(relId))
        add(`ppt/diagrams/data${dataCount}.xml`, xml);
    }
    add(
      `ppt/slides/slide${n}.xml`,
      `<p:sld ${ROOT_NS} xmlns:mc="${NS.mc}"${slide.hidden ? ' show="0"' : ""}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${slide.shapes.join("")}</p:spTree></p:cSld></p:sld>`,
    );
    add(`ppt/slides/_rels/slide${n}.xml.rels`, rels(slideRels));
  });
  return new Uint8Array(
    CFB.write(zip, {
      type: "array",
      fileType: "zip",
      compression: true,
    }) as number[],
  );
}

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
