const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * The non-text items a rewrite keeps in place (ERMAIN-938). A field, note reference, picture or
 * line break is one point the text flows around; a link, comment range or content control holds
 * text the rewrite may change between its two ends.
 */
export type WordKeptItemKind =
  | "field"
  | "note"
  | "picture"
  | "break"
  | "link"
  | "comment"
  | "control";

const SPAN_KINDS: ReadonlySet<WordKeptItemKind> = new Set([
  "link",
  "comment",
  "control",
]);

export const isWordKeptSpan = (kind: WordKeptItemKind) => SPAN_KINDS.has(kind);

/** One item of a paragraph, in paragraph.text offsets. */
export interface WordKeptItem {
  kind: WordKeptItemKind;
  /**
   * Where it starts. A point shows `shows` from here; a span's text starts here. Equal to `end`
   * for a point that shows nothing in paragraph.text, as a picture does.
   */
  start: number;
  /** Exclusive: after a point's characters, or where a span's text ends. */
  end: number;
  /** What paragraph.text shows of a point: a field's result, "\u0002", "\u000B"; "" for a span. */
  shows: string;
  /** For the model and the card: a field's code, a link's target; "" when there is nothing to say. */
  detail: string;
  /** Document order, which breaks ties between items at the same offset; a span's start. */
  order: number;
  /** A span's end, in the same order. */
  closeOrder?: number;
  /** A span whose other end lies in another paragraph, as a comment range may. */
  openEnded?: "start" | "end";
  /** A comment without text of its own (a collapsed range, or only its anchor), kept as a point. */
  collapsed?: true;
}

/** Whether an item is placed as one point; a span's two ends are placed apart. */
export const isWordKeptPoint = (item: WordKeptItem) =>
  !isWordKeptSpan(item.kind) || item.collapsed === true;

/** Why a paragraph's items cannot be kept; the selection then stays context only. */
export type WordKeptItemsRefusal =
  | "unreadable"
  /** Content no item covers: a tracked change, a symbol, a page break, an equation, ... */
  | "unsupported"
  /** The runs and items do not spell paragraph.text, so no offset can be trusted. */
  | "misaligned";

export type WordParagraphItems =
  | {
      items: WordKeptItem[];
      /** Offsets of comment balloon anchors, which travel with the end of their comment's range. */
      references: number[];
    }
  | { refused: WordKeptItemsRefusal };

/** A w:t holding the character at `index`, or a w:tab. */
interface CharNode {
  node: Element;
  index: number;
}

type Event =
  | { type: "char"; char: string; field?: WordKeptItem; at?: CharNode }
  | {
      type: "point";
      item: WordKeptItem;
      expect: string | null;
      /** The first and last element the point is made of, children of its container. */
      first: Element;
      last: Element;
    }
  | {
      type: "open" | "close";
      item: WordKeptItem;
      /** The w:hyperlink or w:sdt, or the comment range mark. */
      node: Element;
      /** Where a link's or content control's own text goes. */
      inner?: Element;
    }
  | { type: "reference"; node: Element; order: number };

const isW = (element: Element, name?: string) =>
  element.namespaceURI === W && (!name || element.localName === name);

const attr = (element: Element, name: string) =>
  element.getAttributeNS(W, name) ?? element.getAttribute(`w:${name}`);

const children = (element: Element) => Array.from(element.children);

/** The paragraph a getOoxml() package holds, and its document. */
export function wordParagraphElement(
  ooxml: string,
): { doc: Document; paragraph: Element } | null {
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
  const paragraph = paragraphIn(doc);
  return paragraph ? { doc, paragraph } : null;
}

function paragraphIn(doc: Document): Element | null {
  const part =
    Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
      (p) =>
        (p.getAttributeNS(PKG, "name") ?? p.getAttribute("pkg:name")) ===
        "/word/document.xml",
    ) ?? doc.documentElement;
  const body = part.getElementsByTagNameNS(W, "body")[0];
  const paragraphs = body ? children(body).filter((c) => isW(c, "p")) : [];
  // Word appends an empty paragraph to a paragraph's package; the first one is the paragraph.
  return paragraphs[0] ?? null;
}

class Unsupported extends Error {}

/**
 * The paragraph's runs and items in document order, as paragraph.text spells them. Whatever this
 * does not know, it refuses rather than skips, so that an offset never lands on hidden content.
 */
function events(paragraph: Element): Event[] {
  const out: Event[] = [];
  let order = 0;
  const item = (kind: WordKeptItemKind, detail = ""): WordKeptItem => ({
    kind,
    start: -1,
    end: -1,
    shows: "",
    detail,
    order: order++,
  });
  const comments = new Map<string, WordKeptItem>();
  const goBack = new Set<string>();
  // A complex field: its code is not shown, its result is, and nested fields belong to the outer.
  let field: {
    item: WordKeptItem;
    depth: number;
    result: boolean;
    first: Element;
  } | null = null;
  const fieldChar = (type: string | null, run: Element) => {
    if (type === "begin") {
      if (field) field.depth += 1;
      else field = { item: item("field"), depth: 1, result: false, first: run };
      return;
    }
    if (!field) throw new Unsupported();
    if (type === "separate" && field.depth === 1) field.result = true;
    if (type === "end") {
      field.depth -= 1;
      if (field.depth === 0) {
        out.push({
          type: "point",
          item: field.item,
          expect: null,
          first: field.first,
          last: run,
        });
        field = null;
      }
    }
  };
  const text = (value: string, node: Element) => {
    if (field) {
      if (field.result)
        for (const char of value)
          out.push({ type: "char", char, field: field.item });
      return;
    }
    Array.from(value).forEach((char, index) =>
      out.push({ type: "char", char, at: { node, index } }),
    );
  };
  const point = (
    kind: WordKeptItemKind,
    expect: string | null,
    run: Element,
  ) => {
    if (field) throw new Unsupported();
    out.push({
      type: "point",
      item: item(kind),
      expect,
      first: run,
      last: run,
    });
  };
  const run = (element: Element) => {
    for (const child of children(element)) {
      if (!isW(child)) throw new Unsupported();
      switch (child.localName) {
        case "rPr":
          // Hidden text shows in paragraph.text on the web only, so no offset could be trusted.
          if (
            Array.from(child.children).some((c) =>
              ["vanish", "specVanish", "webHidden"].includes(c.localName),
            )
          )
            throw new Unsupported();
          break;
        case "lastRenderedPageBreak":
          break;
        case "t":
          text(child.textContent ?? "", child);
          break;
        case "tab":
          text("\t", child);
          break;
        case "instrText":
          if (!field) throw new Unsupported();
          if (field.depth === 1) field.item.detail += child.textContent ?? "";
          break;
        case "fldChar":
          fieldChar(attr(child, "fldCharType"), element);
          break;
        case "br": {
          const type = attr(child, "type");
          if (type && type !== "textWrapping") throw new Unsupported();
          point("break", "\u000B", element);
          break;
        }
        case "footnoteReference":
        case "endnoteReference":
          point("note", "\u0002", element);
          break;
        case "commentReference":
          // The balloon's anchor, shown as "\u0005" on the web only.
          if (field) throw new Unsupported();
          out.push({ type: "reference", node: element, order: order++ });
          break;
        case "drawing":
        case "pict":
        case "object":
          point("picture", null, element);
          break;
        default:
          throw new Unsupported();
      }
    }
  };
  const visit = (element: Element) => {
    for (const child of children(element)) {
      if (!isW(child)) throw new Unsupported();
      switch (child.localName) {
        case "pPr":
        case "proofErr":
          break;
        case "r":
          run(child);
          break;
        case "hyperlink": {
          if (field) throw new Unsupported();
          const link = item(
            "link",
            child.getAttributeNS(R, "id") ?? attr(child, "anchor") ?? "",
          );
          out.push({ type: "open", item: link, node: child, inner: child });
          visit(child);
          link.closeOrder = order++;
          out.push({ type: "close", item: link, node: child, inner: child });
          break;
        }
        case "fldSimple": {
          if (field) throw new Unsupported();
          const simple = item("field", attr(child, "instr") ?? "");
          const shown = Array.from(child.getElementsByTagNameNS(W, "t"))
            .map((t) => t.textContent ?? "")
            .join("");
          for (const char of shown)
            out.push({ type: "char", char, field: simple });
          out.push({
            type: "point",
            item: simple,
            expect: null,
            first: child,
            last: child,
          });
          break;
        }
        case "sdt": {
          if (field) throw new Unsupported();
          const props = children(child).find((c) => isW(c, "sdtPr"));
          if (props && children(props).some((c) => isW(c, "lock")))
            throw new Unsupported();
          const content = children(child).find((c) => isW(c, "sdtContent"));
          if (!content) throw new Unsupported();
          const control = item("control");
          out.push({
            type: "open",
            item: control,
            node: child,
            inner: content,
          });
          visit(content);
          control.closeOrder = order++;
          out.push({
            type: "close",
            item: control,
            node: child,
            inner: content,
          });
          break;
        }
        case "commentRangeStart": {
          const comment = item("comment");
          comments.set(attr(child, "id") ?? "", comment);
          out.push({ type: "open", item: comment, node: child });
          break;
        }
        case "commentRangeEnd": {
          const id = attr(child, "id") ?? "";
          const comment = comments.get(id) ?? item("comment");
          if (!comments.has(id)) {
            comment.openEnded = "start";
            comments.set(id, comment);
          }
          comment.closeOrder = order++;
          out.push({ type: "close", item: comment, node: child });
          break;
        }
        case "bookmarkStart":
          // Word's own "last edit" mark moves freely; any other bookmark is a target text can break.
          if (attr(child, "name") !== "_GoBack") throw new Unsupported();
          goBack.add(attr(child, "id") ?? "");
          break;
        case "bookmarkEnd":
          if (!goBack.has(attr(child, "id") ?? "")) throw new Unsupported();
          break;
        default:
          throw new Unsupported();
      }
    }
  };
  visit(paragraph);
  if (field) throw new Unsupported();
  for (const comment of comments.values())
    if (!out.some((e) => e.type === "close" && e.item === comment))
      comment.openEnded = "end";
  return out;
}

/** A paragraph's items and the elements behind its text, as the rewrite needs them. */
export interface WordAlignedParagraph {
  items: WordKeptItem[];
  /** Offsets of comment balloon anchors, which travel with the end of their comment's range. */
  references: number[];
  /** Per paragraph.text offset: the w:t or w:tab spelling it, null for an item's character. */
  chars: (CharNode | null)[];
  points: Map<WordKeptItem, { first: Element; last: Element }>;
  spans: Map<
    WordKeptItem,
    { open?: Element; close?: Element; inner?: Element }
  >;
  /** The run holding each comment balloon anchor, by its offset. */
  referenceRuns: Map<number, Element>;
}

/**
 * The items of one paragraph at their paragraph.text offsets. The runs, each item's shown
 * characters and nothing else must spell `rangeText` exactly; a picture shows nothing, a note
 * reference "\u0002", a line break "\u000B", a comment's anchor "\u0005" on the web only, and a
 * field its result.
 */
export function alignWordParagraph(
  paragraph: Element,
  rangeText: string,
): WordAlignedParagraph | { refused: WordKeptItemsRefusal } {
  let stream: Event[];
  try {
    stream = events(paragraph);
  } catch (error) {
    if (error instanceof Unsupported) return { refused: "unsupported" };
    throw error;
  }
  const aligned: WordAlignedParagraph = {
    items: [],
    references: [],
    chars: [],
    points: new Map(),
    spans: new Map(),
    referenceRuns: new Map(),
  };
  const span = (item: WordKeptItem) => {
    const known = aligned.spans.get(item) ?? {};
    aligned.spans.set(item, known);
    return known;
  };
  const anchors: { at: number; node: Element; order: number }[] = [];
  let at = 0;
  for (const event of stream) {
    switch (event.type) {
      case "char":
        if (rangeText[at] !== event.char) return { refused: "misaligned" };
        if (event.field && event.field.start < 0) event.field.start = at;
        aligned.chars[at] = event.at ?? null;
        at += 1;
        if (event.field) {
          event.field.end = at;
          event.field.shows += event.char;
        }
        break;
      case "point": {
        const point = event.item;
        if (point.kind === "field") {
          if (point.start < 0) point.start = point.end = at;
        } else if (event.expect !== null) {
          if (rangeText[at] !== event.expect) return { refused: "misaligned" };
          point.start = at;
          point.end = at + 1;
          point.shows = event.expect;
          aligned.chars[at] = null;
          at += 1;
        } else point.start = point.end = at;
        aligned.points.set(point, { first: event.first, last: event.last });
        aligned.items.push(point);
        break;
      }
      case "open":
        event.item.start = at;
        if (event.item.end < 0) event.item.end = at;
        Object.assign(span(event.item), {
          open: event.node,
          inner: event.inner,
        });
        aligned.items.push(event.item);
        break;
      case "close":
        if (event.item.start < 0) {
          event.item.start = 0;
          aligned.items.push(event.item);
        }
        event.item.end = at;
        Object.assign(span(event.item), {
          close: event.node,
          inner: event.inner,
        });
        break;
      case "reference":
        anchors.push({ at, node: event.node, order: event.order });
        if (rangeText[at] === "\u0005") {
          aligned.chars[at] = null;
          at += 1;
        }
        break;
    }
  }
  for (const item of aligned.items)
    if (item.openEnded === "end") item.end = rangeText.length;
  if (at !== rangeText.length) return { refused: "misaligned" };
  for (const anchor of anchors) placeAnchor(aligned, anchor, rangeText);
  aligned.items.sort((a, b) => a.order - b.order);
  return aligned;
}

/**
 * A comment's balloon anchor travels with the end of the range it closes. Without such a range,
 * or with a collapsed one, the comment has no text of its own and is kept as one point.
 */
function placeAnchor(
  aligned: WordAlignedParagraph,
  anchor: { at: number; node: Element; order: number },
  rangeText: string,
) {
  const { at, node, order } = anchor;
  const range = aligned.items.find(
    (item) =>
      item.kind === "comment" &&
      item.end === at &&
      item.openEnded !== "end" &&
      aligned.spans.get(item)?.close,
  );
  if (range && range.start < range.end) {
    aligned.references.push(at);
    aligned.referenceRuns.set(at, node);
    return;
  }
  const shows = rangeText[at] === "\u0005" ? "\u0005" : "";
  const point: WordKeptItem = range ?? {
    kind: "comment",
    start: at,
    end: at,
    shows: "",
    detail: "",
    order,
  };
  const span = aligned.spans.get(point);
  aligned.spans.delete(point);
  aligned.points.set(point, {
    first: span?.open ?? span?.close ?? node,
    last: node,
  });
  Object.assign(point, {
    start: at,
    end: at + shows.length,
    shows,
    collapsed: true,
  });
  if (!range) aligned.items.push(point);
}

/** The items of one paragraph at their paragraph.text offsets, read from its own OOXML. */
export function readWordParagraphItems(
  ooxml: string,
  rangeText: string,
): WordParagraphItems {
  const parsed = wordParagraphElement(ooxml);
  if (!parsed) return { refused: "unreadable" };
  const aligned = alignWordParagraph(parsed.paragraph, rangeText);
  if ("refused" in aligned) return aligned;
  return { items: aligned.items, references: aligned.references };
}

/** One kept item inside a selected part, as the model sees it. */
export interface WordKeptMarker {
  number: number;
  kind: WordKeptItemKind;
  /** A point, or the end of a span that lies inside the part. */
  end: "point" | "open" | "close";
  shows: string;
  detail: string;
}

export interface WordMarkedPart {
  /** The part with ⟦n⟧ in place of each point and ⟦n⟧ … ⟦/n⟧ at each end of a span inside it. */
  text: string;
  markers: WordKeptMarker[];
  next: number;
}

export const WORD_MARKER = /\u27E6(\/?)(\d+)\u27E7/g;
const MARKER_BRACKET = /[\u27E6\u27E7]/;

export const wordMarkerText = (
  marker: Pick<WordKeptMarker, "number" | "end">,
) => `\u27E6${marker.end === "close" ? "/" : ""}${marker.number}\u27E7`;

/**
 * The part [start, end) of a paragraph with its kept items marked. A point is inside when its
 * characters are; one that shows nothing, and each end of a span, only strictly inside, so that a
 * selection of exactly a link's or comment's text keeps the rewrite within it. Null when the part
 * cuts through a point, holds a bracket the markers use, or holds a comment's balloon anchor away
 * from its range's end.
 */
export function markWordSelectionPart(
  rangeText: string,
  read: { items: readonly WordKeptItem[]; references: readonly number[] },
  start: number,
  end: number,
  first = 1,
): WordMarkedPart | null {
  const part = wordPartBoundaries(rangeText, read, start, end);
  if (!part) return null;
  const { boundaries, hidden } = part;
  const numbers = new Map<WordKeptItem, number>();
  let next = first;
  const markers: WordKeptMarker[] = [];
  let text = "";
  let cursor = start;
  const flush = (to: number) => {
    for (; cursor < to; cursor += 1)
      if (!hidden.has(cursor)) text += rangeText[cursor];
  };
  for (const boundary of boundaries) {
    flush(boundary.at);
    let number = numbers.get(boundary.item);
    if (number === undefined) {
      number = next++;
      numbers.set(boundary.item, number);
    }
    const marker: WordKeptMarker = {
      number,
      kind: boundary.item.kind,
      end: boundary.end,
      shows: boundary.item.shows,
      detail: boundary.item.detail,
    };
    markers.push(marker);
    text += wordMarkerText(marker);
  }
  flush(end);
  return { text, markers, next };
}

/** One end of an item inside a selected part, where a marker goes. */
export interface WordPartBoundary {
  at: number;
  order: number;
  item: WordKeptItem;
  end: WordKeptMarker["end"];
}

/**
 * The items a part [start, end) marks, in order, and the offsets their characters hide. Null when
 * the part cuts through a point, holds a marker bracket, or a comment anchor away from its end.
 */
export function wordPartBoundaries(
  rangeText: string,
  read: { items: readonly WordKeptItem[]; references: readonly number[] },
  start: number,
  end: number,
): { boundaries: WordPartBoundary[]; hidden: Set<number> } | null {
  if (MARKER_BRACKET.test(rangeText.slice(start, end))) return null;
  const boundaries: WordPartBoundary[] = [];
  const hidden = new Set<number>();
  const strictly = (at: number) => start < at && at < end;
  for (const item of read.items) {
    if (isWordKeptPoint(item)) {
      const shows = item.end > item.start;
      const inside = shows
        ? start <= item.start && item.end <= end
        : strictly(item.start);
      if (inside) {
        boundaries.push({
          at: item.start,
          order: item.order,
          item,
          end: "point",
        });
        for (let k = item.start; k < item.end; k += 1) hidden.add(k);
      } else if (shows && item.start < end && item.end > start) return null;
      continue;
    }
    if (item.end === item.start) continue;
    if (item.openEnded !== "start" && strictly(item.start))
      boundaries.push({ at: item.start, order: item.order, item, end: "open" });
    if (item.openEnded !== "end" && strictly(item.end))
      boundaries.push({
        at: item.end,
        order: item.closeOrder ?? item.order,
        item,
        end: "close",
      });
  }
  for (const at of read.references) {
    const inside =
      rangeText[at] === "\u0005" ? start <= at && at < end : strictly(at);
    if (!inside) continue;
    const closes = boundaries.some(
      (b) => b.end === "close" && b.item.kind === "comment" && b.at === at,
    );
    if (!closes) return null;
    if (rangeText[at] === "\u0005") hidden.add(at);
  }
  boundaries.sort((a, b) => a.at - b.at || a.order - b.order);
  return { boundaries, hidden };
}

export type WordMarkedLine =
  | {
      /** The text before, between and after the markers: one more than there are markers. */
      pieces: string[];
    }
  | { refused: "MARKERS_CHANGED" };

/**
 * A rewritten line split at its markers. It must hold exactly the part's markers, in their order,
 * and no other bracket: a lost, doubled or moved marker would delete or misplace an item.
 */
export function splitWordMarkedLine(
  line: string,
  markers: readonly Pick<WordKeptMarker, "number" | "end">[],
): WordMarkedLine {
  const pieces: string[] = [];
  let k = 0;
  let last = 0;
  for (const match of line.matchAll(WORD_MARKER)) {
    const expected = markers[k];
    const close = match[1] === "/";
    if (
      !expected ||
      Number(match[2]) !== expected.number ||
      close !== (expected.end === "close")
    )
      return { refused: "MARKERS_CHANGED" };
    pieces.push(line.slice(last, match.index));
    last = match.index + match[0].length;
    k += 1;
  }
  pieces.push(line.slice(last));
  if (
    k !== markers.length ||
    pieces.some((piece) => MARKER_BRACKET.test(piece))
  )
    return { refused: "MARKERS_CHANGED" };
  return { pieces };
}
