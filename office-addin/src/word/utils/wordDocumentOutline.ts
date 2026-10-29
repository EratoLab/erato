import { HEADING_OUTLINE_BUDGET_BYTES } from "./buildWordDocumentArgs";
import { wordReadableSourceBlock } from "./wordAuthoringReadData";
import { WORD_READ_PAGE_BYTES } from "./wordReadFragments";

import type { WordReadableSourceBlock } from "./wordAuthoringReadData";
import type {
  WordAuthoringSnapshot,
  WordSourceBlock,
} from "@erato/frontend/word-review";

export const MAX_OUTLINE_ENTRIES = 300;
const TITLE_CHARS = 80;
/** A span the headings leave larger than three pages gets the fallback outline inside it. */
const FALLBACK_SPAN_BYTES = 3 * WORD_READ_PAGE_BYTES;
/** A slice ends at its last clause start once it holds this much (ERMAIN-1005 F0). */
const SLICE_FILL_BYTES = 12 * 1024;
const NUMBERED_TITLE_CHARS = 120;
const MIN_NUMBERED_SECTIONS = 3;
/** "1. Title", "11 Title", "§ 11 Title"; never "1.1 Title". */
const TOP_LEVEL_NUMBER = /^(§\s*)?(\d+)\.?\s+\S/u;
/** A typed number at any level, such as "4.1 ". */
const CLAUSE_NUMBER = /^(§\s*)?\d+(\.\d+)*\.?\s+\S/u;
const HEADING_STYLE = /^heading\s?([1-9])$/i;
const START_OF_DOCUMENT = "(start of document)";

/** H: a heading; S: a numbered section; P: a part of about 20 KiB where nothing else structures a span. */
export type WordOutlineTag = "H" | "S" | "P";

export interface WordOutlineEntry {
  ref: string;
  level: number;
  tag: WordOutlineTag;
  title: string;
  kib: number;
  paragraphs: number;
  /** The blocks section:{ref} reads: indexes [from, to) into the capture's body blocks. */
  from: number;
  to: number;
}

/** What a capture's section reads and outline need, computed once per capture. */
export interface WordCaptureSections {
  readable: readonly WordReadableSourceBlock[];
  /** UTF-8 bytes of each block's read form as JSON. */
  bytes: readonly number[];
  outline: readonly WordOutlineEntry[];
  /** The entry that starts at a block index; the outermost where several do. */
  entryAt: ReadonlyMap<number, number>;
  /** For each block index, the deepest outline entry that holds it, or -1. */
  entryOf: Int32Array;
  /** Bytes of the JSON array of the read forms of blocks [from, to). */
  spanBytes: (from: number, to: number) => number;
  paragraphs: (from: number, to: number) => number;
}

const blockIndexes = new WeakMap<
  WordAuthoringSnapshot,
  { fingerprint: string; index: Map<string, number> }
>();
const captures = new WeakMap<
  WordAuthoringSnapshot,
  { fingerprint: string; sections: WordCaptureSections }
>();
const encoder = new TextEncoder();

/** Body block ref to its index in snapshot.blocks. */
export function wordBlockIndex(
  snapshot: WordAuthoringSnapshot,
): ReadonlyMap<string, number> {
  const cached = blockIndexes.get(snapshot);
  if (cached && cached.fingerprint === snapshot.fingerprint)
    return cached.index;
  const index = new Map(snapshot.blocks.map((b, i) => [b.ref, i]));
  blockIndexes.set(snapshot, { fingerprint: snapshot.fingerprint, index });
  return index;
}

export const wordOutlineKib = (bytes: number) => Math.round(bytes / 102.4) / 10;

/** One line of at most 80 code points. */
export const wordOutlineTitle = (text: string) =>
  Array.from(text.replace(/\s+/gu, " ").trim()).slice(0, TITLE_CHARS).join("");
const isParagraph = (b: WordSourceBlock) => b.type !== "native";
const isEmptyParagraph = (b: WordSourceBlock) =>
  isParagraph(b) && !b.text.trim();

const isTitleStyle = (name: string) => name.toLowerCase() === "title";

function headingStyleLevels(
  styles: WordAuthoringSnapshot["styles"],
): Map<string, number> {
  const levels = new Map<string, number>();
  for (const style of styles) {
    const match =
      HEADING_STYLE.exec(style.id) ?? HEADING_STYLE.exec(style.name);
    if (match) levels.set(style.id, Number(match[1]));
    else if (isTitleStyle(style.id) || isTitleStyle(style.name))
      levels.set(style.id, 0);
  }
  return levels;
}

/** The capture reads a paragraph with numbering as a list item even when its style is a heading
 * style, so a heading-styled list item is a heading here too. Title is level 0 here and level 1 in
 * the outline. */
function headingLevel(
  block: WordSourceBlock,
  styleLevels: ReadonlyMap<string, number>,
): number | undefined {
  if (!isParagraph(block) || !block.text.trim()) return undefined;
  if (block.type === "heading" && block.level) return block.level;
  if (!block.styleRef) return undefined;
  const level = styleLevels.get(block.styleRef);
  if (level !== undefined) return level;
  const match = HEADING_STYLE.exec(block.styleRef);
  return match
    ? Number(match[1])
    : isTitleStyle(block.styleRef)
      ? 0
      : undefined;
}

interface Span {
  from: number;
  to: number;
  level: number;
  tag: WordOutlineTag;
  title?: string;
}

/** Word numbering: the ordered list whose level-0 items are spread over the most blocks.
 * Consecutive level-0 items are an enumeration, such as "(a)", "(b)", not sections. */
function wordNumberingStarts(
  blocks: readonly WordSourceBlock[],
  from: number,
  to: number,
): number[] | null {
  const lists = new Map<string, { starts: number[]; ordered: boolean }>();
  for (let i = from; i < to; i++) {
    const b = blocks[i];
    if (b.type !== "list-item" || !b.list || (b.level ?? 0) !== 0) continue;
    const list = lists.get(b.list) ?? { starts: [], ordered: true };
    list.starts.push(i);
    list.ordered &&= !!b.ordered;
    lists.set(b.list, list);
  }
  let best: number[] | null = null;
  for (const { starts, ordered } of lists.values()) {
    if (!ordered || starts.length < MIN_NUMBERED_SECTIONS) continue;
    const gaps = starts
      .slice(1)
      .map((v, k) => v - starts[k])
      .sort((a, b) => a - b);
    if (gaps[Math.floor(gaps.length / 2)] < 2) continue;
    const span = starts[starts.length - 1] - starts[0];
    if (!best || span > best[best.length - 1] - best[0]) best = starts;
  }
  return best;
}

/** Typed numbers: the longest run of title-like paragraphs numbered n, n+1, n+2, … in order. */
function typedNumberStarts(
  blocks: readonly WordSourceBlock[],
  from: number,
  to: number,
): number[] | null {
  const hits: { i: number; n: number }[] = [];
  for (let i = from; i < to; i++) {
    const b = blocks[i];
    if (b.type !== "paragraph") continue;
    const text = b.text.trim();
    const match = TOP_LEVEL_NUMBER.exec(text);
    if (
      match &&
      Array.from(text).length <= NUMBERED_TITLE_CHARS &&
      !/[.;:,]$/u.test(text)
    )
      hits.push({ i, n: Number(match[2]) });
  }
  let best: number[] = [];
  for (let k = 0; k < hits.length && hits.length - k > best.length; k++) {
    const chain = [hits[k]];
    for (let j = k + 1; j < hits.length; j++)
      if (hits[j].n === chain[chain.length - 1].n + 1) chain.push(hits[j]);
    if (chain.length > best.length) best = chain.map((h) => h.i);
  }
  return best.length >= MIN_NUMBERED_SECTIONS ? best : null;
}

function buildSections(snapshot: WordAuthoringSnapshot): WordCaptureSections {
  const { blocks } = snapshot;
  const readable = blocks.map(wordReadableSourceBlock);
  const bytes = readable.map((b) => encoder.encode(JSON.stringify(b)).length);
  const byteSums = [0];
  const paragraphSums = [0];
  blocks.forEach((b, i) => {
    byteSums.push(byteSums[i] + bytes[i]);
    paragraphSums.push(paragraphSums[i] + (isParagraph(b) ? 1 : 0));
  });
  const spanBytes = (from: number, to: number) =>
    to > from ? 2 + byteSums[to] - byteSums[from] + (to - from - 1) : 2;
  const paragraphs = (from: number, to: number) =>
    paragraphSums[to] - paragraphSums[from];

  const clauseStart = (i: number) => {
    const b = blocks[i];
    return (
      b.type === "heading" ||
      (b.type === "list-item" && !!b.ordered) ||
      (b.type === "paragraph" && CLAUSE_NUMBER.test(b.text.trim())) ||
      (i > 0 && isEmptyParagraph(blocks[i - 1]))
    );
  };
  const slices = (from: number, to: number, level: number): Span[] => {
    const out: Span[] = [];
    let start = from;
    while (start < to) {
      let end = start + 1;
      while (end < to && spanBytes(start, end + 1) <= WORD_READ_PAGE_BYTES)
        end++;
      let cut = end;
      if (end < to)
        for (
          let j = end;
          j > start && spanBytes(start, j) >= SLICE_FILL_BYTES;
          j--
        )
          if (clauseStart(j)) {
            cut = j;
            break;
          }
      out.push({ from: start, to: cut, level, tag: "P" });
      start = cut;
    }
    return out;
  };
  const numbered = (from: number, to: number, level: number): Span[] | null => {
    const starts =
      wordNumberingStarts(blocks, from, to) ??
      typedNumberStarts(blocks, from, to);
    if (!starts) return null;
    const bounds = [...(starts[0] > from ? [from] : []), ...starts, to];
    return bounds.slice(0, -1).flatMap((start, k) => {
      const end = bounds[k + 1];
      return [
        { from: start, to: end, level, tag: "S" as const },
        ...(spanBytes(start, end) > FALLBACK_SPAN_BYTES
          ? slices(start, end, level + 1)
          : []),
      ];
    });
  };
  const entry = (span: Span): WordOutlineEntry => ({
    ref: blocks[span.from].ref,
    level: span.level,
    tag: span.tag,
    title:
      span.title ??
      wordOutlineTitle(
        blocks.slice(span.from, span.to).find((b) => b.text.trim())?.text ?? "",
      ),
    kib: wordOutlineKib(spanBytes(span.from, span.to)),
    paragraphs: paragraphs(span.from, span.to),
    from: span.from,
    to: span.to,
  });
  /** Numbered sections where they are detected and fit the caps, otherwise parts. */
  const fallback = (from: number, to: number, level: number): Span[] => {
    const sections = numbered(from, to, level);
    if (sections && sections.length <= MAX_OUTLINE_ENTRIES) {
      const lines = sections.map((s) => wordOutlineLine(entry(s)));
      if (
        encoder.encode(lines.join("\n")).length <= HEADING_OUTLINE_BUDGET_BYTES
      )
        return sections;
    }
    return slices(from, to, level);
  };

  const styleLevels = headingStyleLevels(snapshot.styles);
  const heads = blocks.flatMap((b, i) => {
    const level = headingLevel(b, styleLevels);
    return level === undefined
      ? []
      : [{ i, level: Math.max(1, level), title: !level }];
  });
  const spans: Span[] = [];
  // A title alone does not structure a document; the fallback covers it with the rest.
  if (heads.every((h) => h.title)) spans.push(...fallback(0, blocks.length, 1));
  else {
    const first = heads[0].i;
    if (blocks.slice(0, first).some((b) => !isParagraph(b) || b.text.trim()))
      spans.push(
        ...(spanBytes(0, first) > FALLBACK_SPAN_BYTES
          ? fallback(0, first, 1)
          : [
              {
                from: 0,
                to: first,
                level: 1,
                tag: "H" as const,
                title: START_OF_DOCUMENT,
              },
            ]),
      );
    heads.forEach((head, k) => {
      let end = blocks.length;
      for (let j = k + 1; j < heads.length; j++)
        if (heads[j].level <= head.level) {
          end = heads[j].i;
          break;
        }
      spans.push({ from: head.i, to: end, level: head.level, tag: "H" });
      const leafEnd = heads[k + 1]?.i ?? blocks.length;
      if (spanBytes(head.i, leafEnd) > FALLBACK_SPAN_BYTES)
        spans.push(...fallback(head.i + 1, leafEnd, head.level + 1));
    });
  }
  const outline = spans.filter((s) => s.to > s.from).map(entry);
  const entryAt = new Map<number, number>();
  const entryOf = new Int32Array(blocks.length).fill(-1);
  outline.forEach((e, k) => {
    if (!entryAt.has(e.from)) entryAt.set(e.from, k);
    entryOf.fill(k, e.from, e.to);
  });
  return {
    readable,
    bytes,
    outline,
    entryAt,
    entryOf,
    spanBytes,
    paragraphs,
  };
}

export function wordCaptureSections(
  snapshot: WordAuthoringSnapshot,
): WordCaptureSections {
  const cached = captures.get(snapshot);
  if (cached && cached.fingerprint === snapshot.fingerprint)
    return cached.sections;
  const sections = buildSections(snapshot);
  captures.set(snapshot, { fingerprint: snapshot.fingerprint, sections });
  return sections;
}

/** The outline in document order: headings, or numbered sections and parts where headings are missing. */
export function wordDocumentOutline(
  snapshot: WordAuthoringSnapshot,
): readonly WordOutlineEntry[] {
  return wordCaptureSections(snapshot).outline;
}

/** The blocks section:{ref} reads without throughRef: an outline entry's extent, or from a block
 * that starts none up to the next entry. */
export function wordSectionExtent(
  sections: WordCaptureSections,
  index: number,
): { from: number; to: number; entry?: WordOutlineEntry } {
  const at = sections.entryAt.get(index);
  if (at !== undefined) {
    const entry = sections.outline[at];
    return { from: index, to: entry.to, entry };
  }
  const next = sections.outline.find((e) => e.from > index);
  return { from: index, to: next?.from ?? sections.bytes.length };
}

export function wordOutlineLine(entry: WordOutlineEntry): string {
  const tag = entry.tag === "H" ? `H${entry.level}` : entry.tag;
  return `[${entry.ref}|${tag}|${entry.kib.toFixed(1)} KiB|${entry.paragraphs} ¶] ${entry.title}`;
}

const OUTLINE_HEADER =
  "Sections of the document as [ref|H<level> heading, S numbered section or P part|size|paragraphs] title; read_document_blocks section:{ref} reads one in pages of up to 20 KiB:";

/** heading_outline for a capture too large for a complete read, within 8 KiB and 300 entries:
 * the deepest level goes first, then the tail. */
export function wordDocumentOutlineText(
  snapshot: WordAuthoringSnapshot,
): string {
  const outline = wordDocumentOutline(snapshot);
  if (!outline.length) return "";
  const lines = outline.map(wordOutlineLine);
  const lineBytes = lines.map((l) => encoder.encode(l).length + 1);
  const omission = (count: number) =>
    `${count} more ${count === 1 ? "entry is" : "entries are"} left out; section:{ref, throughRef} reads any range of blocks.`;
  const fits = (kept: number[], bytes: number) => {
    const omitted = outline.length - kept.length;
    return (
      kept.length <= MAX_OUTLINE_ENTRIES &&
      bytes + (omitted ? encoder.encode(omission(omitted)).length + 1 : 0) <=
        HEADING_OUTLINE_BUDGET_BYTES
    );
  };
  const header = encoder.encode(OUTLINE_HEADER).length;
  const total = (kept: number[]) =>
    kept.reduce((sum, k) => sum + lineBytes[k], header);
  let kept = outline.map((_, k) => k);
  let bytes = total(kept);
  while (!fits(kept, bytes)) {
    const levels = new Set(kept.map((k) => outline[k].level));
    if (levels.size < 2) break;
    const deepest = Math.max(...levels);
    kept = kept.filter((k) => outline[k].level !== deepest);
    bytes = total(kept);
  }
  while (kept.length && !fits(kept, bytes)) bytes -= lineBytes[kept.pop()!];
  const omitted = outline.length - kept.length;
  return [
    OUTLINE_HEADER,
    ...kept.map((k) => lines[k]),
    ...(omitted ? [omission(omitted)] : []),
  ].join("\n");
}
