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
  /** The read's document order, for what neither coordinates nor relations decide. */
  order: number;
  /** The anchor's compareLocationWith the selection Word had at the read, for what offsets cannot decide. */
  selection?: string;
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

/** a.compareLocationWith(b) for two threads' anchors, as Word.LocationRelation names it. */
export type WordCommentRelations = (a: string, b: string) => string | undefined;

export interface WordCommentPosition {
  /** Dense and 1-based; threads whose anchors start at the same place share it. */
  pos: number;
  vs?: WordCommentVs;
  away?: number;
  in: WordCommentContainer;
  overlaps?: string[];
}

const BEFORE: ReadonlySet<string> = new Set([
  "Before",
  "AdjacentBefore",
  "OverlapsBefore",
  "Contains",
  "ContainsEnd",
  "InsideStart",
]);
const AFTER: ReadonlySet<string> = new Set([
  "After",
  "AdjacentAfter",
  "OverlapsAfter",
  "Inside",
  "InsideEnd",
  "ContainsStart",
]);
const APART: ReadonlySet<string> = new Set([
  "Before",
  "After",
  "AdjacentBefore",
  "AdjacentAfter",
]);
const TOGETHER: ReadonlySet<string> = new Set([
  "Equal",
  "Contains",
  "ContainsStart",
  "ContainsEnd",
  "Inside",
  "InsideStart",
  "InsideEnd",
  "OverlapsBefore",
  "OverlapsAfter",
]);

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

function relationOf(
  relations: WordCommentRelations | undefined,
  a: string,
  b: string,
): string | undefined {
  const forward = relations?.(a, b);
  if (forward !== undefined) return forward;
  const backward = relations?.(b, a);
  if (backward === undefined) return undefined;
  const mirror: Record<string, string> = {
    Before: "After",
    After: "Before",
    AdjacentBefore: "AdjacentAfter",
    AdjacentAfter: "AdjacentBefore",
    OverlapsBefore: "OverlapsAfter",
    OverlapsAfter: "OverlapsBefore",
    Contains: "Inside",
    Inside: "Contains",
    ContainsStart: "InsideStart",
    InsideStart: "ContainsStart",
    ContainsEnd: "InsideEnd",
    InsideEnd: "ContainsEnd",
    Equal: "Equal",
  };
  return mirror[backward];
}

/**
 * Document order of anchor starts: paragraph, then offset; where one paragraph's offsets are
 * missing or equal, Word's relation between the two anchors; then the shorter anchor first. Zero
 * means the same place. Only what none of these decide falls back to the read's order.
 */
function compareStarts(
  a: WordCommentPositionInput,
  b: WordCommentPositionInput,
  relations: WordCommentRelations | undefined,
): number {
  const x = a.at;
  const y = b.at;
  if ((x.first === null) !== (y.first === null))
    return x.first === null ? 1 : -1;
  if (x.first !== null && y.first !== null && x.first !== y.first)
    return x.first - y.first;
  const placed = x.first !== null && x.start !== null && y.start !== null;
  if (placed && x.start !== y.start) return x.start! - y.start!;
  const relation = relationOf(relations, a.ref, b.ref);
  if (relation !== undefined) {
    if (relation === "Equal") return 0;
    if (BEFORE.has(relation)) return -1;
    if (AFTER.has(relation)) return 1;
  }
  const xs = spanOf(x);
  const ys = spanOf(y);
  if (placed && xs && ys) {
    const shorter = lt(xs.end, ys.end);
    const longer = lt(ys.end, xs.end);
    if (shorter !== undefined && longer !== undefined)
      return shorter ? -1 : longer ? 1 : 0;
  }
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
  relations: WordCommentRelations | undefined,
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
      let together = overlap(a.span, b.span);
      if (together === undefined) {
        const relation = relationOf(relations, a.ref, b.ref);
        together =
          relation === undefined
            ? undefined
            : TOGETHER.has(relation) ||
              (APART.has(relation) ? false : undefined);
      }
      if (!together) continue;
      add(a.ref, b.ref);
      add(b.ref, a.ref);
    }
  return found;
}

/**
 * Positions for every thread of the document. `relations` decide what offsets cannot, such as two
 * anchors in one paragraph without exact offsets; without them the read's order does.
 */
export function wordCommentPositions(
  threads: readonly WordCommentPositionInput[],
  options: {
    selection?: WordCommentSelectionCoordinates | null;
    relations?: WordCommentRelations;
  } = {},
): Map<string, WordCommentPosition> {
  const { selection, relations } = options;
  const sorted = [...threads].sort(
    (a, b) => compareStarts(a, b, relations) || a.order - b.order,
  );
  const ranks = new Map<string, number>();
  sorted.forEach((thread, i) => {
    const previous = sorted[i - 1];
    const rank = !previous
      ? 1
      : ranks.get(previous.ref)! +
        (compareStarts(previous, thread, relations) === 0 ? 0 : 1);
    ranks.set(thread.ref, rank);
  });
  const overlaps = overlapsOf(threads, relations);
  for (const refs of overlaps.values())
    refs.sort((a, b) => ranks.get(a)! - ranks.get(b)!);
  const positions = new Map<string, WordCommentPosition>();
  for (const thread of threads) {
    const span = spanOf(thread.at);
    const vs =
      span && selection
        ? (vsOf(span, selection) ??
          (thread.selection
            ? vsOfRelation(thread.selection, isCaret(selection))
            : undefined))
        : undefined;
    const away = span && selection ? awayOf(span, selection) : undefined;
    const others = overlaps.get(thread.ref);
    positions.set(thread.ref, {
      pos: ranks.get(thread.ref)!,
      ...(vs ? { vs } : {}),
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
  const head = quote.slice(0, edge);
  const tail = quote.slice(-edge);
  const headCut = head.lastIndexOf(" ");
  const tailCut = tail.indexOf(" ");
  return `${headCut > edge / 2 ? head.slice(0, headCut) : head}…${
    tailCut >= 0 && tailCut < edge / 2 ? tail.slice(tailCut + 1) : tail
  }`;
}

function anchorTextOf(record: WordCommentThreadRecord): WordCommentAnchorText {
  if (record.placement) return record.placement.anchor;
  const rangeText = record.anchor?.rangeText ?? "";
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
