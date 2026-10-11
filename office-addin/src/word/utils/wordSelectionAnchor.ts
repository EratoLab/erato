import { cutToUtf8Bytes } from "./buildWordDocumentArgs";
import { resolveWordParagraphs } from "./wordParagraphResolver";
import { fitWordSelectionText } from "./wordSelectionArgs";
import { WORD_CONTROL_CHARACTER } from "./wordSelectionEdit";
import { WORD_MARKER } from "./wordSelectionItems";
import { searchStartsOf, wordSearchable } from "./wordSelectionRange";
import {
  fitsActionFacetArg,
  utf8ByteLength,
} from "../../core/clientActions/actionFacetArgs";

import type {
  WordParagraphAnchor,
  WordParagraphEntry,
} from "./wordParagraphResolver";
import type {
  WordKeptItemKind,
  WordKeptMarker,
  WordMarkedPart,
} from "./wordSelectionItems";
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
/** Per side. The neighbours only inform the model; the target proof uses the anchor. */
export const WORD_SELECTION_CONTEXT_BYTES = 4_096;

/**
 * Shapes Replace may write. A shape is added only once its native harness row is green on every
 * host; until then an otherwise eligible selection is sent as context only.
 */
export const WORD_SELECTION_REPLACE_SHAPES: ReadonlySet<WordSelectionShape> =
  new Set<WordSelectionShape>([
    "paragraph",
    "inline",
    "multi_paragraph",
    "table_cell",
  ]);

/** Why a selection is sent as context only; the card maps each code to its own V2-4 message. */
export const WORD_SELECTION_REASON_CODES = [
  "host_unsupported",
  "other_story",
  "whole_table",
  "multi_cell",
  "nested_table",
  "cell_multi_paragraph",
  "too_many_paragraphs",
  "too_large",
  "position_unknown",
  "empty_edge_paragraph",
  "tracked_changes",
  "hyperlink",
  "field",
  "content_control",
  "hidden_text",
  "note_reference",
  "comment_mark",
  "inline_picture",
  "line_break",
  "special_character",
  /** A bookmark other than Word's own _GoBack, such as a table of contents' or a cross-reference's. */
  "bookmark",
  "unsupported_formatting",
  "mixed_formatting",
  /** Superscript or subscript on part of the span only, as in m² or CO₂. */
  "mixed_script",
  "complex_script_format",
  "web_picture_offset",
  "style_font_unavailable",
  "not_unique",
  "shape_not_enabled",
  /** The selection starts or ends inside a field's result, a note reference or a comment's anchor. */
  "item_cut",
] as const;

export type WordSelectionReasonCode =
  (typeof WORD_SELECTION_REASON_CODES)[number];

/** Every code except UNVERIFIED_AFTER_WRITE means nothing was written. */
export const WORD_SELECTION_REPLACE_CODES = [
  "TARGET_TEXT_MISMATCH",
  "TARGET_NOT_FOUND",
  "AMBIGUOUS_TARGET",
  "UNSUPPORTED_CONTENT",
  "PARAGRAPH_COUNT_MISMATCH",
  "INVALID_REPLACEMENT",
  /** The paragraph is proven, but Word's search could not pinpoint the passage inside it. */
  "TARGET_RANGE_UNPROVEN",
  /** The proposal lost, doubled or moved a marker of a kept item. */
  "MARKERS_CHANGED",
  /** Track Changes is on, and a passage with kept items would be redlined as a whole paragraph. */
  "TRACKED_ITEMS",
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
   * wordSelectionTargetFormat left a property unresolved, such as a colour on part of the span, or
   * a kept paragraph's rewrite would drop a property its text has in part only.
   */
  mixedFormatting?: boolean;
  /**
   * Superscript or subscript on part of the span only (m², CO₂, 1st). Both rewrites give the text
   * one baseline, which changes what it says.
   */
  mixedScript?: boolean;
  /**
   * Complex-script run formatting that differs from its Latin twin (bCs vs b, iCs vs i, szCs vs sz,
   * the cs font vs ascii), rtl, or complex-script characters. The rewrite's formatting rule tracks
   * no twin of its own and rtl has no setter, so no host keeps them through Replace.
   */
  complexScript?: boolean;
  /**
   * A direct bCs or iCs equal to its Latin toggle where that toggle is mixed in the span. Word for
   * the web writes such twins on its own Ctrl+B, so they are benign where the rewrite resets them:
   * on the web, whose Latin setters write the twin too, or with the bidi setters. Desktop without
   * them would copy the first character's twin onto the whole rewrite.
   */
  complexScriptTwin?: boolean;
  /**
   * A break, w:sym, a non-breaking or optional hyphen, or any other paragraph content that is not
   * plain text (an equation, ruby text, a permission range).
   */
  breakOrSymbol?: boolean;
  /**
   * A bookmark other than Word's own _GoBack. It is invisible, but a table of contents, a
   * cross-reference or a macro may point to it, and Word deletes it when its whole text is replaced
   * (BM0).
   */
  bookmark?: boolean;
  /** The runs' text does not spell paragraph.text, so offsets into it cannot be mapped onto runs. */
  textMismatch?: boolean;
}

export interface WordSelectionFacts {
  isEmpty: boolean;
  /** Word.BodyType of the story holding the selection, outside any table ("MainDoc", "Header", ...). */
  storyType: string;
  /** Word's selection.text. */
  selectionText: string;
  /** The selection is a picture or a shape, without text. */
  objectOnly: boolean;
  /** "whole" when every table the selection touches is covered completely. */
  tables: "none" | "whole" | "partial";
  /** In story order; ids are unknown on a host that cannot rewrite, and identity texts stand in. */
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
  /**
   * The span's hazard scan and style font read ran. The capture runs them only when nothing else
   * keeps the selection context only, and an unchecked span is never rewritten.
   */
  spanChecked?: boolean;
  /**
   * Word's search hits for a covered part did not line up with the paragraph text's matches at
   * capture, so Replace could not pinpoint the part either.
   */
  searchMismatch?: boolean;
  /**
   * The selection's getReviewedText("Current"), without tracked deletions. The model is sent this
   * when paragraph.text holds text that getText leaves out, as on PC and the web.
   */
  reviewedText?: string;
  /**
   * Per covered paragraph, set by the span checks where it holds items to keep: its part with
   * markers, or "cut" where the part starts or ends inside one; null for a paragraph without items.
   */
  kept?: readonly (WordMarkedPart | "cut" | null)[];
  /** The span checks found bold, italic, underline or strikethrough a rewrite would not keep. */
  flattensEmphasis?: boolean;
}

export interface WordSelectionParagraph {
  id: string | null;
  text: string;
  rangeText: string;
  /** Its part with markers for the items it keeps, written whole as OOXML; absent otherwise. */
  kept?: {
    text: string;
    markers: readonly WordKeptMarker[];
    kinds: readonly WordKeptItemKind[];
  };
  /** A hint only: a paragraph inserted above moves it without changing the target. */
  index: number;
  styleName: string;
  /** 0 outside tables. */
  tableNestingLevel: number;
}

export interface WordSelectionSnapshot {
  role: WordSelectionRole;
  reasonCode: WordSelectionReasonCode | null;
  shape: WordSelectionShape;
  story: WordSelectionStory;
  origin: WordSelectionOrigin;
  /** The covered part of each paragraph, one line each, without tracked deletions or comment marks. */
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
  /**
   * The paragraphs before the span, then a last line with the span paragraph's text before it,
   * left empty when paragraph.text holds a tracked deletion.
   */
  contextBefore: string;
  /** A first line with the span paragraph's text after it (empty likewise), then the paragraphs after. */
  contextAfter: string;
  /**
   * Bold, italic, underline or strikethrough on part of the covered text only, which Replace gives
   * the paragraph's style. Only on a rewrite; the card says so before Replace.
   */
  flattensEmphasis?: true;
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
  startOffset: number,
  endOffset: number,
): string[] {
  return wordSelectionPartOffsets({ paragraphs, startOffset, endOffset }).map(
    ({ start, end }, i) => paragraphs[i].rangeText.slice(start, end),
  );
}

export function wordSelectionParts(selection: WordSelectionSnapshot): string[] {
  return coveredParts(
    selection.paragraphs,
    selection.startOffset,
    selection.endOffset,
  );
}

export interface WordSelectionPartOffsets {
  start: number;
  /** Exclusive. */
  end: number;
  /** The part is the paragraph's whole text, so the paragraph itself is the target. */
  whole: boolean;
}

/** Where each covered paragraph's part lies in its rangeText. */
export function wordSelectionPartOffsets(selection: {
  paragraphs: readonly { rangeText: string }[];
  startOffset: number;
  endOffset: number;
}): WordSelectionPartOffsets[] {
  const last = selection.paragraphs.length - 1;
  return selection.paragraphs.map((p, i) => {
    const start = i === 0 ? selection.startOffset : 0;
    const end = i === last ? selection.endOffset : p.rangeText.length;
    return { start, end, whole: start === 0 && end === p.rangeText.length };
  });
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
    // -1 when no match of Word's search starts at the offset, as inside an overlapping repeat.
    occurrence: parts
      ? searchStartsOf(paragraphs[0].rangeText, parts[0]).indexOf(
          facts.startOffset,
        )
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

/**
 * The first hazard that keeps a span context only on this host. Some are benign where the rewrite
 * resets them (complex-script twins on the web), so a hazard flag alone does not decide.
 */
export function wordSelectionHazardReason(
  hazards: WordSelectionHazards,
  parts: readonly string[],
  support: WordSelectionSupport,
): WordSelectionReasonCode | null {
  const contains = (mark: string) => parts.some((part) => part.includes(mark));
  if (hazards.trackedChange) return "tracked_changes";
  // Before the items: a paragraph's items can be kept, but not with a bookmark among them.
  if (hazards.bookmark) return "bookmark";
  if (hazards.hyperlink) return "hyperlink";
  if (hazards.field) return "field";
  if (hazards.contentControl) return "content_control";
  if (hazards.hiddenText) return "hidden_text";
  if (hazards.noteReference || contains("\u0002")) return "note_reference";
  if (hazards.commentMark || contains("\u0005")) return "comment_mark";
  if (hazards.inlinePicture) return "inline_picture";
  if (contains("\u000B")) return "line_break";
  if (
    hazards.breakOrSymbol ||
    parts.some((part) => WORD_CONTROL_CHARACTER.test(part))
  )
    return "special_character";
  if (hazards.mixedScript) return "mixed_script";
  if (hazards.unsupportedFormatting) return "unsupported_formatting";
  if (hazards.mixedFormatting) return "mixed_formatting";
  if (
    hazards.complexScript ||
    (hazards.complexScriptTwin &&
      !support.bidiSetters &&
      !support.twinsFollowLatin)
  )
    return "complex_script_format";
  if (hazards.textMismatch) return "position_unknown";
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
  if (!fitsActionFacetArg(analysis.text)) return "too_large";
  if (!enabledShapes.has(shape)) return "shape_not_enabled";
  // Desktop's selection text holds a section or page break (\f) where its paragraph texts have
  // none, so the offsets cannot be placed; the mark, not the position, is the reason.
  const marked = parts
    ? null
    : wordSelectionHazardReason({}, [facts.selectionText], support);
  if (marked) return marked;
  if (!parts || !anchor || !anchorMatches(facts)) return "position_unknown";
  if (
    shape === "multi_paragraph" &&
    (parts[0] === "" || parts[parts.length - 1] === "")
  )
    return "empty_edge_paragraph";
  if (facts.kept?.includes("cut")) return "item_cut";
  const keptAt = (i: number) => keptPart(facts, i) !== null;
  if (
    facts.kept?.some((k) => k !== null && k !== "cut") &&
    support.keptItemParagraphs !== null &&
    paragraphs.length > support.keptItemParagraphs
  )
    return "too_many_paragraphs";
  // A mark anywhere in a covered paragraph counts: the span checks judge whole paragraphs too.
  // Before them, an item's mark may still turn out to be kept, so it is not a reason yet.
  const mayKeep = support.keepsItems && !facts.spanChecked;
  const hazard = wordSelectionHazardReason(
    facts.hazards,
    paragraphs.map((p, i) =>
      keptAt(i) || mayKeep ? withoutItemMarks(p.rangeText) : p.rangeText,
    ),
    support,
  );
  if (hazard) return hazard;
  if (facts.pictureBeforeSpan && support.picturesShiftOffsets)
    return "web_picture_offset";
  if (
    facts.spanChecked &&
    (support.styleFontSource === null || !facts.styleFontResolved)
  )
    return "style_font_unavailable";
  if (analysis.occurrence < 0) return "position_unknown";
  // paragraph.text shows text the model must not see and no reviewed text came with the capture.
  if (
    !facts.reviewedText &&
    !paragraphs.every(
      (p, i) => visibleOffsetText(p, keptAt(i) || mayKeep) !== null,
    )
  )
    return "position_unknown";
  // A paragraph with kept items is written whole, so Word's search never has to find its part.
  const searched = (i: number) => !keptAt(i);
  // Word's search reads ^ as a special-character code, so it could not find the span again.
  if (parts.some((part, i) => searched(i) && part.includes("^")))
    return "position_unknown";
  // Word for the web finds a part of a paragraph only as one search hit for its whole text.
  if (
    !support.prefixRanges &&
    wordSelectionPartOffsets(facts).some(
      (offsets, i) =>
        searched(i) &&
        !offsets.whole &&
        !(mayKeep && hasItemMarks(parts[i])) &&
        !wordSearchable(parts[i], support.searchMaxCharacters),
    )
  )
    return "position_unknown";
  if (facts.searchMismatch) return "position_unknown";
  // Capture step 6: without IDs or a unique text window, the paragraphs cannot be found again.
  if (anchor.window === null && !anchor.paragraphs.every((p) => p.id))
    return "not_unique";
  // Every other check passed; the span's own content was not looked at yet.
  if (!facts.spanChecked) return "shape_not_enabled";
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

/**
 * Whether a paragraph's identity text (getText) is exactly `visible`. Desktop's ends with the
 * paragraph mark, or with "\t" for the paragraph that ends a table cell; the web's has no mark.
 */
export function wordIdentityShows(
  identity: string,
  visible: string,
  inCell: boolean,
): boolean {
  return (
    identity === visible ||
    identity === `${visible}\r` ||
    (inCell && identity === `${visible}\t`)
  );
}

/** A neighbour's identity text for the model's context, without desktop's paragraph or cell mark. */
const withoutMark = (text: string) => text.replace(/[\r\t]$/, "");

/** The marks kept items leave in paragraph.text: note references, comment anchors, line breaks. */
const ITEM_MARKS = /[\u0002\u0005\u000B]/g;
const withoutItemMarks = (text: string) => text.replace(ITEM_MARKS, "");
const hasItemMarks = (text: string) => /[\u0002\u0005\u000B]/.test(text);

/** The paragraph's part with markers, where it keeps items. */
function keptPart(facts: WordSelectionFacts, i: number): WordMarkedPart | null {
  const kept = facts.kept?.[i];
  return kept && kept !== "cut" ? kept : null;
}

/**
 * The paragraph's offset text with its comment marks removed, when that equals the identity text;
 * null when paragraph.text holds more, such as a tracked deletion, which the model must not see.
 * With `items`, a note reference's mark, which getText leaves out, and a line break, which the
 * web's getText leaves out, count as shown too.
 */
function visibleOffsetText(
  p: WordSelectionParagraphFacts,
  items = false,
): string | null {
  const inCell = p.tableNestingLevel > 0;
  const visible = p.rangeText.replace(/\u0005/g, "");
  if (wordIdentityShows(p.text, visible, inCell)) return visible;
  if (!items) return null;
  const noted = visible.replace(/\u0002/g, "");
  if (wordIdentityShows(p.text, noted, inCell)) return visible;
  return wordIdentityShows(p.text, noted.replace(/\u000B/g, ""), inCell)
    ? visible
    : null;
}

const removeCommentMarks = (text: string) => text.replace(/\u0005/g, "");

/** Desktop's reviewed text spells out each field as \u0013code\u0014result\u0015; only the result is text. */
function fieldResults(text: string): string {
  let previous: string;
  let out = text;
  do {
    previous = out;
    out = out
      .replace(
        /\u0013[^\u0013\u0014\u0015]*\u0014([^\u0013\u0015]*)\u0015/g,
        "$1",
      )
      .replace(/\u0013[^\u0013\u0014\u0015]*\u0015/g, "");
  } while (out !== previous);
  return out;
}

/** What the model is sent as the selected text; the offsets keep counting in rangeText. */
function modelText(
  facts: WordSelectionFacts,
  analysis: Analysis,
  marked: boolean,
): string {
  const reviewed = () =>
    removeCommentMarks(fieldResults(facts.reviewedText ?? ""))
      .replace(/\r\n?/g, "\n")
      .replace(/\n+$/, "");
  if (!analysis.parts)
    return facts.reviewedText === undefined
      ? removeCommentMarks(analysis.text)
      : reviewed();
  const { parts } = analysis;
  // Markers only for a rewrite, which keeps the items; otherwise the items' own text.
  if (
    marked &&
    facts.kept?.some((k) => k !== null && k !== "cut") &&
    facts.paragraphs.every(
      (p, i) => visibleOffsetText(p, keptPart(facts, i) !== null) !== null,
    )
  )
    return parts
      .map((part, i) => keptPart(facts, i)?.text ?? removeCommentMarks(part))
      .join("\n");
  if (facts.paragraphs.every((p) => visibleOffsetText(p) !== null))
    return removeCommentMarks(analysis.text);
  return reviewed();
}

function surroundings(facts: WordSelectionFacts, analysis: Analysis) {
  const { anchor, paragraphs } = facts;
  if (!anchor || !analysis.parts) return { before: "", after: "" };
  const first = paragraphs[0];
  const last = paragraphs[paragraphs.length - 1];
  const items = (i: number) => keptPart(facts, i) !== null;
  const prefix =
    visibleOffsetText(first, items(0)) === null
      ? ""
      : withoutItemMarks(first.rangeText.slice(0, facts.startOffset));
  const suffix =
    visibleOffsetText(last, items(paragraphs.length - 1)) === null
      ? ""
      : withoutItemMarks(last.rangeText.slice(facts.endOffset));
  return {
    before: keepUtf8Tail(
      [
        ...anchor.before.filter(present).map(withoutMark).reverse(),
        prefix,
      ].join("\n"),
      WORD_SELECTION_CONTEXT_BYTES,
    ),
    after: cutToUtf8Bytes(
      [suffix, ...anchor.after.filter(present).map(withoutMark)].join("\n"),
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
  const rewrite = classification.role === "rewrite";
  const fitted = fitWordSelectionText(modelText(facts, analysis, rewrite));
  const { before, after } = surroundings(facts, analysis);
  return {
    ...classification,
    origin,
    selectedText: fitted.text,
    truncated: fitted.truncated,
    paragraphCount: facts.paragraphs.length || analysis.text.split("\n").length,
    paragraphs: facts.paragraphs.map(
      ({ id, text, rangeText, index, styleName, tableNestingLevel }, i) => {
        const kept = rewrite ? keptPart(facts, i) : null;
        return {
          id,
          text,
          rangeText,
          index,
          styleName,
          tableNestingLevel,
          ...(kept
            ? {
                kept: {
                  text: kept.text,
                  markers: kept.markers,
                  kinds: kept.kinds ?? [],
                },
              }
            : {}),
        };
      },
    ),
    startOffset: facts.startOffset,
    endOffset: facts.endOffset,
    occurrence: analysis.occurrence,
    anchor: facts.anchor,
    contextBefore: before,
    contextAfter: after,
    ...(rewrite && facts.flattensEmphasis ? { flattensEmphasis: true } : {}),
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
 * After an ambiguous refusal the user may pick which of the identical passages they meant. The
 * reviewed proposal then fits the pick only if its covered text is byte-identical and splits the
 * same way.
 */
export function isSameWordPassage(
  requested: WordSelectionSnapshot,
  picked: WordSelectionSnapshot,
): boolean {
  return (
    picked.shape === requested.shape &&
    picked.paragraphCount === requested.paragraphCount &&
    !picked.truncated &&
    !requested.truncated &&
    picked.selectedText === requested.selectedText
  );
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

export type WordSelectionResolution =
  | { positions: number[] }
  | {
      refused: Extract<
        WordSelectionReplaceCode,
        "TARGET_TEXT_MISMATCH" | "TARGET_NOT_FOUND" | "AMBIGUOUS_TARGET"
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
 * consulted.
 */
export function resolveWordSelection(
  selection: WordSelectionSnapshot,
  liveEntries: readonly WordParagraphEntry[],
  liveRangeTexts: readonly string[],
): WordSelectionResolution {
  const { anchor } = selection;
  if (!anchor || anchor.paragraphs.length !== selection.paragraphs.length)
    return { refused: "TARGET_NOT_FOUND" };
  const byId = decidedById(anchor, liveEntries);
  const resolved = resolveWordParagraphs(anchor, liveEntries);
  const positions = "positions" in resolved ? resolved.positions : null;
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

const WORD_CONTROL_CHARACTER_GLOBAL = new RegExp(
  WORD_CONTROL_CHARACTER.source,
  "g",
);

/** The reason a kept item's kind gave before items could be kept (D-10). */
const KEPT_ITEM_REASON: Readonly<
  Record<WordKeptItemKind, WordSelectionReasonCode>
> = {
  field: "field",
  link: "hyperlink",
  note: "note_reference",
  comment: "comment_mark",
  picture: "inline_picture",
  break: "line_break",
  control: "content_control",
};

/**
 * The selection as context only, with each marker replaced by what its item shows, for a server
 * whose word_selection facet does not explain markers yet (no kept_items argument).
 */
export function wordSelectionWithoutKeptItems(
  selection: WordSelectionSnapshot,
): WordSelectionSnapshot {
  const kept = selection.paragraphs.filter((p) => p.kept);
  if (selection.role !== "rewrite" || kept.length === 0) return selection;
  const shows = new Map<number, string>();
  for (const p of kept)
    for (const marker of p.kept!.markers)
      if (marker.end === "point")
        shows.set(
          marker.number,
          marker.shows.replace(WORD_CONTROL_CHARACTER_GLOBAL, ""),
        );
  const kind = kept[0].kept!.kinds[0] ?? "field";
  const { flattensEmphasis: _flattens, ...rest } = selection;
  return {
    ...rest,
    role: "context_only",
    reasonCode: KEPT_ITEM_REASON[kind],
    selectedText: selection.selectedText.replace(
      WORD_MARKER,
      (marker, close: string, number: string) =>
        close ? "" : (shows.get(Number(number)) ?? ""),
    ),
    paragraphs: selection.paragraphs.map(({ kept: _kept, ...p }) => p),
  };
}
