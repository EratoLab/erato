import { wordCommentAnchorText } from "./wordCommentPackage";

import type { WordCommentAnchorText } from "./wordCommentPackage";
import type {
  WordCommentParagraphRef,
  WordCommentThreadRecord,
} from "./wordCommentReader";
import type { WordSelectionSnapshot } from "./wordSelectionAnchor";
import type {
  WordCommentContainer,
  WordCommentSelection,
  WordCommentVs,
  WordCommentWhere,
} from "@erato/frontend/word-review";

/**
 * Where threads lie, from coordinates only (contract §5, Annex A §3.2): review paragraph numbers
 * and offsets in paragraph.text, the system the v2 capture's startOffset and endOffset count in.
 * `pos` ranks anchor starts across the document, `vs` and `away` relate each anchor to the selection
 * captured at Send, and `overlaps` names anchors that overlap or nest. Never from items order
 * (F-10) or getSelection().getComments() (F-11). Where a paragraph has no offsets, what the
 * coordinates cannot decide is left out rather than guessed.
 */

/** Characters kept at each end of a long quote. */
export const WORD_COMMENT_WHERE_QUOTE_EDGE_CHARS = 80;

export interface WordCommentCoordinates {
  /** Review paragraph numbers of the anchor's first and last paragraph; null when unknown. */
  first: number | null;
  last: number | null;
  /** Offsets in paragraph.text of the first and the last paragraph; null without an exact anchor. */
  start: number | null;
  end: number | null;
  /** No anchored text: a reference alone (F-12). */
  point: boolean;
}

export interface WordCommentPositionInput {
  ref: string;
  at: WordCommentCoordinates;
  in: WordCommentContainer;
  /** The read's document order, for what the coordinates do not decide. */
  order: number;
  /** The anchor's compareLocationWith the selection Word had at the read, for what offsets cannot decide. */
  selection?: string;
  /**
   * The selection's own getComments() named the thread at the read (Word for the web, which relates
   * no anchor's range): it touches the selection, at a caret or inside a passage.
   */
  touches?: true;
  /** Word did not order the anchor against the others in its first paragraph (orderUnsure). */
  unsure?: true;
}

/** The selection captured at Send, in the same coordinates. */
export interface WordCommentSelectionCoordinates {
  first: number;
  last: number;
  /** Null where only the paragraph is known, as for a caret, which the v2 capture does not read. */
  start: number | null;
  end: number | null;
  caret?: true;
}

export interface WordCommentPosition {
  /** Dense and 1-based; threads whose anchors start at the same place share it. */
  pos: number;
  vs?: WordCommentVs;
  /**
   * The anchor touches a passage, which neither its coordinates nor a relation could name as a vs;
   * pane-only, so the thread still counts as in the selection.
   */
  touches?: true;
  away?: number;
  in: WordCommentContainer;
  overlaps?: string[];
}

interface Point {
  para: number;
  offset: number | null;
}

/** p before q; undefined in one paragraph without both offsets. */
function lt(p: Point, q: Point): boolean | undefined {
  if (p.para !== q.para) return p.para < q.para;
  return p.offset === null || q.offset === null
    ? undefined
    : p.offset < q.offset;
}

const not = (value: boolean | undefined) =>
  value === undefined ? undefined : !value;
const le = (p: Point, q: Point) => not(lt(q, p));
const and = (a: boolean | undefined, b: boolean | undefined) =>
  a === false || b === false ? false : a && b;

interface Span {
  start: Point;
  end: Point;
  point: boolean;
}

function spanOf({ first, last, start, end, point }: WordCommentCoordinates) {
  if (first === null) return null;
  const through = last ?? first;
  return {
    start: { para: first, offset: start },
    end: { para: through, offset: end ?? (point ? start : null) },
    point,
  } satisfies Span;
}

/** The thread's place in the document, from what the read knows. */
export function wordCommentCoordinates(
  record: WordCommentThreadRecord,
): WordCommentCoordinates {
  const anchor = record.anchor;
  const placement = record.placement;
  const first = anchor?.first.ordinal ?? null;
  const last = anchor?.last.ordinal ?? (anchor?.single ? first : null);
  const placed = placement?.status === "placed" ? placement : null;
  return {
    first,
    last,
    start: placed?.offsets.start.range ?? null,
    end: placed?.offsets.end.range ?? null,
    point: placed
      ? placed.anchor.point === true
      : !!anchor &&
        anchor.rangeText !== null &&
        anchor.rangeText.replace(/[\u0002\u0005\r\n\u0007]/g, "") === "",
  };
}

/** A top-level table cell as the contract numbers it, 1-based; "body" otherwise. */
export function wordCommentContainer(
  paragraph: WordCommentParagraphRef | null | undefined,
): WordCommentContainer {
  return paragraph?.cell && paragraph.table !== null
    ? {
        table: paragraph.table,
        row: paragraph.cell.row + 1,
        cell: paragraph.cell.cell + 1,
      }
    : "body";
}

export function wordCommentPositionInput(
  record: WordCommentThreadRecord,
  ref: string,
): WordCommentPositionInput {
  return {
    ref,
    at: wordCommentCoordinates(record),
    in: wordCommentContainer(record.anchor?.first),
    order: record.order,
    ...(record.selection ? { selection: record.selection } : {}),
    ...(record.touchesSelection ? { touches: true as const } : {}),
    ...(record.orderUnsure ? { unsure: true as const } : {}),
  };
}

/**
 * The v2 capture's span as review coordinates; null outside the main body or when its paragraphs
 * are not placed. A span whose offsets are unknown keeps its paragraphs.
 */
export function wordCommentSelectionCoordinates(
  selection: Pick<
    WordSelectionSnapshot,
    "story" | "paragraphs" | "startOffset" | "endOffset"
  >,
): WordCommentSelectionCoordinates | null {
  const { paragraphs } = selection;
  const first = paragraphs[0]?.index ?? -1;
  const last = paragraphs[paragraphs.length - 1]?.index ?? -1;
  if (selection.story !== "main" || first < 0 || last < first) return null;
  const placed = selection.startOffset >= 0 && selection.endOffset >= 0;
  return {
    first: first + 1,
    last: last + 1,
    start: placed ? selection.startOffset : null,
    end: placed ? selection.endOffset : null,
  };
}

/** A caret Word reported in one review paragraph, whose offset no read gives. */
export function wordCommentCaretCoordinates(
  para: number,
): WordCommentSelectionCoordinates {
  return { first: para, last: para, start: null, end: null, caret: true };
}

const isCaret = (s: WordCommentSelectionCoordinates) =>
  s.caret === true ||
  (s.first === s.last && s.start !== null && s.start === s.end);

export function wordCommentSelection(
  selection: WordCommentSelectionCoordinates,
): WordCommentSelection {
  return { para: [selection.first, selection.last], caret: isCaret(selection) };
}

/** Annex A's vs: the anchor against the selection; edges count as touching a caret or a point. */
function vsOf(
  anchor: Span,
  selection: WordCommentSelectionCoordinates,
): WordCommentVs | undefined {
  const start: Point = { para: selection.first, offset: selection.start };
  const end: Point = { para: selection.last, offset: selection.end };
  if (isCaret(selection)) {
    const after = lt(start, anchor.start);
    const before = lt(anchor.end, start);
    if (after) return "after";
    if (before) return "before";
    return after === false && before === false ? "at_caret" : undefined;
  }
  if (anchor.point) {
    const before = lt(anchor.start, start);
    const after = lt(end, anchor.start);
    if (before) return "before";
    if (after) return "after";
    return before === false && after === false ? "inside" : undefined;
  }
  const before = le(anchor.end, start);
  const after = le(end, anchor.start);
  if (before) return "before";
  if (after) return "after";
  if (before === undefined || after === undefined) return undefined;
  const inside = and(le(start, anchor.start), le(anchor.end, end));
  if (inside) return "inside";
  const contains = and(le(anchor.start, start), le(end, anchor.end));
  if (contains) return "contains";
  if (inside === undefined || contains === undefined) return undefined;
  const startsFirst = lt(anchor.start, start);
  return startsFirst === undefined
    ? undefined
    : startsFirst
      ? "overlaps_start"
      : "overlaps_end";
}

/**
 * Annex A's mapping from the anchor's LocationRelation to the selection. Against a caret, anything
 * but Before and After touches it, as the coordinates count edges.
 */
function vsOfRelation(
  relation: string,
  caret: boolean,
): WordCommentVs | undefined {
  if (relation === "Before") return "before";
  if (relation === "After") return "after";
  if (caret) return "at_caret";
  if (relation === "AdjacentBefore") return "before";
  if (relation === "AdjacentAfter") return "after";
  if (relation === "Equal" || relation.startsWith("Inside")) return "inside";
  if (relation.startsWith("Contains")) return "contains";
  if (relation === "OverlapsBefore") return "overlaps_start";
  if (relation === "OverlapsAfter") return "overlaps_end";
  return undefined;
}

/** Paragraphs from the anchor to the nearest selection edge; 0 when they share one. */
function awayOf(anchor: Span, selection: WordCommentSelectionCoordinates) {
  if (anchor.end.para < selection.first)
    return selection.first - anchor.end.para;
  if (anchor.start.para > selection.last)
    return anchor.start.para - selection.last;
  return 0;
}

/**
 * Document order of anchor starts: paragraph, then offset, then the shorter anchor first. Zero
 * means the same place, as far as anything tells: also two anchors in one paragraph that Word did
 * not order, without offsets for both. Only what none of these decide falls back to the read's
 * order.
 */
function compareStarts(
  a: WordCommentPositionInput,
  b: WordCommentPositionInput,
): number {
  const x = a.at;
  const y = b.at;
  if ((x.first === null) !== (y.first === null))
    return x.first === null ? 1 : -1;
  if (x.first !== null && y.first !== null && x.first !== y.first)
    return x.first - y.first;
  const placed = x.first !== null && x.start !== null && y.start !== null;
  if (placed && x.start !== y.start) return x.start! - y.start!;
  const xs = spanOf(x);
  const ys = spanOf(y);
  if (placed && xs && ys) {
    const shorter = lt(xs.end, ys.end);
    const longer = lt(ys.end, xs.end);
    if (shorter !== undefined && longer !== undefined)
      return shorter ? -1 : longer ? 1 : 0;
  }
  if (!placed && (a.unsure || b.unsure)) return 0;
  return a.order - b.order;
}

/** Overlapping or nested anchors; touching ones do not overlap. */
function overlap(a: Span, b: Span): boolean | undefined {
  if (a.point && b.point) return false;
  if (a.point) return and(lt(b.start, a.start), lt(a.start, b.end));
  if (b.point) return and(lt(a.start, b.start), lt(b.start, a.end));
  return and(lt(a.start, b.end), lt(b.start, a.end));
}

function overlapsOf(
  threads: readonly WordCommentPositionInput[],
): Map<string, string[]> {
  const spans = threads
    .map((thread) => ({ ref: thread.ref, span: spanOf(thread.at) }))
    .filter((s): s is { ref: string; span: Span } => s.span !== null)
    .sort((a, b) => a.span.start.para - b.span.start.para);
  const found = new Map<string, string[]>();
  const add = (a: string, b: string) =>
    found.set(a, [...(found.get(a) ?? []), b]);
  for (let i = 0; i < spans.length; i += 1)
    for (
      let j = i + 1;
      j < spans.length && spans[j].span.start.para <= spans[i].span.end.para;
      j += 1
    ) {
      const a = spans[i];
      const b = spans[j];
      if (!overlap(a.span, b.span)) continue;
      add(a.ref, b.ref);
      add(b.ref, a.ref);
    }
  return found;
}

/**
 * Positions for every thread of the document. What offsets cannot decide, such as two anchors in
 * one paragraph without exact offsets, the read's order does.
 */
export function wordCommentPositions(
  threads: readonly WordCommentPositionInput[],
  options: { selection?: WordCommentSelectionCoordinates | null } = {},
): Map<string, WordCommentPosition> {
  const { selection } = options;
  const sorted = [...threads].sort(
    (a, b) => compareStarts(a, b) || a.order - b.order,
  );
  const ranks = new Map<string, number>();
  sorted.forEach((thread, i) => {
    const previous = sorted[i - 1];
    const rank = !previous
      ? 1
      : ranks.get(previous.ref)! +
        (compareStarts(previous, thread) === 0 ? 0 : 1);
    ranks.set(thread.ref, rank);
  });
  const overlaps = overlapsOf(threads);
  for (const refs of overlaps.values())
    refs.sort((a, b) => ranks.get(a)! - ranks.get(b)!);
  const positions = new Map<string, WordCommentPosition>();
  for (const thread of threads) {
    const span = spanOf(thread.at);
    const caret = !!selection && isCaret(selection);
    const vs =
      span && selection
        ? (vsOf(span, selection) ??
          (thread.selection
            ? vsOfRelation(thread.selection, caret)
            : thread.touches && caret
              ? "at_caret"
              : undefined))
        : undefined;
    const away = span && selection ? awayOf(span, selection) : undefined;
    const others = overlaps.get(thread.ref);
    positions.set(thread.ref, {
      pos: ranks.get(thread.ref)!,
      ...(vs ? { vs } : {}),
      ...(!vs && span && selection && thread.touches
        ? { touches: true as const }
        : {}),
      ...(away === undefined ? {} : { away }),
      in: thread.in,
      ...(others ? { overlaps: others } : {}),
    });
  }
  return positions;
}

/** At most `edge` characters at each end, cut at a space when one is near. */
export function wordCommentShortQuote(quote: string, edge: number): string {
  if (quote.length <= edge * 2 + 1) return quote;
  let end = edge;
  const last = quote.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  let start = quote.length - edge;
  const first = quote.charCodeAt(start);
  if (first >= 0xdc00 && first <= 0xdfff) start += 1;
  const head = quote.slice(0, end);
  const tail = quote.slice(start);
  const headCut = head.lastIndexOf(" ");
  const tailCut = tail.indexOf(" ");
  return `${headCut > edge / 2 ? head.slice(0, headCut) : head}…${
    tailCut >= 0 && tailCut < edge / 2 ? tail.slice(tailCut + 1) : tail
  }`;
}

function anchorTextOf(record: WordCommentThreadRecord): WordCommentAnchorText {
  if (record.placement) return record.placement.anchor;
  const rangeText = record.anchor?.rangeText ?? "";
  // Word for the web gives the paragraphs alone, not what is anchored in them.
  if (record.anchor?.rangeText === null)
    return { quote: "", position: "unknown" };
  const text = wordCommentAnchorText({ kind: "unplaced", rangeText });
  return text.quote === "" ? { quote: "", point: true } : text;
}

/**
 * The thread's `where` in the turn's coordinates, or null when no paragraph of it is known. Long
 * quotes keep both ends; `occurrence` still counts the whole anchored text.
 */
export function wordCommentWhere(
  record: WordCommentThreadRecord,
  position: WordCommentPosition,
): WordCommentWhere | null {
  const para = record.anchor?.first.ordinal ?? null;
  if (para === null) return null;
  const last = record.anchor?.last.ordinal ?? null;
  const text = anchorTextOf(record);
  return {
    para,
    ...(last !== null && last > para ? { through: last } : {}),
    ...text,
    quote: wordCommentShortQuote(
      text.quote,
      WORD_COMMENT_WHERE_QUOTE_EDGE_CHARS,
    ),
    ...(position.vs ? { vs: position.vs } : {}),
    ...(position.away === undefined ? {} : { away: position.away }),
    in: position.in,
    ...(position.overlaps ? { overlaps: [...position.overlaps] } : {}),
  };
}
