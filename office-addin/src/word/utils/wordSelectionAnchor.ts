import { cutToUtf8Bytes } from "./buildWordDocumentArgs";
import { resolveWordParagraphs } from "./wordParagraphResolver";
import { fitWordSelectionText } from "./wordSelectionArgs";
import {
  ACTION_FACET_ARG_MAX_BYTES,
  utf8ByteLength,
} from "../../core/clientActions/actionFacetArgs";

import type {
  WordParagraphAnchor,
  WordParagraphEntry,
} from "./wordParagraphResolver";
import type { WordSelectionSupport } from "./wordSelectionSupport";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

export type WordSelectionShape =
  | "inline"
  | "paragraph"
  | "multi_paragraph"
  | "table_cell"
  | "table";
export type WordSelectionStory =
  | "main"
  | "header"
  | "footer"
  | "footnote"
  | "endnote"
  | "note"
  | "text_box"
  | "other";
export type WordSelectionRole = "rewrite" | "context_only";
export type WordSelectionOrigin = "user" | "erato";

/** The model returns one line per paragraph; more would strain its output budget. */
export const WORD_SELECTION_MAX_PARAGRAPHS = 40;
export const WORD_SELECTION_MAX_BYTES = ACTION_FACET_ARG_MAX_BYTES;
/** Per side. The neighbours only inform the model; the target proof uses the anchor. */
export const WORD_SELECTION_CONTEXT_BYTES = 4_096;

/**
 * Shapes Replace may write. A shape is added only once its native harness row is green on every
 * host; until then an otherwise eligible selection is sent as context only.
 */
export const WORD_SELECTION_REPLACE_SHAPES: ReadonlySet<WordSelectionShape> =
  new Set<WordSelectionShape>([]);

/** One V2-4 message per reason, so the card can explain each refusal to rewrite. */
export const WORD_SELECTION_REASON_MESSAGE_IDS = {
  host_unsupported: "officeAddin.word.selection.contextOnly.hostUnsupported",
  other_story: "officeAddin.word.selection.contextOnly.otherStory",
  whole_table: "officeAddin.word.selection.contextOnly.wholeTable",
  multi_cell: "officeAddin.word.selection.contextOnly.multiCell",
  nested_table: "officeAddin.word.selection.contextOnly.nestedTable",
  cell_multi_paragraph:
    "officeAddin.word.selection.contextOnly.cellMultiParagraph",
  too_many_paragraphs:
    "officeAddin.word.selection.contextOnly.tooManyParagraphs",
  too_large: "officeAddin.word.selection.contextOnly.tooLarge",
  position_unknown: "officeAddin.word.selection.contextOnly.positionUnknown",
  empty_edge_paragraph:
    "officeAddin.word.selection.contextOnly.emptyEdgeParagraph",
  tracked_changes: "officeAddin.word.selection.contextOnly.trackedChanges",
  hyperlink: "officeAddin.word.selection.contextOnly.hyperlink",
  field: "officeAddin.word.selection.contextOnly.field",
  content_control: "officeAddin.word.selection.contextOnly.contentControl",
  hidden_text: "officeAddin.word.selection.contextOnly.hiddenText",
  note_reference: "officeAddin.word.selection.contextOnly.noteReference",
  comment_mark: "officeAddin.word.selection.contextOnly.commentMark",
  inline_picture: "officeAddin.word.selection.contextOnly.inlinePicture",
  line_break: "officeAddin.word.selection.contextOnly.lineBreak",
  unsupported_formatting:
    "officeAddin.word.selection.contextOnly.unsupportedFormatting",
  complex_script_format:
    "officeAddin.word.selection.contextOnly.complexScriptFormat",
  web_picture_offset: "officeAddin.word.selection.contextOnly.webPictureOffset",
  style_font_unavailable:
    "officeAddin.word.selection.contextOnly.styleFontUnavailable",
  not_unique: "officeAddin.word.selection.contextOnly.notUnique",
  shape_not_enabled: "officeAddin.word.selection.contextOnly.shapeNotEnabled",
} as const;

export type WordSelectionReasonCode =
  keyof typeof WORD_SELECTION_REASON_MESSAGE_IDS;

/** Every code except UNVERIFIED_AFTER_WRITE means nothing was written. */
export const WORD_SELECTION_REPLACE_CODES = [
  "TARGET_TEXT_MISMATCH",
  "TARGET_NOT_FOUND",
  "AMBIGUOUS_TARGET",
  "HINT_CONFLICT",
  "UNSUPPORTED_CONTENT",
  "PARAGRAPH_COUNT_MISMATCH",
  "INVALID_REPLACEMENT",
  "UNVERIFIED_AFTER_WRITE",
] as const;

export type WordSelectionReplaceCode =
  (typeof WORD_SELECTION_REPLACE_CODES)[number];

export interface WordSelectionParagraphFacts {
  id: string | null;
  /** getText(WORD_SELECTION_TEXT_OPTIONS): the identity text the resolver compares. */
  text: string;
  /** paragraph.text: the text the offsets count in. */
  rangeText: string;
  /** Position among the story's paragraphs at capture. */
  index: number;
  styleName: string;
  /** 0 outside tables. */
  tableNestingLevel: number;
  /** Tells the covered cells apart within this selection; null outside tables. */
  cell: string | null;
}

/** Found by the capture's scan of the span; any one makes the selection context only. */
export interface WordSelectionHazards {
  hyperlink?: boolean;
  field?: boolean;
  contentControl?: boolean;
  hiddenText?: boolean;
  /** A tracked insertion or deletion, including one left by an earlier Replace. */
  trackedChange?: boolean;
  inlinePicture?: boolean;
  noteReference?: boolean;
  commentMark?: boolean;
  /** A character style, or direct run formatting outside the tracked font set. */
  unsupportedFormatting?: boolean;
  /**
   * Complex-script run formatting that differs from its Latin twin (bCs vs b, iCs vs i, szCs vs sz,
   * the cs font vs ascii), rtl, or complex-script characters. Word for the web writes equal twins
   * on its own Ctrl+B and on every Office.js bold, italic, size or name set, so equal twins are benign.
   */
  complexScript?: boolean;
}

export interface WordSelectionFacts {
  isEmpty: boolean;
  /** Word.BodyType of the story holding the selection, outside any table ("MainDoc", "Header", ...). */
  storyType: string;
  /** Word's selection.text; the only text read on a host that cannot rewrite. */
  selectionText: string;
  /** The selection is a picture or a shape, without text. */
  objectOnly: boolean;
  /** "whole" when every table the selection touches is covered completely. */
  tables: "none" | "whole" | "partial";
  /** In story order; empty on a host that cannot rewrite. */
  paragraphs: readonly WordSelectionParagraphFacts[];
  /** Into the first paragraph's rangeText. */
  startOffset: number;
  /** Into the last paragraph's rangeText, exclusive. */
  endOffset: number;
  /** wordParagraphAnchor over the story's identity texts; null when the paragraphs could not be placed. */
  anchor: WordParagraphAnchor | null;
  hazards: WordSelectionHazards;
  /** An inline picture lies between the start of the first paragraph and the span. */
  pictureBeforeSpan: boolean;
  /** The style font of every covered paragraph could be read. */
  styleFontResolved: boolean;
  /** A tracked Range was kept as a hint (desktop only). */
  trackedRange?: boolean;
}

export interface WordSelectionParagraph {
  id: string | null;
  text: string;
  rangeText: string;
  /** A hint only: a paragraph inserted above moves it without changing the target. */
  index: number;
  styleName: string;
}

export interface WordSelectionSnapshot {
  role: WordSelectionRole;
  reasonCode: WordSelectionReasonCode | null;
  shape: WordSelectionShape;
  story: WordSelectionStory;
  origin: WordSelectionOrigin;
  /** The covered part of each paragraph, one line each. */
  selectedText: string;
  /** selectedText was cut to fit one facet argument. */
  truncated: boolean;
  paragraphCount: number;
  paragraphs: readonly WordSelectionParagraph[];
  startOffset: number;
  endOffset: number;
  /** Earlier search matches of the first covered part within its paragraph's rangeText. */
  occurrence: number;
  anchor: WordParagraphAnchor | null;
  /** The paragraphs before the span, then a last line with the span paragraph's text before it. */
  contextBefore: string;
  /** A first line with the span paragraph's text after it, then the paragraphs after the span. */
  contextAfter: string;
}

/** Frozen at Send. A selection send carries no document paragraphs. */
export type WordSelectionCapture = WordDocumentCapture & {
  selection?: WordSelectionSnapshot;
};

export type WordSelectionClassification =
  | { role: "none" }
  | {
      role: WordSelectionRole;
      shape: WordSelectionShape;
      story: WordSelectionStory;
      reasonCode: WordSelectionReasonCode | null;
    };

const STORIES: Readonly<Record<string, WordSelectionStory>> = {
  MainDoc: "main",
  Header: "header",
  Footer: "footer",
  Footnote: "footnote",
  Endnote: "endnote",
  NoteItem: "note",
  Shape: "text_box",
};

/** The covered part of each paragraph's rangeText. */
function coveredParts(
  paragraphs: readonly { rangeText: string }[],
  start: number,
  end: number,
): string[] {
  const last = paragraphs.length - 1;
  return paragraphs.map((p, i) =>
    p.rangeText.slice(i === 0 ? start : 0, i === last ? end : undefined),
  );
}

export function wordSelectionParts(selection: WordSelectionSnapshot): string[] {
  return coveredParts(
    selection.paragraphs,
    selection.startOffset,
    selection.endOffset,
  );
}

function offsetsValid(facts: WordSelectionFacts): boolean {
  const { paragraphs, startOffset: start, endOffset: end } = facts;
  const first = paragraphs[0];
  const last = paragraphs[paragraphs.length - 1];
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start <= first.rangeText.length &&
    end >= 0 &&
    end <= last.rangeText.length &&
    (paragraphs.length > 1 || start <= end)
  );
}

/** Non-overlapping, left to right, as Word's search reports matches; -1 when none starts at the offset. */
function occurrenceAt(haystack: string, needle: string, offset: number) {
  if (needle === "") return -1;
  let count = 0;
  for (
    let at = haystack.indexOf(needle);
    at !== -1 && at <= offset;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    if (at === offset) return count;
    count += 1;
  }
  return -1;
}

interface Analysis {
  /** Null when the offsets do not fit the paragraphs. */
  parts: string[] | null;
  text: string;
  shape: WordSelectionShape;
  story: WordSelectionStory;
  occurrence: number;
}

function analyse(facts: WordSelectionFacts): Analysis {
  const { paragraphs } = facts;
  const parts =
    paragraphs.length > 0 && offsetsValid(facts)
      ? coveredParts(paragraphs, facts.startOffset, facts.endOffset)
      : null;
  const text = parts
    ? parts.join("\n")
    : facts.selectionText.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const cells = new Set(paragraphs.map((p) => p.cell));
  const inTable = paragraphs.some((p) => p.cell !== null);
  const shape: WordSelectionShape =
    facts.tables === "whole" || (inTable && cells.size > 1)
      ? "table"
      : inTable
        ? "table_cell"
        : paragraphs.length > 1 ||
            (paragraphs.length === 0 && text.includes("\n"))
          ? "multi_paragraph"
          : paragraphs.length === 1 &&
              facts.startOffset === 0 &&
              facts.endOffset === paragraphs[0].rangeText.length
            ? "paragraph"
            : "inline";
  return {
    parts,
    text,
    shape,
    story: STORIES[facts.storyType] ?? "other",
    occurrence: parts
      ? occurrenceAt(paragraphs[0].rangeText, parts[0], facts.startOffset)
      : -1,
  };
}

/** Collapsed, an object, a comment balloon, or body text running into part of a table (D-10). */
function offersNoChip(facts: WordSelectionFacts, analysis: Analysis) {
  return (
    facts.isEmpty ||
    facts.objectOnly ||
    facts.storyType === "Unknown" ||
    analysis.text === "" ||
    (facts.tables === "partial" &&
      (facts.paragraphs.length === 0 ||
        facts.paragraphs.some((p) => p.cell === null)))
  );
}

function anchorMatches(facts: WordSelectionFacts): boolean {
  const { anchor, paragraphs } = facts;
  return (
    anchor !== null &&
    anchor.paragraphs.length === paragraphs.length &&
    anchor.paragraphs.every(
      (p, i) => p.text === paragraphs[i].text && p.id === paragraphs[i].id,
    )
  );
}

function hazardOf(
  hazards: WordSelectionHazards,
  parts: readonly string[],
  support: WordSelectionSupport,
): WordSelectionReasonCode | null {
  const contains = (mark: string) => parts.some((part) => part.includes(mark));
  if (hazards.trackedChange) return "tracked_changes";
  if (hazards.hyperlink) return "hyperlink";
  if (hazards.field) return "field";
  if (hazards.contentControl) return "content_control";
  if (hazards.hiddenText) return "hidden_text";
  if (hazards.noteReference || contains("\u0002")) return "note_reference";
  if (hazards.commentMark || contains("\u0005")) return "comment_mark";
  if (hazards.inlinePicture) return "inline_picture";
  if (contains("\u000B")) return "line_break";
  if (hazards.unsupportedFormatting) return "unsupported_formatting";
  if (hazards.complexScript && !support.bidiSetters)
    return "complex_script_format";
  return null;
}

function contextOnlyReason(
  facts: WordSelectionFacts,
  support: WordSelectionSupport,
  analysis: Analysis,
  enabledShapes: ReadonlySet<WordSelectionShape>,
): WordSelectionReasonCode | null {
  const { paragraphs, anchor } = facts;
  const { parts, shape } = analysis;
  if (!support.canRewrite) return "host_unsupported";
  if (analysis.story !== "main") return "other_story";
  if (facts.tables === "whole") return "whole_table";
  if (shape === "table") return "multi_cell";
  if (shape === "table_cell") {
    if (paragraphs.some((p) => p.tableNestingLevel > 1)) return "nested_table";
    if (paragraphs.length > 1) return "cell_multi_paragraph";
  }
  if (paragraphs.length > WORD_SELECTION_MAX_PARAGRAPHS)
    return "too_many_paragraphs";
  if (utf8ByteLength(analysis.text) > WORD_SELECTION_MAX_BYTES)
    return "too_large";
  if (!parts || !anchor || !anchorMatches(facts)) return "position_unknown";
  if (
    shape === "multi_paragraph" &&
    (parts[0] === "" || parts[parts.length - 1] === "")
  )
    return "empty_edge_paragraph";
  const hazard = hazardOf(facts.hazards, parts, support);
  if (hazard) return hazard;
  if (facts.pictureBeforeSpan && support.picturesShiftOffsets)
    return "web_picture_offset";
  if (support.styleFontSource === null || !facts.styleFontResolved)
    return "style_font_unavailable";
  if (analysis.occurrence < 0) return "position_unknown";
  // Capture step 6: without a unique text window, only a hint can find the paragraphs again.
  if (
    anchor.window === null &&
    !anchor.paragraphs.every((p) => p.id) &&
    !facts.trackedRange
  )
    return "not_unique";
  if (!enabledShapes.has(shape)) return "shape_not_enabled";
  return null;
}

function classify(
  facts: WordSelectionFacts,
  support: WordSelectionSupport,
  analysis: Analysis,
  enabledShapes: ReadonlySet<WordSelectionShape>,
): WordSelectionClassification {
  if (offersNoChip(facts, analysis)) return { role: "none" };
  const reasonCode = contextOnlyReason(facts, support, analysis, enabledShapes);
  return {
    role: reasonCode ? "context_only" : "rewrite",
    shape: analysis.shape,
    story: analysis.story,
    reasonCode,
  };
}

export function classifyWordSelection(
  facts: WordSelectionFacts,
  support: WordSelectionSupport,
  enabledShapes: ReadonlySet<WordSelectionShape> = WORD_SELECTION_REPLACE_SHAPES,
): WordSelectionClassification {
  return classify(facts, support, analyse(facts), enabledShapes);
}

/** Cut from the start, at a code-point boundary. */
function keepUtf8Tail(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;
  // Each UTF-16 unit takes at least one byte, so the kept tail lies within the last maxBytes units.
  let tail = value.slice(-maxBytes);
  if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
  const points = Array.from(tail);
  let used = 0;
  let start = points.length;
  while (start > 0) {
    const width = utf8ByteLength(points[start - 1]);
    if (used + width > maxBytes) break;
    used += width;
    start -= 1;
  }
  return points.slice(start).join("");
}

const present = (text: string | null): text is string => text !== null;

function surroundings(facts: WordSelectionFacts, analysis: Analysis) {
  const { anchor, paragraphs } = facts;
  if (!anchor || !analysis.parts) return { before: "", after: "" };
  const prefix = paragraphs[0].rangeText.slice(0, facts.startOffset);
  const suffix = paragraphs[paragraphs.length - 1].rangeText.slice(
    facts.endOffset,
  );
  return {
    before: keepUtf8Tail(
      [...anchor.before.filter(present).reverse(), prefix].join("\n"),
      WORD_SELECTION_CONTEXT_BYTES,
    ),
    after: cutToUtf8Bytes(
      [suffix, ...anchor.after.filter(present)].join("\n"),
      WORD_SELECTION_CONTEXT_BYTES,
    ),
  };
}

/** Null when the selection offers no chip. */
export function buildWordSelectionSnapshot(
  facts: WordSelectionFacts,
  support: WordSelectionSupport,
  origin: WordSelectionOrigin,
  enabledShapes: ReadonlySet<WordSelectionShape> = WORD_SELECTION_REPLACE_SHAPES,
): WordSelectionSnapshot | null {
  const analysis = analyse(facts);
  const classification = classify(facts, support, analysis, enabledShapes);
  if (classification.role === "none") return null;
  const fitted = fitWordSelectionText(analysis.text);
  const { before, after } = surroundings(facts, analysis);
  return {
    ...classification,
    origin,
    selectedText: fitted.text,
    truncated: fitted.truncated,
    paragraphCount: facts.paragraphs.length || analysis.text.split("\n").length,
    paragraphs: facts.paragraphs.map(
      ({ id, text, rangeText, index, styleName }) => ({
        id,
        text,
        rangeText,
        index,
        styleName,
      }),
    ),
    startOffset: facts.startOffset,
    endOffset: facts.endOffset,
    occurrence: analysis.occurrence,
    anchor: facts.anchor,
    contextBefore: before,
    contextAfter: after,
  };
}

export function wordSelectionOf(
  capture: WordSelectionCapture | null | undefined,
): WordSelectionSnapshot | null {
  return capture?.selection ?? null;
}

/** Nothing in it is writable by the paragraph actions, which bind to the document capture. */
export function emptySelectionCapture(
  identity: string,
  selection: WordSelectionSnapshot,
): WordSelectionCapture {
  return {
    identity,
    ordinalMap: new Map(),
    paragraphsSent: 0,
    renderedOrdinals: new Set(),
    partialOrdinal: null,
    selection,
  };
}

/**
 * The executor's gate. It reads the capture frozen at Send, never the model's arguments, which the
 * client may have filtered and the model may have invented.
 */
export function rewritableWordSelection(
  capture: WordSelectionCapture | null | undefined,
  enabledShapes: ReadonlySet<WordSelectionShape> = WORD_SELECTION_REPLACE_SHAPES,
): WordSelectionSnapshot | null {
  const selection = wordSelectionOf(capture);
  return selection?.role === "rewrite" && enabledShapes.has(selection.shape)
    ? selection
    : null;
}

/** The live position of the first covered paragraph, from a tracked Range. */
export interface WordSelectionHint {
  position: number;
}

export type WordSelectionResolution =
  | { positions: number[] }
  | {
      refused: Extract<
        WordSelectionReplaceCode,
        | "TARGET_TEXT_MISMATCH"
        | "TARGET_NOT_FOUND"
        | "AMBIGUOUS_TARGET"
        | "HINT_CONFLICT"
      >;
    };

function decidedById(
  anchor: WordParagraphAnchor,
  live: readonly WordParagraphEntry[],
): boolean {
  if (!anchor.paragraphs.every((p) => p.id)) return false;
  const ids = new Set(live.map((p) => p.id));
  return anchor.paragraphs.every((p) => ids.has(p.id));
}

/**
 * The captured neighbours still enclose as many paragraphs as were covered, so the span was
 * edited rather than removed. This only picks the message; both codes refuse.
 */
function editedInPlace(
  anchor: WordParagraphAnchor,
  live: readonly WordParagraphEntry[],
): boolean {
  const covered = anchor.paragraphs.length;
  const edge = (index: number, expected: string | null) =>
    expected === null
      ? index === -1 || index === live.length
      : index >= 0 && index < live.length && live[index].text === expected;
  for (let start = 0; start + covered <= live.length; start += 1) {
    if (
      edge(start - 1, anchor.before[0]) &&
      edge(start + covered, anchor.after[0])
    )
      return true;
  }
  return false;
}

/**
 * Proves the captured paragraphs in the live story: the paragraph resolver, then the offset text,
 * which must be unchanged too because the span's offsets count in it. The stored index is never
 * consulted. A tracked Range hint must agree with a surviving ID; without IDs it proposes the
 * paragraphs, and their exact text decides.
 */
export function resolveWordSelection(
  selection: WordSelectionSnapshot,
  liveEntries: readonly WordParagraphEntry[],
  liveRangeTexts: readonly string[],
  hint?: WordSelectionHint,
): WordSelectionResolution {
  const { anchor } = selection;
  if (!anchor || anchor.paragraphs.length !== selection.paragraphs.length)
    return { refused: "TARGET_NOT_FOUND" };
  const byId = decidedById(anchor, liveEntries);
  const resolved = resolveWordParagraphs(anchor, liveEntries);
  let positions = "positions" in resolved ? resolved.positions : null;
  if (hint && byId && positions && positions[0] !== hint.position)
    return { refused: "HINT_CONFLICT" };
  if (hint && !byId) {
    const proposed = anchor.paragraphs.map((_, i) => hint.position + i);
    const proven = proposed.every(
      (position, i) =>
        liveEntries[position]?.text === anchor.paragraphs[i].text,
    );
    if (!proven) return { refused: "TARGET_TEXT_MISMATCH" };
    if (positions && positions[0] !== hint.position)
      return { refused: "AMBIGUOUS_TARGET" };
    positions = proposed;
  }
  if (!positions)
    return {
      refused:
        "refused" in resolved && resolved.refused === "ambiguous"
          ? "AMBIGUOUS_TARGET"
          : byId || editedInPlace(anchor, liveEntries)
            ? "TARGET_TEXT_MISMATCH"
            : "TARGET_NOT_FOUND",
    };
  return positions.every(
    (position, i) =>
      liveRangeTexts[position] === selection.paragraphs[i].rangeText,
  )
    ? { positions }
    : { refused: "TARGET_TEXT_MISMATCH" };
}
