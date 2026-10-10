import { WORD_BOOKMARK } from "./wordSelectionSpan";

import type {
  WordFormatRange,
  WordFormatSpan,
} from "./wordSelectionFormatSpans";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * The non-text items a rewrite keeps in place (ERMAIN-938). A field, note reference, picture or
 * line break is one point the text flows around; a link, comment range or content control holds
 * text the rewrite may change between its two ends. A bookmark holds text too, but is invisible:
 * it gets no marker, so the model never sees it.
 */
export type WordKeptItemKind =
  | "field"
  | "note"
  | "picture"
  | "break"
  | "link"
  | "comment"
  | "control"
  | "bookmark";

const SPAN_KINDS: ReadonlySet<WordKeptItemKind> = new Set([
  "link",
  "comment",
  "control",
  "bookmark",
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
  /**
   * For the model and the card: a field's code, a link's target; "" when there is nothing to say. A
   * bookmark's name, which only the checks read.
   */
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
  /**
   * Content no item covers: a tracked change, a symbol, a page break, an equation, a bookmark
   * inside a field, a table column's bookmark, a bookmark that runs into another paragraph,
   * anything between the package's paragraphs, ...
   */
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
  // Besides the paragraph, the package holds only Word's empty paragraph and the section's
  // properties; marks between paragraphs, such as those of a bookmark around whole paragraphs,
  // would go unread and still be written back.
  const body = paragraph.parentElement;
  if (
    body &&
    isW(body, "body") &&
    children(body).some((c) => !isW(c, "p") && !isW(c, "sectPr"))
  )
    throw new Unsupported();
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
  const bookmarks = new Map<string, WordKeptItem>();
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
          for (const mark of Array.from(
            child.getElementsByTagNameNS(W, "bookmarkStart"),
          )) {
            if (attr(mark, "name") !== WORD_BOOKMARK) throw new Unsupported();
            goBack.add(attr(mark, "id") ?? "");
          }
          for (const mark of Array.from(
            child.getElementsByTagNameNS(W, "bookmarkEnd"),
          ))
            if (!goBack.has(attr(mark, "id") ?? "")) throw new Unsupported();
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
        case "bookmarkStart": {
          const id = attr(child, "id") ?? "";
          const name = attr(child, "name") ?? "";
          if (name === WORD_BOOKMARK) {
            goBack.add(id);
            break;
          }
          // Inside a field it marks part of the field's code or result, which is kept whole; a
          // table column's bookmark covers cells, not text.
          if (
            field ||
            attr(child, "colFirst") !== null ||
            attr(child, "colLast") !== null
          )
            throw new Unsupported();
          const bookmark = item("bookmark", name);
          bookmarks.set(id, bookmark);
          out.push({ type: "open", item: bookmark, node: child });
          break;
        }
        case "bookmarkEnd": {
          const id = attr(child, "id") ?? "";
          if (goBack.has(id)) break;
          const bookmark = bookmarks.get(id);
          if (field || !bookmark) throw new Unsupported();
          bookmarks.delete(id);
          bookmark.closeOrder = order++;
          out.push({ type: "close", item: bookmark, node: child });
          break;
        }
        default:
          throw new Unsupported();
      }
    }
  };
  visit(paragraph);
  // A bookmark with only one end here, as one that runs into another paragraph has, refuses: BM0
  // measured bookmarks within one paragraph only, so whether insertOoxml keeps it is not known.
  if (field || bookmarks.size > 0) throw new Unsupported();
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
  /**
   * The part with ⟦n⟧ in place of each point and ⟦n⟧ … ⟦/n⟧ at each end of a span inside it, and
   * ⟦n⟧ … ⟦/n⟧ around each format span.
   */
  text: string;
  /** The kept items' markers only. */
  markers: WordKeptMarker[];
  next: number;
  /** Every kind of item the whole paragraph keeps, inside the part or not. */
  kinds?: readonly WordKeptItemKind[];
  /** The format spans (ERMAIN-943), in the order they appear; absent when there are none. */
  formats?: WordFormatSpan[];
}

export const WORD_MARKER = /\u27E6(\/?)(\d+)\u27E7/g;
const MARKER_BRACKET = /[\u27E6\u27E7]/;

export const wordMarkerText = (
  marker: Pick<WordKeptMarker, "number" | "end">,
) => `\u27E6${marker.end === "close" ? "/" : ""}${marker.number}\u27E7`;

/**
 * The part [start, end) of a paragraph with its kept items marked. A point is inside when its
 * characters are; one that shows nothing, and each end of a span, only strictly inside, so that a
 * selection of exactly a link's or comment's text keeps the rewrite within it. A bookmark is never
 * marked. Null when the part cuts through a point, holds a bracket the markers use, holds a
 * comment's balloon anchor away from its range's end, or has a bookmark start or end inside it.
 * Each of `formats`, which lie between the items' boundaries, gets ⟦n⟧ … ⟦/n⟧ around its text.
 */
export function markWordSelectionPart(
  rangeText: string,
  read: { items: readonly WordKeptItem[]; references: readonly number[] },
  start: number,
  end: number,
  first = 1,
  formats: readonly Pick<WordFormatRange, "start" | "end" | "emphasis">[] = [],
): WordMarkedPart | null {
  const part = wordPartBoundaries(rangeText, read, start, end);
  if (!part) return null;
  const { boundaries, hidden } = part;
  // A format span lies inside one piece: it ends before the boundary that ends the piece, and
  // starts after the one that starts it.
  const marks = [
    ...boundaries.map((boundary, index) => ({
      at: boundary.at,
      rank: 1,
      index,
      boundary,
    })),
    ...formats.flatMap((range, index) => [
      { at: range.start, rank: 2, index, range, close: false },
      { at: range.end, rank: 0, index, range, close: true },
    ]),
  ].sort((a, b) => a.at - b.at || a.rank - b.rank || a.index - b.index);
  const numbers = new Map<object, number>();
  let next = first;
  const numberOf = (key: object) => {
    let number = numbers.get(key);
    if (number === undefined) {
      number = next++;
      numbers.set(key, number);
    }
    return number;
  };
  const markers: WordKeptMarker[] = [];
  const spans: WordFormatSpan[] = [];
  let text = "";
  let cursor = start;
  const flush = (to: number) => {
    for (; cursor < to; cursor += 1)
      if (!hidden.has(cursor)) text += rangeText[cursor];
  };
  for (const mark of marks) {
    flush(mark.at);
    if ("range" in mark) {
      const number = numberOf(mark.range);
      if (!mark.close) spans.push({ number, emphasis: mark.range.emphasis });
      text += wordMarkerText({ number, end: mark.close ? "close" : "open" });
      continue;
    }
    const { boundary } = mark;
    const marker: WordKeptMarker = {
      number: numberOf(boundary.item),
      kind: boundary.item.kind,
      end: boundary.end,
      shows: boundary.item.shows,
      detail: boundary.item.detail,
    };
    markers.push(marker);
    text += wordMarkerText(marker);
  }
  flush(end);
  return { text, markers, next, ...(spans.length ? { formats: spans } : {}) };
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
 * the part cuts through a point, holds a marker bracket, a comment anchor away from its end, or a
 * bookmark end anywhere but beside an item it marks.
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
    if (item.kind === "bookmark") continue;
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
  // A bookmark has no marker, so the model cannot say where it goes in new text: it stays only
  // where the part's edges or another item pin it.
  const pinned = new Set<number>();
  for (const boundary of boundaries) {
    pinned.add(boundary.at);
    if (boundary.end === "point") pinned.add(boundary.item.end);
    else if (
      boundary.end === "close" &&
      boundary.item.kind === "comment" &&
      rangeText[boundary.at] === "\u0005"
    )
      pinned.add(boundary.at + 1);
  }
  const stays = (at: number) => at <= start || at >= end || pinned.has(at);
  if (
    read.items.some(
      (item) =>
        item.kind === "bookmark" && !(stays(item.start) && stays(item.end)),
    )
  )
    return null;
  return { boundaries, hidden };
}

/** Text of a rewritten line between two of its markers. */
export interface WordLinePart {
  text: string;
  /** The number of the format span it lies in; null outside every span. */
  format: number | null;
}

export type WordMarkedLine =
  | {
      /**
       * The text before, between and after the item markers, without format markers: one more
       * than there are item markers.
       */
      pieces: string[];
      /** Each piece's text cut at the format markers, without empty parts. */
      parts: WordLinePart[][];
      /** Format spans the line leaves out or leaves empty, in their order. */
      dropped: number[];
    }
  | { refused: "MARKERS_CHANGED" };

/**
 * A rewritten line split at its markers. It must hold exactly the part's item markers, in their
 * order, and no other bracket: a lost, doubled or moved marker would delete or misplace an item.
 * A format span is lenient (ERMAIN-943): its pair may move, change order or go, also across an item
 * marker, since without it its text only takes the formatting the rest of its piece shares. An
 * unknown or doubled number, a pair inside another, or an end without its other end is refused.
 */
export function splitWordMarkedLine(
  line: string,
  markers: readonly Pick<WordKeptMarker, "number" | "end">[],
  formats: readonly number[] = [],
): WordMarkedLine {
  const refused = { refused: "MARKERS_CHANGED" } as const;
  const known = new Set(formats);
  const opened = new Set<number>();
  const written = new Set<number>();
  const pieces = [""];
  const parts: WordLinePart[][] = [[]];
  let open: number | null = null;
  let k = 0;
  let last = 0;
  const add = (text: string) => {
    if (!text) return true;
    if (MARKER_BRACKET.test(text)) return false;
    pieces[pieces.length - 1] += text;
    parts[parts.length - 1].push({ text, format: open });
    if (open !== null) written.add(open);
    return true;
  };
  for (const match of line.matchAll(WORD_MARKER)) {
    if (!add(line.slice(last, match.index))) return refused;
    last = match.index + match[0].length;
    const number = Number(match[2]);
    const close = match[1] === "/";
    if (known.has(number)) {
      if (close ? open !== number : open !== null || opened.has(number))
        return refused;
      opened.add(number);
      open = close ? null : number;
      continue;
    }
    const expected = markers[k];
    if (
      !expected ||
      number !== expected.number ||
      close !== (expected.end === "close")
    )
      return refused;
    pieces.push("");
    parts.push([]);
    k += 1;
  }
  if (!add(line.slice(last)) || k !== markers.length || open !== null)
    return refused;
  return {
    pieces,
    parts,
    dropped: formats.filter((number) => !written.has(number)),
  };
}

/**
 * What a write must leave of a paragraph's items: their kinds, shown text and details, in order. A
 * dropped or renamed bookmark changes it too.
 */
export const wordKeptItemsShape = (items: readonly WordKeptItem[]) =>
  JSON.stringify(
    items.map(({ kind, shows, detail, openEnded, collapsed }) => ({
      kind,
      shows,
      detail,
      openEnded,
      collapsed,
    })),
  );

/** Where a paragraph's bookmarks lie, which a write must leave over the text it expects. */
export const wordBookmarkRanges = (items: readonly WordKeptItem[]) =>
  JSON.stringify(
    items.flatMap((item) =>
      item.kind === "bookmark" ? [[item.start, item.end]] : [],
    ),
  );
