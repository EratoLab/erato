import { capText } from "./powerpointShapeRead";
import {
  officeRelationshipTarget,
  officeXmlText,
  parseOfficeXml,
} from "../../utils/officeXml";

import type { OfficeZip } from "../../utils/officeZipReader";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const DGM = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const TABLE_URI = "http://schemas.openxmlformats.org/drawingml/2006/table";
const CHART_EX_URI = "http://schemas.microsoft.com/office/drawing/2014/chartex";
const OLE_URI = "http://schemas.openxmlformats.org/presentationml/2006/ole";

const MAX_XML_PART_BYTES = 16 * 1024 * 1024;
const EMU_PER_POINT = 12700;
const MAX_CHART_SERIES = 20;
const MAX_CHART_POINTS = 200;
const MAX_SMART_ART_NODES = 200;
const MAX_LABEL_CHARACTERS = 100;
const MAX_NAME_CHARACTERS = 200;

export interface PowerPointChartSeriesOut {
  name?: string;
  /** Present when this series' categories differ from the chart's. */
  categories?: string[];
  /** Scatter and bubble charts: the x value of each point. */
  x?: (number | string | null)[];
  /** null where the point has no value. */
  values: (number | null)[];
  /** The values' number format when it is not General, e.g. "0%" (0.25 shows as 25%). */
  format?: string;
  /** Bubble charts: each point's bubble size. */
  sizes?: (number | null)[];
}

export interface PowerPointChartOut {
  /** Chart kinds in plot order, e.g. "column" or "column, line" for a combination chart. */
  type: string;
  title?: string;
  categories?: string[];
  series: PowerPointChartSeriesOut[];
  unread?: string[];
}

export interface PowerPointSmartArtNodeOut {
  text: string;
  /** 1 for the top level. */
  level: number;
}

/** A shape as the presentation file describes it. */
export interface PptxShape {
  id: string;
  name: string;
  /** Office.js ShapeType wording, so file shapes read like live ones. */
  type: string;
  /** Placeholder type from the file ("title", "body"…); absent for other shapes. */
  placeholder?: string;
  box?: { left: number; top: number; width: number; height: number };
  text?: string;
  /** Holds a field (slide number, date) whose saved text may differ from the screen. */
  hasField?: boolean;
  table?: { rows: number; columns: number; values: string[][] };
  chart?: PowerPointChartOut;
  smartArt?: PowerPointSmartArtNodeOut[];
  children?: PptxShape[];
  unread?: string[];
}

export interface PptxSlide {
  hidden: boolean;
  /** The notes page's body text; "" when the slide has no notes. */
  notes: string;
  /** The slide names a notes page. Without one, "" may mean the file left the notes out. */
  hasNotesPage: boolean;
  /** Shape tree members this reader does not model, so their ids are unknown. */
  unmodeled: number;
  shapes: PptxShape[];
}

export interface PptxSlideEntry {
  /** p:sldId/@id, the number before "#" in an Office.js slide id. */
  sldId: string;
  part: string;
}

interface Relationship {
  type: string;
  target: string;
  external: boolean;
}

const children = (el: Element | null | undefined, ns: string, name: string) =>
  el
    ? Array.from(el.children).filter(
        (child) => child.namespaceURI === ns && child.localName === name,
      )
    : [];
const child = (el: Element | null | undefined, ns: string, name: string) =>
  children(el, ns, name)[0] ?? null;
const path = (
  el: Element | null | undefined,
  ...steps: [string, string][]
): Element | null =>
  steps.reduce<Element | null>(
    (at, [ns, name]) => child(at, ns, name),
    el ?? null,
  );
const descendants = (el: Element, ns: string, name: string) =>
  Array.from(el.getElementsByTagNameNS(ns, name));

async function readXml(zip: OfficeZip, part: string): Promise<Document> {
  const bytes = await zip.read(part, MAX_XML_PART_BYTES);
  try {
    return parseOfficeXml(officeXmlText(bytes));
  } catch {
    throw new Error(`${part} in the file is not well-formed XML`);
  }
}

function relationshipsPart(part: string) {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

async function readRelationships(
  zip: OfficeZip,
  part: string,
): Promise<Map<string, Relationship>> {
  const rels = new Map<string, Relationship>();
  const relsPart = relationshipsPart(part);
  if (!zip.has(relsPart)) return rels;
  const root = (await readXml(zip, relsPart)).documentElement;
  for (const rel of children(root, PKG_REL, "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    const external = rel.getAttribute("TargetMode") === "External";
    if (!id || !target) continue;
    rels.set(id, {
      type: rel.getAttribute("Type") ?? "",
      target: external ? target : officeRelationshipTarget(part, target),
      external,
    });
  }
  return rels;
}

const relOfType = (rels: Map<string, Relationship>, suffix: string) =>
  [...rels.values()].find(
    (rel) => !rel.external && rel.type.endsWith(`/${suffix}`),
  );

/** The slides in presentation order. */
export async function readPptxSlideList(
  zip: OfficeZip,
): Promise<PptxSlideEntry[]> {
  const rootRels = await readRelationships(zip, "");
  const main = relOfType(rootRels, "officeDocument")?.target;
  if (!main || !zip.has(main))
    throw new Error("The file names no presentation part.");
  const root = (await readXml(zip, main)).documentElement;
  if (root.namespaceURI !== P || root.localName !== "presentation")
    throw new Error(
      "The presentation is saved as Strict Open XML, which is not read.",
    );
  const rels = await readRelationships(zip, main);
  return children(child(root, P, "sldIdLst"), P, "sldId").flatMap((entry) => {
    const rel = rels.get(entry.getAttributeNS(R, "id") ?? "");
    const sldId = entry.getAttribute("id");
    return rel && sldId && !rel.external ? [{ sldId, part: rel.target }] : [];
  });
}

/** Paragraph text with line breaks as "\n", the way the live reads normalise it. */
function textBody(body: Element | null): { text: string; hasField: boolean } {
  let hasField = false;
  const paragraphs = children(body, A, "p").map((paragraph) =>
    Array.from(paragraph.children)
      .map((run) => {
        if (run.namespaceURI !== A) return "";
        if (run.localName === "br") return "\n";
        if (run.localName === "fld") hasField = true;
        if (run.localName === "r" || run.localName === "fld")
          return child(run, A, "t")?.textContent ?? "";
        return "";
      })
      .join(""),
  );
  return { text: paragraphs.join("\n"), hasField };
}

interface Transform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}
const IDENTITY: Transform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

function numberAttribute(el: Element | null, name: string): number | null {
  const value = el?.getAttribute(name);
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function xfrmBox(xfrm: Element | null, transform: Transform) {
  const off = child(xfrm, A, "off");
  const ext = child(xfrm, A, "ext");
  const x = numberAttribute(off, "x");
  const y = numberAttribute(off, "y");
  const cx = numberAttribute(ext, "cx");
  const cy = numberAttribute(ext, "cy");
  if (x === null || y === null || cx === null || cy === null) return undefined;
  const points = (emu: number) => Math.round((emu / EMU_PER_POINT) * 10) / 10;
  return {
    left: points(transform.offsetX + x * transform.scaleX),
    top: points(transform.offsetY + y * transform.scaleY),
    width: points(cx * transform.scaleX),
    height: points(cy * transform.scaleY),
  };
}

/** Maps a group's child coordinate space onto its parent's. */
function groupTransform(xfrm: Element | null, outer: Transform): Transform {
  const read = (name: string, x: string, y: string) => {
    const el = child(xfrm, A, name);
    return [numberAttribute(el, x) ?? 0, numberAttribute(el, y) ?? 0];
  };
  const [offX, offY] = read("off", "x", "y");
  const [extX, extY] = read("ext", "cx", "cy");
  const [chOffX, chOffY] = read("chOff", "x", "y");
  const [chExtX, chExtY] = read("chExt", "cx", "cy");
  const scaleX = chExtX ? extX / chExtX : 1;
  const scaleY = chExtY ? extY / chExtY : 1;
  return {
    scaleX: outer.scaleX * scaleX,
    scaleY: outer.scaleY * scaleY,
    offsetX: outer.offsetX + outer.scaleX * (offX - chOffX * scaleX),
    offsetY: outer.offsetY + outer.scaleY * (offY - chOffY * scaleY),
  };
}

/** The element PowerPoint shows for an mc:AlternateContent: its first choice, else the fallback. */
function resolveAlternate(el: Element): Element[] {
  if (el.namespaceURI !== MC || el.localName !== "AlternateContent")
    return [el];
  const branch =
    children(el, MC, "Choice").find((choice) =>
      Array.from(choice.children).some((c) => c.namespaceURI === P),
    ) ?? child(el, MC, "Fallback");
  return branch
    ? Array.from(branch.children).filter((c) => c.namespaceURI === P)
    : [];
}

interface SlideContext {
  zip: OfficeZip;
  rels: Map<string, Relationship>;
  unmodeled: number;
}

/** Shape tree members that are not shapes. */
const TREE_PROPERTIES = new Set(["nvGrpSpPr", "grpSpPr", "extLst"]);

async function readTree(
  container: Element,
  context: SlideContext,
  transform: Transform,
): Promise<PptxShape[]> {
  const shapes: PptxShape[] = [];
  for (const raw of Array.from(container.children)) {
    if (TREE_PROPERTIES.has(raw.localName)) continue;
    const members = resolveAlternate(raw);
    if (members.length === 0) context.unmodeled += 1;
    for (const el of members) {
      const shape = await readShape(el, context, transform);
      if (shape) shapes.push(shape);
      else context.unmodeled += 1;
    }
  }
  return shapes;
}

function nonVisual(el: Element) {
  // Ink (p:contentPart) keeps its id in the PowerPoint 2010 namespace: p14:nvContentPartPr/p14:cNvPr.
  const nv = Array.from(el.children).find((c) => c.localName.startsWith("nv"));
  const cNvPr = nv
    ? (Array.from(nv.children).find((c) => c.localName === "cNvPr") ?? null)
    : null;
  const ph = path(nv, [P, "nvPr"], [P, "ph"]);
  return {
    id: cNvPr?.getAttribute("id") ?? "",
    name: cNvPr?.getAttribute("name") ?? "",
    placeholder: ph ? (ph.getAttribute("type") ?? "body") : undefined,
    textBox:
      path(nv, [P, "cNvSpPr"])?.getAttribute("txBox") === "1" ||
      path(nv, [P, "cNvSpPr"])?.getAttribute("txBox") === "true",
  };
}

async function readShape(
  el: Element,
  context: SlideContext,
  transform: Transform,
): Promise<PptxShape | null> {
  if (el.namespaceURI !== P) return null;
  const nv = nonVisual(el);
  if (!nv.id) return null;
  const base: PptxShape = {
    id: nv.id,
    name: nv.name,
    type: "Unsupported",
    ...(nv.placeholder ? { placeholder: nv.placeholder } : {}),
  };
  const withBox = (xfrm: Element | null) => {
    const box = xfrmBox(xfrm, transform);
    if (box) base.box = box;
  };
  const withText = (body: Element | null) => {
    if (!body) return;
    const { text, hasField } = textBody(body);
    if (text) base.text = text;
    if (hasField) base.hasField = true;
  };
  switch (el.localName) {
    case "sp":
      base.type = nv.placeholder
        ? "Placeholder"
        : nv.textBox
          ? "TextBox"
          : "GeometricShape";
      withBox(path(el, [P, "spPr"], [A, "xfrm"]));
      withText(child(el, P, "txBody"));
      return base;
    case "cxnSp":
      base.type = "Line";
      withBox(path(el, [P, "spPr"], [A, "xfrm"]));
      return base;
    case "pic":
      base.type = "Image";
      withBox(path(el, [P, "spPr"], [A, "xfrm"]));
      return base;
    case "grpSp": {
      base.type = "Group";
      const xfrm = path(el, [P, "grpSpPr"], [A, "xfrm"]);
      withBox(xfrm);
      base.children = await readTree(
        el,
        context,
        groupTransform(xfrm, transform),
      );
      return base;
    }
    case "graphicFrame": {
      withBox(child(el, P, "xfrm"));
      const data = path(el, [A, "graphic"], [A, "graphicData"]);
      await readGraphic(base, data, context);
      return base;
    }
    case "contentPart":
      base.type = "Ink";
      return base;
    default:
      return null;
  }
}

function addUnread(shape: { unread?: string[] }, note: string) {
  shape.unread = [...(shape.unread ?? []), note];
}

async function readGraphic(
  shape: PptxShape,
  data: Element | null,
  context: SlideContext,
) {
  const uri = data?.getAttribute("uri") ?? "";
  if (uri === TABLE_URI) {
    shape.type = "Table";
    const table = child(data, A, "tbl");
    const rows = children(table, A, "tr");
    shape.table = {
      rows: rows.length,
      columns: children(child(table, A, "tblGrid"), A, "gridCol").length,
      values: rows.map((row) =>
        children(row, A, "tc").map((cell) =>
          // A merged-over cell repeats nothing; its text belongs to the cell that spans it.
          cell.getAttribute("hMerge") === "1" ||
          cell.getAttribute("vMerge") === "1"
            ? ""
            : textBody(child(cell, A, "txBody")).text,
        ),
      ),
    };
    return;
  }
  if (uri === C) {
    shape.type = "Chart";
    const rel = context.rels.get(
      child(data, C, "chart")?.getAttributeNS(R, "id") ?? "",
    );
    if (!rel || rel.external || !context.zip.has(rel.target)) {
      addUnread(shape, "chart data: the chart part is missing from the file");
      return;
    }
    try {
      shape.chart = readChart(await readXml(context.zip, rel.target));
    } catch (error) {
      addUnread(shape, `chart data: ${errorText(error)}`);
    }
    return;
  }
  if (uri === CHART_EX_URI) {
    shape.type = "Chart";
    addUnread(
      shape,
      "chart data: this chart type (waterfall, funnel, treemap, sunburst, histogram, box and whisker or map) is not read",
    );
    return;
  }
  if (uri === DGM) {
    shape.type = "SmartArt";
    const relId = child(data, DGM, "relIds")?.getAttributeNS(R, "dm") ?? "";
    const rel = context.rels.get(relId);
    if (!rel || rel.external || !context.zip.has(rel.target)) {
      addUnread(
        shape,
        "SmartArt text: the diagram data is missing from the file",
      );
      return;
    }
    try {
      const { nodes, cut } = readSmartArt(
        await readXml(context.zip, rel.target),
      );
      shape.smartArt = nodes;
      if (cut)
        addUnread(
          shape,
          `SmartArt nodes ${MAX_SMART_ART_NODES + 1}-${MAX_SMART_ART_NODES + cut}: cut to keep the result small`,
        );
    } catch (error) {
      addUnread(shape, `SmartArt text: ${errorText(error)}`);
    }
    return;
  }
  shape.type = uri === OLE_URI ? "Ole" : "Unsupported";
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

interface Cache {
  /** The first MAX_CHART_POINTS points by index; null where the cache has none. */
  points: (string | null)[];
  /** How many points the cache says it has. */
  count: number;
  /** The number format, unless General. */
  format?: string;
  numeric: boolean;
}

const isGeneral = (format: string | undefined) =>
  !format || format.trim().toLowerCase() === "general";

function readPoints(source: Element, numeric: boolean): Cache {
  const points: (string | null)[] = [];
  let count = numberAttribute(child(source, C, "ptCount"), "val") ?? 0;
  for (const pt of children(source, C, "pt")) {
    const idx = numberAttribute(pt, "idx");
    if (idx === null || idx < 0 || !Number.isInteger(idx)) continue;
    count = Math.max(count, idx + 1);
    if (idx >= MAX_CHART_POINTS) continue;
    while (points.length <= idx) points.push(null);
    points[idx] = child(pt, C, "v")?.textContent ?? null;
  }
  const visible = Math.min(count, MAX_CHART_POINTS);
  while (points.length < visible) points.push(null);
  const format = child(source, C, "formatCode")?.textContent ?? undefined;
  return {
    points,
    count,
    numeric,
    ...(isGeneral(format) ? {} : { format: format?.trim() }),
  };
}

/** Multi-level categories as "outer / inner": a level names a point only where its group starts. */
function multiLevel(cache: Element): Cache {
  const levels = children(cache, C, "lvl").map((lvl) => readPoints(lvl, false));
  const count = Math.max(
    numberAttribute(child(cache, C, "ptCount"), "val") ?? 0,
    ...levels.map((level) => level.count),
  );
  const visible = Math.min(count, MAX_CHART_POINTS);
  // c:lvl runs innermost first; the outer labels carry forward over their group.
  const carried = levels.map((level) => {
    let last: string | null = null;
    return Array.from({ length: visible }, (_, i) => {
      last = level.points[i] ?? last;
      return last;
    });
  });
  const points = Array.from({ length: visible }, (_, i) =>
    carried
      .map((level) => level[i])
      .filter((label): label is string => !!label)
      .reverse()
      .join(" / "),
  );
  return { points, count, numeric: false };
}

function cachedPoints(ref: Element | null): Cache | null {
  if (!ref) return null;
  const multi = descendants(ref, C, "multiLvlStrCache")[0];
  if (multi) return multiLevel(multi);
  const str = descendants(ref, C, "strCache")[0] ?? child(ref, C, "strLit");
  if (str) return readPoints(str, false);
  const num = descendants(ref, C, "numCache")[0] ?? child(ref, C, "numLit");
  if (num) return readPoints(num, true);
  return null;
}

/** Excel's own rule for a date format: d, m, y, h or s outside quotes, escapes and [..] codes. */
function isDateFormat(format: string | undefined): boolean {
  if (!format) return false;
  const bare = format
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /[dmyhs]/i.test(bare);
}

/** A date serial as an ISO date, the way the chart shows it as a date. */
function serialDate(serial: number, date1904: boolean): string {
  const days = date1904 ? serial + 1462 : serial < 60 ? serial + 1 : serial;
  const ms = Date.UTC(1899, 11, 30) + Math.round(days * 86400000);
  const iso = new Date(ms).toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16);
}

const toNumber = (value: string | null) => {
  if (value === null || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function labels(cache: Cache, date1904: boolean): string[] {
  const asDates = cache.numeric && isDateFormat(cache.format);
  return cache.points.map((point) => {
    if (point === null) return "";
    const number = asDates ? toNumber(point) : null;
    return capText(
      number === null ? point : serialDate(number, date1904),
      MAX_LABEL_CHARACTERS,
    );
  });
}

function richText(el: Element | null): string | undefined {
  if (!el) return undefined;
  const text = descendants(el, A, "t")
    .map((t) => t.textContent ?? "")
    .join("");
  if (text) return capText(text, MAX_NAME_CHARACTERS);
  const cached = cachedPoints(child(el, C, "strRef"));
  const joined =
    cached?.points.filter((v) => v !== null).join(" ") ||
    child(el, C, "v")?.textContent ||
    undefined;
  return joined ? capText(joined, MAX_NAME_CHARACTERS) : undefined;
}

const sameList = (a?: string[], b?: string[]) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

export function readChart(doc: Document): PowerPointChartOut {
  const space = doc.documentElement;
  const chart = path(space, [C, "chart"]);
  const plot = child(chart, C, "plotArea");
  if (!chart || !plot) throw new Error("the chart part has no plot area");
  const date1904 = child(space, C, "date1904")?.getAttribute("val") === "1";
  const unread: string[] = [];
  const kinds: string[] = [];
  const series: PowerPointChartSeriesOut[] = [];
  let total = 0;
  let longest = 0;
  for (const group of Array.from(plot.children)) {
    if (group.namespaceURI !== C || !group.localName.endsWith("Chart"))
      continue;
    const barDir = child(group, C, "barDir")?.getAttribute("val");
    const kind =
      group.localName.startsWith("bar") && barDir === "col"
        ? "column"
        : group.localName.replace(/(3D)?Chart$/, "");
    if (!kinds.includes(kind)) kinds.push(kind);
    for (const ser of children(group, C, "ser")) {
      total += 1;
      if (series.length >= MAX_CHART_SERIES) continue;
      const name = richText(child(ser, C, "tx"));
      const label = name ? `series "${name}"` : `series ${total}`;
      const categories = cachedPoints(child(ser, C, "cat"));
      const x = cachedPoints(child(ser, C, "xVal"));
      const values = cachedPoints(
        child(ser, C, "val") ?? child(ser, C, "yVal"),
      );
      const sizes = cachedPoints(child(ser, C, "bubbleSize"));
      if (!values) {
        unread.push(`${label} values: not saved with the chart`);
        continue;
      }
      longest = Math.max(longest, values.count, categories?.count ?? 0);
      series.push({
        ...(name ? { name } : {}),
        ...(categories ? { categories: labels(categories, date1904) } : {}),
        ...(x
          ? {
              x:
                x.numeric && !isDateFormat(x.format)
                  ? x.points.map(toNumber)
                  : labels(x, date1904),
            }
          : {}),
        values: values.points.map(toNumber),
        ...(values.format ? { format: values.format } : {}),
        ...(sizes ? { sizes: sizes.points.map(toNumber) } : {}),
      });
    }
  }
  if (longest > MAX_CHART_POINTS)
    unread.push(
      `points ${MAX_CHART_POINTS + 1}-${longest} of each series: cut to keep the result small`,
    );
  if (total > MAX_CHART_SERIES)
    unread.push(
      `series ${MAX_CHART_SERIES + 1}-${total}: cut to keep the result small`,
    );
  const shared =
    series.length > 0 &&
    series.every((s) => sameList(s.categories, series[0].categories));
  const title =
    child(chart, C, "autoTitleDeleted")?.getAttribute("val") === "1"
      ? undefined
      : richText(child(chart, C, "title"));
  return {
    type: kinds.join(", ") || "unknown",
    ...(title ? { title } : {}),
    ...(shared ? { categories: series[0].categories } : {}),
    series: shared
      ? series.map((s) => {
          const rest = { ...s };
          delete rest.categories;
          return rest;
        })
      : series,
    ...(unread.length > 0 ? { unread } : {}),
  };
}

const NODE_TYPES = new Set(["node", "asst"]);

export function readSmartArt(doc: Document): {
  nodes: PowerPointSmartArtNodeOut[];
  cut: number;
} {
  const model = doc.documentElement;
  const points = children(child(model, DGM, "ptLst"), DGM, "pt");
  const byId = new Map(
    points.map((pt) => [pt.getAttribute("modelId") ?? "", pt]),
  );
  const kids = new Map<string, { id: string; order: number }[]>();
  for (const cxn of children(child(model, DGM, "cxnLst"), DGM, "cxn")) {
    const type = cxn.getAttribute("type") ?? "parOf";
    if (type !== "parOf") continue;
    const src = cxn.getAttribute("srcId") ?? "";
    const list = kids.get(src) ?? [];
    list.push({
      id: cxn.getAttribute("destId") ?? "",
      order: numberAttribute(cxn, "srcOrd") ?? list.length,
    });
    kids.set(src, list);
  }
  const typeOf = (pt: Element) => pt.getAttribute("type") ?? "node";
  const textOf = (pt: Element) => textBody(child(pt, DGM, "t")).text;
  const nodes: PowerPointSmartArtNodeOut[] = [];
  let cut = 0;
  const seen = new Set<string>();
  const visit = (id: string, level: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const pt = byId.get(id);
    if (!pt) return;
    const isNode = NODE_TYPES.has(typeOf(pt));
    if (isNode) {
      const text = textOf(pt);
      if (text) {
        if (nodes.length < MAX_SMART_ART_NODES) nodes.push({ text, level });
        else cut += 1;
      }
    }
    for (const next of (kids.get(id) ?? []).sort((a, b) => a.order - b.order))
      visit(next.id, isNode ? level + 1 : level);
  };
  const root = points.find((pt) => typeOf(pt) === "doc");
  if (root) visit(root.getAttribute("modelId") ?? "", 1);
  // Nodes the connection list does not reach still carry text the user typed.
  for (const pt of points)
    if (NODE_TYPES.has(typeOf(pt))) visit(pt.getAttribute("modelId") ?? "", 1);
  return { nodes, cut };
}

export async function readPptxSlide(
  zip: OfficeZip,
  part: string,
): Promise<PptxSlide> {
  const root = (await readXml(zip, part)).documentElement;
  if (root.namespaceURI !== P || root.localName !== "sld")
    throw new Error("The slide part is not a slide.");
  const rels = await readRelationships(zip, part);
  const tree = path(root, [P, "cSld"], [P, "spTree"]);
  const context: SlideContext = { zip, rels, unmodeled: 0 };
  const shapes = tree ? await readTree(tree, context, IDENTITY) : [];
  const notesPage = relOfType(rels, "notesSlide");
  return {
    hidden:
      root.getAttribute("show") === "0" ||
      root.getAttribute("show") === "false",
    notes: await readNotes(zip, rels),
    hasNotesPage: !!notesPage && zip.has(notesPage.target),
    unmodeled: context.unmodeled,
    shapes,
  };
}

async function readNotes(
  zip: OfficeZip,
  rels: Map<string, Relationship>,
): Promise<string> {
  const notes = relOfType(rels, "notesSlide");
  if (!notes || !zip.has(notes.target)) return "";
  const root = (await readXml(zip, notes.target)).documentElement;
  const tree = path(root, [P, "cSld"], [P, "spTree"]);
  return children(tree, P, "sp")
    .filter((sp) => nonVisual(sp).placeholder === "body")
    .map((sp) => textBody(child(sp, P, "txBody")).text)
    .filter(Boolean)
    .join("\n");
}

/**
 * Every shape of a slide by id, group children included. PowerPoint keeps ids unique on a slide;
 * an id another tool wrote twice is left out of `byId` and listed in `duplicates`, since either
 * shape could be the one on screen.
 */
export function pptxShapesById(shapes: readonly PptxShape[]) {
  const byId = new Map<string, PptxShape>();
  const duplicates = new Set<string>();
  const walk = (list: readonly PptxShape[]) => {
    for (const shape of list) {
      if (byId.has(shape.id) || duplicates.has(shape.id)) {
        byId.delete(shape.id);
        duplicates.add(shape.id);
      } else byId.set(shape.id, shape);
      if (shape.children) walk(shape.children);
    }
  };
  walk(shapes);
  return { byId, duplicates };
}

/** Relationship targets the slide names that the package lacks, e.g. a chart an export left out. */
export async function missingSlideParts(
  zip: OfficeZip,
  part: string,
): Promise<string[]> {
  const rels = await readRelationships(zip, part);
  return [...rels.values()]
    .filter(
      (rel) =>
        !rel.external &&
        /\/(notesSlide|chart|diagramData)$/.test(rel.type) &&
        !zip.has(rel.target),
    )
    .map((rel) => rel.target);
}
