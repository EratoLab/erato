import {
  cloneWordMediaNode,
  isWordMediaElementActive,
} from "./wordMediaComparison";
import { nativeVisibleText } from "./wordNativeContent";

import type { WordPlanBlock } from "./wordDocumentPlan";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";

export type WordStoryType =
  | "header"
  | "footer"
  | "footnote"
  | "endnote"
  | "comment";
export interface WordStoryAnchor {
  block: string;
  /** UTF-16 offsets into the referenced paragraph's visible text. */
  start?: number;
  end?: number;
}
export interface WordStoryChange {
  kind: "upsert" | "delete";
  type: WordStoryType;
  id: string;
  blocks?: WordPlanBlock[];
  author?: string;
  initials?: string;
  anchor?: WordStoryAnchor;
}
export interface WordPageLayout {
  orientation?: "portrait" | "landscape";
  /** Page dimensions and margins are in points (72 points = one inch). */
  width?: number;
  height?: number;
  margins?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
    header?: number;
    footer?: number;
    gutter?: number;
  };
  columns?: number;
  columnSpacing?: number;
  break?: "nextPage" | "continuous" | "evenPage" | "oddPage";
  pageNumberStart?: number;
  differentFirstPage?: boolean;
  differentOddEvenPages?: boolean;
}
export interface WordSectionPlan {
  id: string;
  source?: string;
  /** End this section after an output block. The last section omits after. */
  after?: string;
  layout?: WordPageLayout;
  headers?: WordSectionStories;
  footers?: WordSectionStories;
}
export interface WordSectionStories {
  default?: string | null;
  first?: string | null;
  even?: string | null;
}
export interface WordStorySource {
  id: string;
  type: WordStoryType;
  text: string;
  author?: string;
  initials?: string;
  xml: string;
  part: string;
  nativeId?: string;
  anchored?: boolean;
}
export interface WordSectionSource {
  afterBlock?: string;
  id: string;
  layout: WordPageLayout;
  headers: WordSectionStories;
  footers: WordSectionStories;
  afterParagraph?: number;
  xml: string;
}

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).every((name) => names.includes(name));
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const number = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number) =>
  typeof v === "string" &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const elements = (root: Document | Element, name: string) =>
  Array.from(root.getElementsByTagNameNS(W, name)).filter(
    isWordMediaElementActive,
  );
const child = (root: Element | undefined, name: string) =>
  Array.from(root?.children ?? []).find(
    (e) => e.namespaceURI === W && e.localName === name,
  );
const attr = (root: Element | undefined, name = "val") =>
  root?.getAttributeNS(W, name) ?? "";
const make = (doc: Document, name: string, value?: string) => {
  const node = doc.createElementNS(W, `w:${name}`);
  if (value !== undefined) node.setAttributeNS(W, "w:val", value);
  return node;
};
const serialize = (node: Element) =>
  new XMLSerializer().serializeToString(cloneWordMediaNode(node));

export function parseWordStoryChanges(
  value: unknown,
  parseBlock: (value: unknown) => WordPlanBlock | null,
): WordStoryChange[] | null {
  if (!Array.isArray(value) || value.length > 2000) return null;
  const seen = new Set<string>();
  const result: WordStoryChange[] = [];
  for (const v of value) {
    if (
      !record(v) ||
      !keys(v, [
        "kind",
        "type",
        "id",
        "blocks",
        "author",
        "initials",
        "anchor",
      ]) ||
      !["upsert", "delete"].includes(String(v.kind)) ||
      !["header", "footer", "footnote", "endnote", "comment"].includes(
        String(v.type),
      ) ||
      !id(v.id) ||
      seen.has(v.id)
    )
      return null;
    seen.add(v.id);
    if (v.kind === "delete") {
      if (!keys(v, ["kind", "type", "id"])) return null;
      result.push(v as unknown as WordStoryChange);
      continue;
    }
    if (!Array.isArray(v.blocks) || v.blocks.length > 2000) return null;
    const blocks = v.blocks.map((block) => parseBlock(block));
    if (blocks.some((b) => !b)) return null;
    if (
      (v.author !== undefined && !text(v.author, 255)) ||
      (v.initials !== undefined && !text(v.initials, 32)) ||
      ((v.author !== undefined || v.initials !== undefined) &&
        v.type !== "comment")
    )
      return null;
    if (v.anchor !== undefined) {
      const a = v.anchor;
      if (
        ["header", "footer"].includes(String(v.type)) ||
        !record(a) ||
        !keys(a, ["block", "start", "end"]) ||
        !id(a.block) ||
        [a.start, a.end].some(
          (n) =>
            n !== undefined && (!number(n, 0, 1000000) || !Number.isInteger(n)),
        ) ||
        (a.start !== undefined &&
          a.end !== undefined &&
          Number(a.end) < Number(a.start))
      )
        return null;
    }
    result.push({ ...v, blocks } as unknown as WordStoryChange);
  }
  return result;
}

export function parseWordSections(value: unknown): WordSectionPlan[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 2000)
    return null;
  const ids = new Set<string>();
  const after = new Set<string>();
  for (const [index, v] of value.entries()) {
    if (
      !record(v) ||
      !keys(v, ["id", "source", "after", "layout", "headers", "footers"]) ||
      !id(v.id) ||
      ids.has(v.id) ||
      (v.source !== undefined && !id(v.source))
    )
      return null;
    ids.add(v.id);
    if (index === value.length - 1 ? v.after !== undefined : !id(v.after))
      return null;
    if (typeof v.after === "string") {
      if (after.has(v.after)) return null;
      after.add(v.after);
    }
    if (v.layout !== undefined && !validLayout(v.layout)) return null;
    for (const references of [v.headers, v.footers]) {
      if (references === undefined) continue;
      if (
        !record(references) ||
        !keys(references, ["default", "first", "even"]) ||
        Object.values(references).some((ref) => ref !== null && !id(ref))
      )
        return null;
    }
  }
  return value as WordSectionPlan[];
}

function validLayout(v: unknown): v is WordPageLayout {
  if (
    !record(v) ||
    !keys(v, [
      "orientation",
      "width",
      "height",
      "margins",
      "columns",
      "columnSpacing",
      "break",
      "pageNumberStart",
      "differentFirstPage",
      "differentOddEvenPages",
    ])
  )
    return false;
  if (
    (v.orientation !== undefined &&
      !["portrait", "landscape"].includes(String(v.orientation))) ||
    [v.width, v.height].some((n) => n !== undefined && !number(n, 72, 1584)) ||
    (v.columns !== undefined &&
      (!number(v.columns, 1, 12) || !Number.isInteger(v.columns))) ||
    (v.columnSpacing !== undefined && !number(v.columnSpacing, 0, 720)) ||
    (v.break !== undefined &&
      !["nextPage", "continuous", "evenPage", "oddPage"].includes(
        String(v.break),
      )) ||
    (v.pageNumberStart !== undefined &&
      (!number(v.pageNumberStart, 1, 32767) ||
        !Number.isInteger(v.pageNumberStart))) ||
    [v.differentFirstPage, v.differentOddEvenPages].some(
      (b) => b !== undefined && typeof b !== "boolean",
    )
  )
    return false;
  if (
    v.margins !== undefined &&
    (!record(v.margins) ||
      !keys(v.margins, [
        "top",
        "right",
        "bottom",
        "left",
        "header",
        "footer",
        "gutter",
      ]) ||
      Object.values(v.margins).some((n) => !number(n, 0, 720)))
  )
    return false;
  return true;
}

function packageParts(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(PKG, "part"));
}
function partRoot(part: Element): Element | undefined {
  return (
    Array.from(part.children).find(
      (n) => n.namespaceURI === PKG && n.localName === "xmlData",
    )?.firstElementChild ?? undefined
  );
}
function partName(part: Element): string {
  return part.getAttributeNS(PKG, "name") ?? "";
}
function sourceId(
  type: WordStoryType,
  path: string,
  nativeId?: string,
): string {
  return nativeId === undefined
    ? path
        .split("/")
        .pop()!
        .replace(/\.xml$/, "")
    : `${type}-${nativeId}`;
}

export function extractWordStories(doc: Document): WordStorySource[] {
  const output: WordStorySource[] = [];
  for (const part of packageParts(doc)) {
    const root = partRoot(part);
    if (!root || root.namespaceURI !== W) continue;
    const type: WordStoryType | undefined =
      root.localName === "hdr"
        ? "header"
        : root.localName === "ftr"
          ? "footer"
          : root.localName === "footnotes"
            ? "footnote"
            : root.localName === "endnotes"
              ? "endnote"
              : root.localName === "comments"
                ? "comment"
                : undefined;
    if (!type) continue;
    const nodes = ["header", "footer"].includes(type)
      ? [root]
      : Array.from(root.children).filter(
          (e) =>
            e.namespaceURI === W &&
            e.localName === type &&
            ![
              "separator",
              "continuationSeparator",
              "continuationNotice",
            ].includes(attr(e, "type")) &&
            Number(attr(e, "id")) >= 0,
        );
    for (const node of nodes) {
      const nativeId = ["header", "footer"].includes(type)
        ? undefined
        : attr(node, "id");
      output.push({
        id: sourceId(type, partName(part), nativeId),
        type,
        text: nativeVisibleText(node),
        ...(type === "comment"
          ? { author: attr(node, "author"), initials: attr(node, "initials") }
          : {}),
        xml: serialize(node),
        part: partName(part),
        ...(nativeId !== undefined ? { nativeId } : {}),
        ...(nativeId !== undefined
          ? {
              anchored: elements(doc, `${type}Reference`).some(
                (r) => attr(r, "id") === nativeId,
              ),
            }
          : {}),
      });
    }
  }
  return output;
}

function mainBody(doc: Document): Element {
  const main = packageParts(doc).find(
    (p) => partName(p) === "/word/document.xml",
  );
  const body =
    main && partRoot(main) ? child(partRoot(main), "body") : undefined;
  if (!body) throw new Error("The document body is unavailable.");
  return body;
}

function relationshipTarget(
  doc: Document,
  relationId: string,
): string | undefined {
  const part = packageParts(doc).find(
    (p) => partName(p) === "/word/_rels/document.xml.rels",
  );
  const relation =
    part && partRoot(part)
      ? Array.from(partRoot(part)!.children).find(
          (r) => r.getAttribute("Id") === relationId,
        )
      : undefined;
  const target = relation?.getAttribute("Target");
  return target
    ? target.startsWith("/")
      ? target
      : `/word/${target}`
    : undefined;
}

function layoutOf(section: Element): WordPageLayout {
  const size = child(section, "pgSz"),
    margins = child(section, "pgMar"),
    columns = child(section, "cols"),
    start = child(section, "pgNumType");
  const result: WordPageLayout = {};
  if (size) {
    if (attr(size, "w")) result.width = Number(attr(size, "w")) / 20;
    if (attr(size, "h")) result.height = Number(attr(size, "h")) / 20;
    result.orientation =
      attr(size, "orient") === "landscape" ? "landscape" : "portrait";
  }
  if (margins) {
    result.margins = {};
    for (const name of [
      "top",
      "right",
      "bottom",
      "left",
      "header",
      "footer",
      "gutter",
    ] as const)
      if (attr(margins, name))
        result.margins[name] = Number(attr(margins, name)) / 20;
  }
  if (columns) {
    result.columns = Number(attr(columns, "num") || "1");
    if (attr(columns, "space"))
      result.columnSpacing = Number(attr(columns, "space")) / 20;
  }
  const boundary = attr(child(section, "type"));
  if (["nextPage", "continuous", "evenPage", "oddPage"].includes(boundary))
    result.break = boundary as WordPageLayout["break"];
  if (start && attr(start, "start"))
    result.pageNumberStart = Number(attr(start, "start"));
  result.differentFirstPage =
    !!child(section, "titlePg") &&
    !["0", "false", "off"].includes(attr(child(section, "titlePg")));
  return result;
}

export function extractWordSections(doc: Document): WordSectionSource[] {
  const body = mainBody(doc);
  const paragraphs = elements(body, "p");
  return elements(body, "sectPr").map((node, i) => {
    const headers: WordSectionStories = {},
      footers: WordSectionStories = {};
    for (const e of Array.from(node.children)) {
      if (
        e.namespaceURI !== W ||
        !["headerReference", "footerReference"].includes(e.localName)
      )
        continue;
      const target = relationshipTarget(doc, e.getAttributeNS(R, "id") ?? "");
      const type = attr(e, "type");
      if (!target || !["default", "first", "even"].includes(type)) continue;
      (e.localName === "headerReference" ? headers : footers)[
        type as keyof WordSectionStories
      ] = sourceId(
        e.localName === "headerReference" ? "header" : "footer",
        target,
      );
    }
    const paragraph = node.parentElement?.parentElement;
    const index = paragraph ? paragraphs.indexOf(paragraph) : -1;
    return {
      id: `section-${i + 1}`,
      layout: layoutOf(node),
      headers,
      footers,
      ...(index >= 0 ? { afterParagraph: index + 1 } : {}),
      xml: serialize(node),
    };
  });
}

function ensurePart(
  doc: Document,
  path: string,
  local: string,
  content: string,
): Element {
  const existing = packageParts(doc).find((p) => partName(p) === path);
  if (existing) {
    const root = partRoot(existing);
    if (!root) throw new Error("A story part is malformed.");
    return root;
  }
  const part = doc.createElementNS(PKG, "pkg:part");
  part.setAttributeNS(PKG, "pkg:name", path);
  part.setAttributeNS(PKG, "pkg:contentType", content);
  const data = doc.createElementNS(PKG, "pkg:xmlData");
  const root = doc.createElementNS(
    local === "Relationships" ? REL : W,
    local === "Relationships" ? local : `w:${local}`,
  );
  data.append(root);
  part.append(data);
  doc.documentElement.append(part);
  return root;
}
function ensureRelationship(doc: Document, path: string, type: string): string {
  const root = ensurePart(
    doc,
    "/word/_rels/document.xml.rels",
    "Relationships",
    "application/vnd.openxmlformats-package.relationships+xml",
  );
  const target = path.replace(/^\/word\//, "");
  const existing = Array.from(root.children).find(
    (r) =>
      r.getAttribute("Type") === `${R}/${type}` &&
      r.getAttribute("Target") === target,
  );
  if (existing) return existing.getAttribute("Id")!;
  let n = 1;
  const ids = new Set(Array.from(root.children, (r) => r.getAttribute("Id")));
  while (ids.has(`rIdErato${n}`)) n++;
  const rel = doc.createElementNS(REL, "Relationship");
  rel.setAttribute("Id", `rIdErato${n}`);
  rel.setAttribute("Type", `${R}/${type}`);
  rel.setAttribute("Target", target);
  root.append(rel);
  return `rIdErato${n}`;
}
function storyContentType(type: WordStoryType): string {
  const suffix = type === "header" || type === "footer" ? type : `${type}s`;
  return `application/vnd.openxmlformats-officedocument.wordprocessingml.${suffix}+xml`;
}
function storyElement(
  doc: Document,
  source: WordStorySource,
): Element | undefined {
  const part = packageParts(doc).find((p) => partName(p) === source.part);
  const root = part && partRoot(part);
  return source.nativeId === undefined
    ? root
    : root &&
        Array.from(root.children).find(
          (e) => attr(e, "id") === source.nativeId,
        );
}
function stripReferences(
  doc: Document,
  type: WordStoryType,
  nativeId: string,
): void {
  const names =
    type === "comment"
      ? ["commentRangeStart", "commentRangeEnd", "commentReference"]
      : [`${type}Reference`];
  for (const name of names)
    for (const node of elements(doc, name))
      if (attr(node, "id") === nativeId) {
        const parent = node.parentElement;
        node.remove();
        if (
          parent?.namespaceURI === W &&
          parent.localName === "r" &&
          Array.from(parent.children).every((e) => e.localName === "rPr")
        )
          parent.remove();
      }
}
function stripModernCommentMetadata(doc: Document, comment: Element): void {
  const ids = new Set(
    elements(comment, "p")
      .map((p) => p.getAttributeNS(W14, "paraId"))
      .filter(Boolean),
  );
  const durableIds = new Set<string>();
  for (const part of packageParts(doc)) {
    if (!/\/comments(?:Extended|Ids)\.xml$/.test(partName(part))) continue;
    const root = partRoot(part);
    if (!root) continue;
    for (const e of Array.from(root.children))
      if (
        Array.from(e.attributes).some(
          (a) => a.localName === "paraId" && ids.has(a.value),
        )
      ) {
        for (const a of Array.from(e.attributes))
          if (a.localName === "durableId") durableIds.add(a.value);
        e.remove();
      } else {
        // A surviving reply must not retain a dangling reference to a removed
        // parent paragraph. Its own body and metadata remain independently held.
        for (const a of Array.from(e.attributes))
          if (a.localName === "paraIdParent" && ids.has(a.value))
            e.removeAttributeNode(a);
      }
  }
  for (const part of packageParts(doc)) {
    if (!/\/commentsExtensible\.xml$/.test(partName(part))) continue;
    const root = partRoot(part);
    if (!root) continue;
    for (const e of Array.from(root.children))
      if (
        Array.from(e.attributes).some(
          (a) => a.localName === "durableId" && durableIds.has(a.value),
        )
      )
        e.remove();
  }
}
function storyParagraphs(root: Element): Element[] {
  return root.namespaceURI === W && root.localName === "p"
    ? [root]
    : elements(root, "p");
}
function visibleText(root: Element): string {
  return Array.from(root.getElementsByTagNameNS(W, "*"))
    .filter(isWordMediaElementActive)
    .map((e) =>
      e.localName === "t"
        ? (e.textContent ?? "")
        : e.localName === "tab"
          ? "\t"
          : ["br", "cr"].includes(e.localName)
            ? "\n"
            : "",
    )
    .join("");
}

function markerInParagraph(
  paragraph: Element,
  offset: number,
  marker: Element,
): void {
  const length = visibleText(paragraph).length;
  if (!Number.isInteger(offset) || offset < 0 || offset > length)
    throw new Error("An annotation offset is outside its paragraph.");
  if (offset === 0) {
    const first = Array.from(paragraph.children).find(
      (e) => !(e.namespaceURI === W && e.localName === "pPr"),
    );
    paragraph.insertBefore(marker, first ?? null);
    return;
  }
  let position = 0;
  for (const run of elements(paragraph, "r")) {
    const runText = visibleText(run);
    if (position + runText.length < offset) {
      position += runText.length;
      continue;
    }
    const cut = offset - position;
    if (cut === 0) {
      run.before(marker);
      return;
    }
    if (cut === runText.length) {
      run.after(marker);
      return;
    }
    if (
      Array.from(run.children).some(
        (e) =>
          e.namespaceURI !== W ||
          !["rPr", "t", "tab", "br", "cr"].includes(e.localName),
      )
    )
      throw new Error("This annotation splits a non-text Word run.");
    const left = run.cloneNode(false) as Element,
      right = run.cloneNode(false) as Element;
    let cursor = 0;
    for (const e of Array.from(run.children)) {
      if (e.localName === "rPr") {
        left.append(e.cloneNode(true));
        right.append(e.cloneNode(true));
        continue;
      }
      const content =
        e.localName === "t"
          ? (e.textContent ?? "")
          : e.localName === "tab"
            ? "\t"
            : "\n";
      const boundary = Math.max(0, Math.min(content.length, cut - cursor));
      if (boundary > 0) {
        const copy = e.cloneNode(true) as Element;
        if (e.localName === "t") {
          copy.textContent = content.slice(0, boundary);
          copy.setAttributeNS(
            "http://www.w3.org/XML/1998/namespace",
            "xml:space",
            "preserve",
          );
        }
        left.append(copy);
      }
      if (boundary < content.length) {
        const copy = e.cloneNode(true) as Element;
        if (e.localName === "t") {
          copy.textContent = content.slice(boundary);
          copy.setAttributeNS(
            "http://www.w3.org/XML/1998/namespace",
            "xml:space",
            "preserve",
          );
        }
        right.append(copy);
      }
      cursor += content.length;
    }
    run.replaceWith(left, marker, right);
    return;
  }
  if (offset === length) paragraph.append(marker);
  else throw new Error("An annotation anchor could not be located.");
}

function addStoryAnchor(
  doc: Document,
  story: WordStoryChange,
  nativeId: string,
  output: ReadonlyMap<string, Element>,
): void {
  const anchor = story.anchor;
  if (!anchor) throw new Error("A new note or comment needs an anchor.");
  const block = output.get(anchor.block);
  const paragraphs = block ? storyParagraphs(block) : [];
  if (!paragraphs.length)
    throw new Error("An annotation anchor does not refer to a text block.");
  const total = paragraphs.reduce((sum, p) => sum + visibleText(p).length, 0);
  const start = anchor.start ?? (story.type === "comment" ? 0 : total);
  const end = anchor.end ?? (story.type === "comment" ? total : start);
  if (start > end || end > total)
    throw new Error("An annotation anchor is outside its block.");
  const locate = (offset: number) => {
    let remaining = offset;
    for (const p of paragraphs) {
      const length = visibleText(p).length;
      if (remaining <= length) return { p, offset: remaining };
      remaining -= length;
    }
    throw new Error("An annotation anchor could not be located.");
  };
  if (story.type === "comment") {
    const from = locate(start),
      to = locate(end);
    const endMarker = make(doc, "commentRangeEnd");
    endMarker.setAttributeNS(W, "w:id", nativeId);
    markerInParagraph(to.p, to.offset, endMarker);
    const startMarker = make(doc, "commentRangeStart");
    startMarker.setAttributeNS(W, "w:id", nativeId);
    markerInParagraph(from.p, from.offset, startMarker);
    const run = make(doc, "r"),
      reference = make(doc, "commentReference");
    reference.setAttributeNS(W, "w:id", nativeId);
    const properties = storyMarkerProperties(doc, "CommentReference", true);
    if (properties) run.append(properties);
    run.append(reference);
    endMarker.after(run);
  } else {
    const at = locate(start);
    const run = make(doc, "r"),
      reference = make(doc, `${story.type}Reference`);
    reference.setAttributeNS(W, "w:id", nativeId);
    run.append(reference);
    markerInParagraph(at.p, at.offset, run);
  }
}

/** Word drops style references absent from the inventory.
 * Annotation markers use native styles; comment bodies retain the default size. */
function storyMarkerProperties(
  doc: Document,
  styleId: string,
  bodyComment = false,
): Element | undefined {
  const style = elements(doc, "style").find(
    (s) => attr(s, "type") === "character" && attr(s, "styleId") === styleId,
  );
  if (!style) return undefined;
  const properties = make(doc, "rPr");
  properties.append(make(doc, "rStyle", styleId));
  if (bodyComment) {
    const defaults = child(elements(doc, "rPrDefault")[0], "rPr");
    for (const name of ["sz", "szCs"]) {
      const size = child(defaults, name);
      if (size) properties.append(size.cloneNode(true));
    }
  }
  return properties;
}

/**
 * Compile typed stories into the retained package. The block callback must use
 * owner for image/hyperlink relationships instead of attaching them to the body.
 */
export function compileWordStories(
  doc: Document,
  changes: readonly WordStoryChange[],
  compileBlocks: (blocks: WordPlanBlock[], owner: string) => Element[],
  output: ReadonlyMap<string, Element>,
  originalStories?: readonly WordStorySource[],
): void {
  const before = originalStories ?? extractWordStories(doc);
  const existing = new Map(extractWordStories(doc).map((s) => [s.id, s]));
  for (const change of changes) {
    const source = existing.get(change.id);
    if (source && source.type !== change.type)
      throw new Error("A story reference has the wrong type.");
    if (change.kind === "delete") {
      if (!source) throw new Error("The story to remove no longer exists.");
      const node = storyElement(doc, source)!;
      if (source.nativeId !== undefined) {
        if (change.type === "comment") stripModernCommentMetadata(doc, node);
        node.remove();
        stripReferences(doc, change.type, source.nativeId);
      } else {
        // Removing a header/footer reference enables inheritance; an explicit blank part prevents it.
        node.replaceChildren(make(doc, "p"));
      }
      continue;
    }
    let path = source?.part;
    let node = source ? storyElement(doc, source) : undefined;
    let nativeId = source?.nativeId;
    if (!node) {
      if (change.type === "header" || change.type === "footer") {
        let index = 1;
        const names = new Set(packageParts(doc).map(partName));
        while (names.has(`/word/${change.type}Erato${index}.xml`)) index++;
        path = `/word/${change.type}Erato${index}.xml`;
        node = ensurePart(
          doc,
          path,
          change.type === "header" ? "hdr" : "ftr",
          storyContentType(change.type),
        );
      } else {
        path = `/word/${change.type}s.xml`;
        const root = ensurePart(
          doc,
          path,
          `${change.type}s`,
          storyContentType(change.type),
        );
        if (change.type !== "comment" && !root.children.length) {
          for (const [specialId, specialType] of [
            ["-1", "separator"],
            ["0", "continuationSeparator"],
          ]) {
            const special = make(doc, change.type);
            special.setAttributeNS(W, "w:id", specialId);
            special.setAttributeNS(W, "w:type", specialType);
            const p = make(doc, "p"),
              r = make(doc, "r");
            // Word materializes standard note-separator geometry on import; retain existing custom separators.
            const properties = make(doc, "pPr"),
              spacing = make(doc, "spacing");
            spacing.setAttributeNS(W, "w:after", "0");
            spacing.setAttributeNS(W, "w:line", "240");
            spacing.setAttributeNS(W, "w:lineRule", "auto");
            properties.append(spacing);
            r.append(make(doc, specialType));
            p.append(properties, r);
            special.append(p);
            root.append(special);
          }
          const settings = ensurePart(
            doc,
            "/word/settings.xml",
            "settings",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
          );
          ensureRelationship(doc, "/word/settings.xml", "settings");
          let noteProperties = child(settings, `${change.type}Pr`);
          if (!noteProperties) {
            noteProperties = make(doc, `${change.type}Pr`);
            // CT_Settings orders note settings immediately before compatibility settings.
            const following = Array.from(settings.children).find(
              (e) =>
                e.namespaceURI !== W ||
                [
                  ...(change.type === "footnote" ? ["endnotePr"] : []),
                  "compat",
                  "docVars",
                  "rsids",
                  "mathPr",
                  "uiCompat97To2003",
                  "attachedSchema",
                  "themeFontLang",
                  "clrSchemeMapping",
                  "doNotIncludeSubdocsInStats",
                  "doNotAutoCompressPictures",
                  "forceUpgrade",
                  "captions",
                  "readModeInkLockDown",
                  "schemaLibrary",
                  "shapeDefaults",
                  "decimalSymbol",
                  "listSeparator",
                ].includes(e.localName),
            );
            settings.insertBefore(noteProperties, following ?? null);
          }
          for (const specialId of ["-1", "0"])
            if (
              !Array.from(noteProperties.children).some(
                (e) =>
                  e.localName === change.type && attr(e, "id") === specialId,
              )
            ) {
              const reference = make(doc, change.type);
              reference.setAttributeNS(W, "w:id", specialId);
              noteProperties.append(reference);
            }
        }
        const ids = new Set(
          Array.from(root.children).map((e) => attr(e, "id")),
        );
        let index = change.type === "comment" ? 0 : 1;
        while (ids.has(String(index))) index++;
        nativeId = String(index);
        node = make(doc, change.type);
        node.setAttributeNS(W, "w:id", nativeId);
        root.append(node);
      }
    }
    ensureRelationship(
      doc,
      path!,
      change.type === "header" || change.type === "footer"
        ? change.type
        : `${change.type}s`,
    );
    const paragraphs = elements(node, "p");
    const oldLastId = paragraphs.at(-1)?.getAttributeNS(W14, "paraId");
    const compiled = compileBlocks(change.blocks ?? [], path!);
    node.replaceChildren(...(compiled.length ? compiled : [make(doc, "p")]));
    if (change.type === "footnote" || change.type === "endnote") {
      const paragraph = elements(node, "p")[0];
      if (!paragraph) throw new Error("A note must contain a paragraph.");
      const run = make(doc, "r");
      const properties = storyMarkerProperties(
        doc,
        change.type === "footnote" ? "FootnoteReference" : "EndnoteReference",
      );
      if (properties) run.append(properties);
      run.append(make(doc, `${change.type}Ref`));
      const first = Array.from(paragraph.children).find(
        (e) => e.localName !== "pPr",
      );
      paragraph.insertBefore(run, first ?? null);
    }
    if (change.type === "comment") {
      const paragraph = elements(node, "p")[0];
      if (!paragraph) throw new Error("A comment must contain a paragraph.");
      const marker = make(doc, "r");
      const properties = storyMarkerProperties(doc, "CommentReference");
      if (properties) marker.append(properties);
      marker.append(make(doc, "annotationRef"));
      paragraph.insertBefore(
        marker,
        Array.from(paragraph.children).find((e) => e.localName !== "pPr") ??
          null,
      );
      if (change.author !== undefined || !source)
        node.setAttributeNS(W, "w:author", change.author ?? "Erato");
      if (change.initials !== undefined)
        node.setAttributeNS(W, "w:initials", change.initials);
      // Modern comment metadata names the last paragraph of the comment.
      if (oldLastId)
        elements(node, "p")
          .at(-1)
          ?.setAttributeNS(W14, "w14:paraId", oldLastId);
    }
    if (nativeId !== undefined) {
      if (change.anchor) {
        stripReferences(doc, change.type, nativeId);
        addStoryAnchor(doc, change, nativeId, output);
      } else if (!source) addStoryAnchor(doc, change, nativeId, output);
    }
    // Map model labels to native IDs during compilation; never use them directly as OPC paths.
    existing.set(change.id, {
      id: change.id,
      type: change.type,
      part: path!,
      nativeId,
      xml: serialize(node),
      text: visibleText(node),
    });
  }
  storyAliases.set(doc, existing);
  pruneWordStoryReferences(doc, before);
}

const storyAliases = new WeakMap<Document, Map<string, WordStorySource>>();

export function pruneWordStoryReferences(
  doc: Document,
  originalStories?: readonly WordStorySource[],
): void {
  const originallyAnchored = new Set(
    (originalStories ?? [])
      .filter((s) => s.anchored)
      .map((s) => `${s.type}:${s.nativeId}`),
  );
  for (const type of ["footnote", "endnote", "comment"] as const) {
    const references = elements(doc, `${type}Reference`);
    const ids = new Set(references.map((r) => attr(r, "id")));
    const stories = extractWordStories(doc).filter((s) => s.type === type);
    const available = new Set(stories.map((s) => s.nativeId));
    if ([...ids].some((reference) => !available.has(reference)))
      throw new Error("An annotation reference has no content.");
    for (const source of stories)
      if (
        !ids.has(source.nativeId!) &&
        originallyAnchored.has(`${type}:${source.nativeId}`)
      ) {
        const node = storyElement(doc, source)!;
        if (type === "comment") stripModernCommentMetadata(doc, node);
        node.remove();
        stripReferences(doc, type, source.nativeId!);
      }
  }
}

function setChild(doc: Document, parent: Element, name: string): Element {
  const existing = child(parent, name);
  if (existing) return existing;
  const value = make(doc, name);
  if (parent.namespaceURI === W && parent.localName === "p" && name === "pPr")
    parent.prepend(value);
  else parent.append(value);
  return value;
}

function orderSectionProperties(section: Element): void {
  const order = [
    "headerReference",
    "footerReference",
    "footnotePr",
    "endnotePr",
    "type",
    "pgSz",
    "pgMar",
    "paperSrc",
    "pgBorders",
    "lnNumType",
    "pgNumType",
    "cols",
    "formProt",
    "vAlign",
    "noEndnote",
    "titlePg",
    "textDirection",
    "bidi",
    "rtlGutter",
    "docGrid",
    "printerSettings",
    "footnoteColumns",
    "sectPrChange",
  ];
  // CT_SectPr requires property order; inserting out of order makes Word repair the section.
  const rank = (node: Element) => {
    const index = order.indexOf(node.localName);
    return index < 0 ? order.length : index;
  };
  const nodes = Array.from(section.children).sort((a, b) => rank(a) - rank(b));
  for (const node of nodes) section.append(node);
}
function setLayout(
  doc: Document,
  section: Element,
  layout: WordPageLayout,
): void {
  if (
    layout.width !== undefined ||
    layout.height !== undefined ||
    layout.orientation !== undefined
  ) {
    const size = setChild(doc, section, "pgSz");
    let width = layout.width ?? Number(attr(size, "w") || "12240") / 20;
    let height = layout.height ?? Number(attr(size, "h") || "15840") / 20;
    if (
      layout.orientation &&
      layout.width === undefined &&
      layout.height === undefined &&
      (layout.orientation === "landscape") !== width > height
    )
      [width, height] = [height, width];
    size.setAttributeNS(W, "w:w", String(Math.round(width * 20)));
    size.setAttributeNS(W, "w:h", String(Math.round(height * 20)));
    if (layout.orientation)
      size.setAttributeNS(W, "w:orient", layout.orientation);
  }
  if (layout.margins) {
    const margins = setChild(doc, section, "pgMar");
    for (const [key, value] of Object.entries(layout.margins))
      margins.setAttributeNS(W, `w:${key}`, String(Math.round(value * 20)));
  }
  if (layout.columns !== undefined || layout.columnSpacing !== undefined) {
    const columns = setChild(doc, section, "cols");
    if (layout.columns !== undefined) {
      columns.setAttributeNS(W, "w:num", String(layout.columns));
      columns.setAttributeNS(W, "w:equalWidth", "1");
      columns.replaceChildren();
    }
    if (layout.columnSpacing !== undefined)
      columns.setAttributeNS(
        W,
        "w:space",
        String(Math.round(layout.columnSpacing * 20)),
      );
  }
  if (layout.break !== undefined)
    setChild(doc, section, "type").setAttributeNS(W, "w:val", layout.break);
  if (layout.pageNumberStart !== undefined)
    setChild(doc, section, "pgNumType").setAttributeNS(
      W,
      "w:start",
      String(layout.pageNumberStart),
    );
  if (layout.differentFirstPage !== undefined) {
    if (layout.differentFirstPage)
      setChild(doc, section, "titlePg").setAttributeNS(W, "w:val", "1");
    else child(section, "titlePg")?.remove();
  }
  if (layout.differentOddEvenPages !== undefined) {
    const settings = ensurePart(
      doc,
      "/word/settings.xml",
      "settings",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
    );
    ensureRelationship(doc, "/word/settings.xml", "settings");
    if (layout.differentOddEvenPages)
      setChild(doc, settings, "evenAndOddHeaders").setAttributeNS(
        W,
        "w:val",
        "1",
      );
    else child(settings, "evenAndOddHeaders")?.remove();
  }
  const size = child(section, "pgSz"),
    margins = child(section, "pgMar");
  const pageWidth = Number(attr(size, "w") || "12240"),
    pageHeight = Number(attr(size, "h") || "15840");
  if (
    Number(attr(margins, "left") || "0") +
      Number(attr(margins, "right") || "0") >=
      pageWidth ||
    Number(attr(margins, "top") || "0") +
      Number(attr(margins, "bottom") || "0") >=
      pageHeight
  )
    throw new Error("Page margins must leave space for document content.");
}

export function compileWordSections(
  doc: Document,
  sections: readonly WordSectionPlan[],
  output: ReadonlyMap<string, Element>,
  originalSections?: readonly WordSectionSource[],
): void {
  const body = mainBody(doc);
  const sources = originalSections
    ? new Map(
        originalSections.map((source) => {
          const parsed = new DOMParser().parseFromString(
            source.xml,
            "application/xml",
          );
          if (parsed.getElementsByTagName("parsererror").length)
            throw new Error("The section source is malformed.");
          return [source.id, doc.importNode(parsed.documentElement, true)];
        }),
      )
    : new Map(
        elements(body, "sectPr").map((node, i) => [
          `section-${i + 1}`,
          node.cloneNode(true) as Element,
        ]),
      );
  const stories =
    storyAliases.get(doc) ??
    new Map(extractWordStories(doc).map((s) => [s.id, s]));
  const oddEven = new Set(
    sections.flatMap((s) =>
      s.layout?.differentOddEvenPages === undefined
        ? []
        : [s.layout.differentOddEvenPages],
    ),
  );
  if (oddEven.size > 1)
    throw new Error("Odd/even header settings apply to the complete document.");
  const positions = new Map(
    Array.from(body.children).map((node, index) => [node, index]),
  );
  let previous = -1;
  const targets = sections.map((section, i) => {
    if (!section.after) {
      if (i !== sections.length - 1)
        throw new Error("Only the final section can omit its boundary.");
      return undefined;
    }
    const anchor = output.get(section.after);
    const index = anchor ? positions.get(anchor) : undefined;
    if (!anchor || index === undefined || index <= previous)
      throw new Error(
        "Section boundaries must follow the output document order.",
      );
    previous = index;
    return anchor;
  });
  if (!sections.length || sections.at(-1)?.after)
    throw new Error("A final section is required.");
  for (const node of elements(body, "sectPr")) node.remove();
  for (const [index, section] of sections.entries()) {
    const template = section.source
      ? sources.get(section.source)
      : [...sources.values()].at(-1);
    if (section.source && !template)
      throw new Error("The section source no longer exists.");
    const properties = template
      ? (template.cloneNode(true) as Element)
      : make(doc, "sectPr");
    if (section.layout) setLayout(doc, properties, section.layout);
    for (const [type, mapping] of [
      ["header", section.headers],
      ["footer", section.footers],
    ] as const) {
      if (!mapping) continue;
      for (const [variant, storyId] of Object.entries(mapping)) {
        for (const reference of Array.from(properties.children))
          if (
            reference.namespaceURI === W &&
            reference.localName === `${type}Reference` &&
            attr(reference, "type") === variant
          )
            reference.remove();
        let path: string;
        if (storyId === null) {
          path = `/word/${type}EratoEmpty${index + 1}${variant}.xml`;
          const empty = ensurePart(
            doc,
            path,
            type === "header" ? "hdr" : "ftr",
            storyContentType(type),
          );
          empty.replaceChildren(make(doc, "p"));
        } else {
          const story = stories.get(storyId);
          if (!story || story.type !== type)
            throw new Error("A section refers to a missing header or footer.");
          path = story.part;
        }
        const reference = make(doc, `${type}Reference`);
        reference.setAttributeNS(W, "w:type", variant);
        reference.setAttributeNS(
          R,
          "r:id",
          ensureRelationship(doc, path, type),
        );
        properties.prepend(reference);
      }
    }
    orderSectionProperties(properties);
    const target = targets[index];
    if (!target) body.append(properties);
    else if (target.namespaceURI === W && target.localName === "p")
      setChild(doc, target, "pPr").append(properties);
    else {
      const paragraph = make(doc, "p"),
        propertiesParent = make(doc, "pPr");
      propertiesParent.append(properties);
      paragraph.append(propertiesParent);
      target.after(paragraph);
    }
  }
}
