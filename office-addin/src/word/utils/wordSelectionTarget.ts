import { wordParagraphId } from "./wordParagraphIds";
import { resolveWordParagraphs } from "./wordParagraphResolver";
import {
  selectsAcrossParagraphs,
  selectWordRange,
  WORD_SELECTION_TEXT_OPTIONS,
} from "./wordReviewLocation";
import { runWordGuarded } from "./wordRunGuard";
import {
  resolveWordSelection,
  WORD_SELECTION_MAX_PARAGRAPHS,
  WORD_SELECTION_REPLACE_SHAPES,
  wordSelectionHazardReason,
  wordSelectionPartOffsets,
  wordSelectionParts,
} from "./wordSelectionAnchor";
import { markWordParagraphOoxml } from "./wordSelectionFormatSpans";
import {
  WORD_SELECTION_TOGGLE_PROPERTIES,
  wordSelectionEdgeOnly,
  wordSelectionTargetFormat,
} from "./wordSelectionFormatting";
import { wordParagraphElement } from "./wordSelectionItems";
import { buildWordSelectionRanges } from "./wordSelectionRange";
import { wordPartFormatLoss } from "./wordSelectionRewrite";
import {
  scanWordSelectionSpan,
  WORD_BOOKMARK,
  wordCellParagraphOoxml,
  wordSelectionStyleToggles,
} from "./wordSelectionSpan";
import { currentWordSelectionSupport } from "./wordSelectionSupport";

import type {
  WordParagraphAnchor,
  WordParagraphEntry,
} from "./wordParagraphResolver";
import type { WordRunGuard } from "./wordRunGuard";
import type {
  WordSelectionHazards,
  WordSelectionParagraph,
  WordSelectionReplaceCode,
  WordSelectionShape,
  WordSelectionSnapshot,
} from "./wordSelectionAnchor";
import type { WordSelectionTargetFormat } from "./wordSelectionFormatting";
import type { WordSelectionRangePart } from "./wordSelectionRange";
import type { WordSelectionSpanSlice } from "./wordSelectionSpan";
import type { WordSelectionSupport } from "./wordSelectionSupport";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const W16CID = "http://schemas.microsoft.com/office/word/2016/wordml/cid";
const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";

export const WORD_SELECTION_SHOW_TIMEOUT_MS = 10_000;
/**
 * Added to a run's timeout per comment whose anchor queueWordCommentAnchors compares.
 * Word for the web mapped 50 anchors in 33.6 s (ERMAIN-947 P-PERF).
 */
export const WORD_COMMENT_ANCHOR_CHECK_MS = 1_000;

/** The body's paragraphs: proxies, IDs and identity texts for the resolver, and paragraph.text. */
export interface WordStoryRead {
  items: Word.Paragraph[];
  entries: WordParagraphEntry[];
  rangeTexts: string[];
}

export async function readWordStory(
  context: Word.RequestContext,
): Promise<WordStoryRead> {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load("items/uniqueLocalId,items/text");
  await context.sync();
  const texts = paragraphs.items.map((p) =>
    p.getText(WORD_SELECTION_TEXT_OPTIONS),
  );
  await context.sync();
  return {
    items: paragraphs.items,
    entries: paragraphs.items.map((p, i) => ({
      id: wordParagraphId(p.uniqueLocalId),
      text: texts[i].value,
    })),
    rangeTexts: paragraphs.items.map((p) => p.text),
  };
}

/** Queued on a paragraph; the result reads after the caller's sync. */
export interface WordParagraphSpanChecks {
  ooxml: string;
  objectHazards: WordSelectionHazards;
  /** Range.getBookmarks, other than Word's own _GoBack; null where they are not listed. */
  bookmarks: string[] | null;
  /**
   * Listed comments the OOXML does not hold, which settleWordCommentAnchors may still find to lie
   * around the paragraph; until then they count as a commentMark. Null when there are none, or
   * when the package cannot tell which ones they are.
   */
  commentsOutside: WordCommentsOutside | null;
}

/** A paragraph and the comments getComments listed for it that its own OOXML does not hold. */
export interface WordCommentsOutside {
  paragraph: Word.Paragraph;
  comments: Word.Comment[];
}

/**
 * A whole paragraph's own OOXML, which is both the hazard scan's input and the Undo backup, and the
 * content controls, fields and comments the OOXML can miss around it (PF3, ERMAIN-955). All are
 * reads Word for the web leaves the document unchanged by: no range inside the paragraph is built.
 * `inCell` tells it to find which cell the paragraph is in, so its own OOXML can be cut out of a
 * whole row. `listBookmarks` also lists its bookmarks, where the OOXML is not known to show them
 * all.
 */
export function queueParagraphSpanChecks(
  paragraph: Word.Paragraph,
  inCell = false,
  listBookmarks = false,
): () => WordParagraphSpanChecks {
  const ooxml = paragraph.getOoxml();
  const comments = paragraph.getComments();
  comments.load("items/id");
  // Adjacent ones too: one that starts or ends right at the text's edge, or an empty one there,
  // may move or go when the text is rewritten.
  const bookmarks = listBookmarks
    ? paragraph.getRange("Content").getBookmarks(true, true)
    : null;
  const cell = inCell ? paragraph.parentTableCellOrNullObject : null;
  if (cell) {
    cell.load("cellIndex");
    paragraph.load("text");
  }
  const controls = paragraph.contentControls;
  controls.load("items/id");
  const parent = paragraph.parentContentControlOrNullObject;
  parent.load("id");
  const fields = paragraph.fields;
  fields.load("items/code");
  // Includes a revision of the paragraph mark, which the web's paragraph OOXML does not show.
  const revisions = paragraph.getTrackedChanges();
  revisions.load("items/type");
  return () => {
    const own =
      cell && !cell.isNullObject
        ? wordCellParagraphOoxml(ooxml.value, cell.cellIndex, paragraph.text)
        : ooxml.value;
    const outside = wordListedCommentsOutside(paragraph, own, comments.items);
    return {
      ooxml: own,
      objectHazards: {
        ...(controls.items.length > 0 || !parent.isNullObject
          ? { contentControl: true }
          : {}),
        ...(fields.items.length > 0 ? { field: true } : {}),
        ...(revisions.items.length > 0 ? { trackedChange: true } : {}),
        ...(outside ? { commentMark: true } : {}),
      },
      bookmarks:
        bookmarks?.value.filter((name) => name !== WORD_BOOKMARK) ?? null,
      commentsOutside: outside === "uncertain" ? null : outside,
    };
  };
}

/** The comments getComments listed for a paragraph that its own OOXML does not hold. */
export interface WordCommentsOutsidePackage {
  /** As String(Comment.id): Word for the web gives Comment.id as a number. */
  missing: string[];
  /**
   * Which ones are missing cannot be told, so `missing` names every listed one: a legacy package
   * marks fewer comments in the paragraph than were listed and has no ids, or the package holds
   * only one end of a comment's range.
   */
  uncertain: boolean;
}

function packagePart(doc: Document, name: string): Element | null {
  const part = Array.from(doc.getElementsByTagNameNS(PKG, "part")).find(
    (p) =>
      (p.getAttributeNS(PKG, "name") ?? p.getAttribute("pkg:name")) === name,
  );
  return (
    part?.getElementsByTagNameNS(PKG, "xmlData")[0]?.firstElementChild ?? null
  );
}

/** The w:ids of replies, whose last paragraph commentsExtended gives a parent. */
function replyCommentIds(
  comments: Element,
  extended: Element | null,
): Set<string> {
  if (!extended) return new Set();
  const children = new Set(
    Array.from(extended.getElementsByTagNameNS(W15, "commentEx"))
      .filter((entry) => entry.hasAttributeNS(W15, "paraIdParent"))
      .map((entry) => entry.getAttributeNS(W15, "paraId")?.toUpperCase()),
  );
  return new Set(
    Array.from(comments.getElementsByTagNameNS(W, "comment")).flatMap(
      (comment) => {
        const paragraphs = comment.getElementsByTagNameNS(W, "p");
        const last = paragraphs[paragraphs.length - 1];
        return last &&
          children.has(last.getAttributeNS(W14, "paraId")?.toUpperCase())
          ? [comment.getAttributeNS(W, "id") ?? ""]
          : [];
      },
    ),
  );
}

/**
 * Whether the part holds only one end of a comment's range. A cell paragraph's package is cut from
 * its whole row's (wordCellParagraphOoxml), whose parts still name a comment that reaches from it
 * into another paragraph of the row.
 */
function holdsOneEndOnly(part: Element): boolean {
  const marked = (name: string) =>
    new Set(
      Array.from(
        part.getElementsByTagNameNS(W, name),
        (mark) => mark.getAttributeNS(W, "id") ?? "",
      ),
    );
  const starts = marked("commentRangeStart");
  const ends = marked("commentRangeEnd");
  return (
    [...starts].some((id) => !ends.has(id)) ||
    [...ends].some((id) => !starts.has(id))
  );
}

/**
 * Which of the comments getComments listed for a paragraph its own OOXML leaves out. Word leaves a
 * comment whose anchor spans paragraphs out of each one's package, marks and parts alike, while
 * getComments lists it there (F-13). A comment is held where commentsIds gives its durableId,
 * which Comment.id spells in decimal (F-2), and the package holds both ends of every comment range
 * it has. A legacy package has comments but no commentsIds (the web never writes them for such
 * files), so its root comments marked in the paragraph, by a start or a reference, are counted
 * instead.
 */
export function wordCommentsOutsidePackage(
  ooxml: string,
  listed: readonly (string | number)[],
): WordCommentsOutsidePackage {
  const ids = listed.map(String);
  if (!ids.length) return { missing: [], uncertain: false };
  const doc = new DOMParser().parseFromString(ooxml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    return { missing: ids, uncertain: true };
  if (
    holdsOneEndOnly(
      packagePart(doc, "/word/document.xml") ?? doc.documentElement,
    )
  )
    return { missing: ids, uncertain: true };
  const commentsIds = packagePart(doc, "/word/commentsIds.xml");
  if (commentsIds) {
    const held = new Set(
      Array.from(
        commentsIds.getElementsByTagNameNS(W16CID, "commentId"),
        (entry) =>
          String(parseInt(entry.getAttributeNS(W16CID, "durableId") ?? "", 16)),
      ),
    );
    return { missing: ids.filter((id) => !held.has(id)), uncertain: false };
  }
  const comments = packagePart(doc, "/word/comments.xml");
  if (!comments) return { missing: ids, uncertain: false };
  const paragraph = wordParagraphElement(ooxml)?.paragraph;
  if (!paragraph) return { missing: ids, uncertain: true };
  const replies = replyCommentIds(
    comments,
    packagePart(doc, "/word/commentsExtended.xml"),
  );
  const marked = new Set(
    ["commentRangeStart", "commentReference"]
      .flatMap((name) =>
        Array.from(
          paragraph.getElementsByTagNameNS(W, name),
          (mark) => mark.getAttributeNS(W, "id") ?? "",
        ),
      )
      .filter((id) => !replies.has(id)),
  );
  return ids.length > marked.size
    ? { missing: ids, uncertain: true }
    : { missing: [], uncertain: false };
}

/**
 * The comments listed for `paragraph` that `ooxml`, its own package, does not hold: null when it
 * holds them all, and "uncertain" when it lacks some but cannot tell which.
 */
export function wordListedCommentsOutside(
  paragraph: Word.Paragraph,
  ooxml: string,
  listed: readonly Word.Comment[],
): WordCommentsOutside | "uncertain" | null {
  const { missing, uncertain } = wordCommentsOutsidePackage(
    ooxml,
    listed.map((comment) => comment.id),
  );
  if (missing.length === 0) return null;
  if (uncertain) return "uncertain";
  const ids = new Set(missing);
  return {
    paragraph,
    comments: listed.filter((comment) => ids.has(String(comment.id))),
  };
}

/**
 * Queued only: the anchor of each comment `outside` names, compared with its paragraph; null when
 * there is none to compare. Read after the sync, it gives per entry the ids of the comments whose
 * anchor lies strictly around the paragraph, as it does around the middle one of three: a write of
 * the paragraph's own OOXML moves no mark of theirs. A mark at or inside its edge, even an
 * anchor's start at its first character, would move or go (ERMAIN-955), so every other relation
 * leaves the id out.
 */
export function queueWordCommentAnchors(
  outside: readonly (WordCommentsOutside | "uncertain" | null)[],
  guard?: Pick<WordRunGuard, "extendTimeout">,
): (() => Set<string>[]) | null {
  const relations = outside.map((each) => {
    if (!each || each === "uncertain") return [];
    const whole = each.paragraph.getRange("Whole");
    // Seen from the comment, an anchor around the paragraph Contains it.
    return each.comments.map((comment) => ({
      id: String(comment.id),
      relation: comment.getRange().compareLocationWith(whole),
    }));
  });
  const compared = relations.reduce((sum, each) => sum + each.length, 0);
  if (compared === 0) return null;
  guard?.extendTimeout(compared * WORD_COMMENT_ANCHOR_CHECK_MS);
  return () =>
    relations.map(
      (each) =>
        new Set(
          each
            .filter(({ relation }) => relation.value === "Contains")
            .map(({ id }) => id),
        ),
    );
}

/** Whether each comment `outside` names lies around its paragraph: among `around`. */
export function wordCommentsAround(
  outside: WordCommentsOutside | "uncertain" | null,
  around: ReadonlySet<string> | undefined,
): boolean {
  if (outside === null) return true;
  if (outside === "uncertain") return false;
  return outside.comments.every(
    (comment) => around?.has(String(comment.id)) ?? false,
  );
}

/**
 * Lifts the commentMark the span checks gave a paragraph for comments its OOXML does not hold,
 * where each lies around it (queueWordCommentAnchors).
 */
function settledChecks(
  read: WordParagraphSpanChecks,
  around: ReadonlySet<string> | undefined,
): WordParagraphSpanChecks {
  if (!read.commentsOutside) return read;
  const objectHazards = { ...read.objectHazards };
  if (wordCommentsAround(read.commentsOutside, around))
    delete objectHazards.commentMark;
  return { ...read, objectHazards, commentsOutside: null };
}

/** The span checks with their comment anchors settled, in one more sync where there are any. */
export async function settleWordCommentAnchors(
  context: Word.RequestContext,
  reads: readonly WordParagraphSpanChecks[],
  guard?: Pick<WordRunGuard, "extendTimeout">,
): Promise<WordParagraphSpanChecks[]> {
  const anchors = queueWordCommentAnchors(
    reads.map((read) => read.commentsOutside),
    guard,
  );
  if (anchors) await context.sync();
  const around = anchors?.() ?? [];
  return reads.map((read, i) => settledChecks(read, around[i]));
}

/** The bookmarks Range.getBookmarks listed that the paragraph's own OOXML does not show. */
function bookmarksHidden(checks: WordParagraphSpanChecks): boolean {
  if (!checks.bookmarks?.length) return false;
  const shown = new Set(
    Array.from(
      wordParagraphElement(checks.ooxml)?.paragraph.getElementsByTagNameNS(
        W,
        "bookmarkStart",
      ) ?? [],
    ).map((start) => start.getAttributeNS(W, "name")),
  );
  return checks.bookmarks.some((name) => !shown.has(name));
}

/** The rewrite checks of one paragraph written whole as OOXML because it keeps items. */
export interface WordKeptParagraphEvaluation {
  hazards: WordSelectionHazards;
  flattensEmphasis: boolean;
}

/**
 * What still keeps a paragraph with kept items from being rewritten: a revision, a bookmark or a
 * comment its OOXML left out, complex-script text, or formatting its part's rewrite would drop, as
 * the plain path refuses it (mixed colour, highlight, font, size or character style, and
 * superscript or subscript). Only the part's own text runs are judged; the rest of the paragraph
 * is written as it was, its bookmarks included. `formatted`: the rewrite keeps the part's format
 * spans.
 */
export function evaluateKeptParagraph(
  checks: WordParagraphSpanChecks,
  part: WordSelectionSpanSlice,
  formatted = false,
): WordKeptParagraphEvaluation {
  const { hazards } = scanWordSelectionSpan(checks.ooxml);
  const loss = wordPartFormatLoss(
    checks.ooxml,
    part.rangeText,
    part.start,
    part.end,
    formatted,
  );
  return {
    hazards: {
      ...(hazards.complexScript ? { complexScript: true } : {}),
      ...(hazards.trackedChange || checks.objectHazards.trackedChange
        ? { trackedChange: true }
        : {}),
      ...(bookmarksHidden(checks) ? { bookmark: true } : {}),
      ...(checks.objectHazards.commentMark ? { commentMark: true } : {}),
      ...(loss === null ? { unsupportedFormatting: true } : {}),
      ...(loss?.other ? { mixedFormatting: true } : {}),
      ...(loss?.script ? { mixedScript: true } : {}),
    },
    flattensEmphasis: !!loss?.emphasis,
  };
}

/** The sections wordParagraphsEndingSection reads, loaded by the caller's next sync. */
export function queueWordSections(
  context: Word.RequestContext,
): Word.SectionCollection {
  const sections = context.document.sections;
  sections.load("items");
  return sections;
}

/**
 * Per paragraph, true when it ends a section other than the last, so its mark holds the section
 * break: an Undo, which restores the paragraph from its OOXML, could move or drop it. Word for
 * Mac's paragraph OOXML leaves that sectPr out, so it is found through the sections instead. Only
 * a document with several sections needs another sync, one for all the paragraphs.
 */
export async function wordParagraphsEndingSection(
  context: Word.RequestContext,
  sections: Word.SectionCollection,
  paragraphs: readonly Word.Paragraph[],
): Promise<boolean[]> {
  if (sections.items.length < 2) return paragraphs.map(() => false);
  const ends = sections.items
    .slice(0, -1)
    .map((section) => section.body.paragraphs.getLast().getRange("Whole"));
  const relations = paragraphs.map((paragraph) => {
    const whole = paragraph.getRange("Whole");
    return ends.map((end) => end.compareLocationWith(whole));
  });
  await context.sync();
  return relations.map((each) =>
    each.some((relation) => relation.value === "Equal"),
  );
}

/** A cell paragraph's table, which a write or a restore must leave with as many rows and cells. */
export interface WordCellTable {
  nesting: number;
  rows: number;
  cells: number;
}

/** Queued only. For a paragraph the caller knows to be in a table cell. */
export function queueWordCellTable(
  paragraph: Word.Paragraph,
): () => WordCellTable {
  paragraph.load("tableNestingLevel");
  const table = paragraph.parentTableOrNullObject;
  table.load("rowCount");
  const rows = table.rows;
  rows.load("items/cellCount");
  return () => ({
    nesting: paragraph.tableNestingLevel,
    rows: table.rowCount,
    cells: rows.items.reduce((sum, row) => sum + row.cellCount, 0),
  });
}

export const sameCellTable = (a: WordCellTable, b: WordCellTable) =>
  a.nesting === b.nesting && a.rows === b.rows && a.cells === b.cells;

export interface WordParagraphSpanEvaluation {
  hazards: WordSelectionHazards;
  styleFontResolved: boolean;
  /** Null when the style font was needed but not found. */
  format: WordSelectionTargetFormat | null;
  /**
   * A mixed bold, italic, underline or strikethrough the rewrite gives the style's value: no
   * format span keeps it.
   */
  flattensEmphasis: boolean;
}

const EMPHASIS_PROPERTIES = [
  "bold",
  "italic",
  "underline",
  "strikeThrough",
] as const;

/**
 * The rewrite checks of one paragraph and the font its rewrite gets. The hazards always cover the
 * whole paragraph; with a slice, the font comes from the slice and the runs next to it. The font
 * is that of the text outside the part's format spans; `formatted`: the rewrite keeps those spans,
 * which are every run whose emphasis is mixed.
 */
export function evaluateParagraphSpan(
  checks: WordParagraphSpanChecks,
  styleName: string,
  support: WordSelectionSupport,
  slice?: WordSelectionSpanSlice,
  formatted = false,
): WordParagraphSpanEvaluation {
  const scan = scanWordSelectionSpan(checks.ooxml, slice);
  const hazards = {
    ...scan.hazards,
    ...checks.objectHazards,
    ...(checks.bookmarks?.length ? { bookmark: true } : {}),
  };
  const needsStyle = WORD_SELECTION_TOGGLE_PROPERTIES.some(
    (property) =>
      scan.format[property]?.state === "mixed" ||
      wordSelectionEdgeOnly(scan.format, scan.edges, property),
  );
  const style = needsStyle
    ? wordSelectionStyleToggles(checks.ooxml, styleName)
    : {};
  const flattensEmphasis =
    !formatted &&
    EMPHASIS_PROPERTIES.some(
      (property) => scan.format[property]?.state === "mixed",
    );
  if (!style || support.styleFontSource === null)
    return {
      hazards,
      styleFontResolved: false,
      format: null,
      flattensEmphasis,
    };
  const format = wordSelectionTargetFormat(
    scan.format,
    style,
    support.bidiSetters,
    scan.edges,
  );
  return {
    hazards: format.unresolved.length
      ? { ...hazards, mixedFormatting: true }
      : hazards,
    styleFontResolved: true,
    format,
    flattensEmphasis,
  };
}

export type WordSelectionProof =
  | {
      paragraphs: Word.Paragraph[];
      positions: number[];
      story: WordStoryRead;
      /** Per covered paragraph, what a write targets. */
      parts: WordSelectionRangePart[];
    }
  | { refused: WordSelectionReplaceCode };

/**
 * A cell's paragraph only in a table at the top level, as the capture allows; a nested cell is
 * context only, so a forced Replace must not reach it either.
 */
const provableNesting = (selection: WordSelectionSnapshot) =>
  selection.paragraphs.every(
    (p) => p.tableNestingLevel === (selection.shape === "table_cell" ? 1 : 0),
  );

/** How many paragraphs each shape this proof can build covers. */
function provableCount(shape: WordSelectionShape, count: number): boolean {
  switch (shape) {
    case "paragraph":
    case "inline":
    case "table_cell":
      return count === 1;
    case "multi_paragraph":
      return count > 1 && count <= WORD_SELECTION_MAX_PARAGRAPHS;
    default:
      return false;
  }
}

/**
 * Finds the captured paragraphs again: the resolver over the live body, then their offset text.
 * A part of a paragraph is then pinpointed in it by Word's search (wordSelectionRange).
 */
export async function proveWordSelectionTarget(
  context: Word.RequestContext,
  selection: WordSelectionSnapshot,
  support: WordSelectionSupport = currentWordSelectionSupport(),
  enabledShapes: ReadonlySet<WordSelectionShape> = WORD_SELECTION_REPLACE_SHAPES,
): Promise<WordSelectionProof> {
  if (
    !enabledShapes.has(selection.shape) ||
    !provableCount(selection.shape, selection.paragraphs.length) ||
    !provableNesting(selection)
  )
    return { refused: "UNSUPPORTED_CONTENT" };
  const story = await readWordStory(context);
  const resolved = resolveWordSelection(
    selection,
    story.entries,
    story.rangeTexts,
  );
  if ("refused" in resolved) return resolved;
  const paragraphs = resolved.positions.map(
    (position) => story.items[position],
  );
  const offsets = wordSelectionPartOffsets(selection);
  const built = await buildWordSelectionRanges(
    context,
    paragraphs.map((paragraph, i) => {
      const { rangeText, kept } = selection.paragraphs[i];
      // A paragraph that keeps items is written whole as OOXML; no part range is needed.
      return kept
        ? { paragraph, rangeText, start: 0, end: rangeText.length }
        : {
            paragraph,
            rangeText,
            start: offsets[i].start,
            end: offsets[i].end,
          };
    }),
    support,
  );
  if ("refused" in built) return built;
  return {
    paragraphs,
    positions: resolved.positions,
    story,
    parts: built.parts,
  };
}

export interface WordTargetVerification {
  paragraphs: {
    text: string;
    rangeText: string;
    style: string;
    tableNestingLevel: number;
    /** The built part range's text; null where the paragraph itself is the target. */
    partText: string | null;
    /** Read for a paragraph captured in a table cell only; null elsewhere. */
    cellTable: WordCellTable | null;
    checks: WordParagraphSpanChecks;
  }[];
  trackingMode: string;
}

/**
 * The last read before a write: everything the write depends on, in one sync. Office.js cannot
 * make a write depend on values read in its own sync, so this sync comes right before it.
 */
export function queueTargetVerification(
  context: Word.RequestContext,
  parts: readonly WordSelectionRangePart[],
  captured: readonly { tableNestingLevel: number }[],
  support: WordSelectionSupport,
): () => WordTargetVerification {
  context.document.load("changeTrackingMode");
  const queued = parts.map((part, i) => {
    const { paragraph } = part;
    paragraph.load("text,style,tableNestingLevel");
    if (part.kind === "part") part.range.load("text");
    return {
      part,
      cellTable:
        captured[i].tableNestingLevel > 0
          ? queueWordCellTable(paragraph)
          : null,
      text: paragraph.getText(WORD_SELECTION_TEXT_OPTIONS),
      checks: queueParagraphSpanChecks(
        paragraph,
        captured[i].tableNestingLevel > 0,
        support.listsBookmarks,
      ),
    };
  });
  return () => ({
    paragraphs: queued.map(({ part, cellTable, text, checks }) => ({
      text: text.value,
      rangeText: part.paragraph.text,
      style: part.paragraph.style,
      tableNestingLevel: part.paragraph.tableNestingLevel,
      partText: part.kind === "part" ? part.range.text : null,
      cellTable: cellTable?.() ?? null,
      checks: checks(),
    })),
    trackingMode: String(context.document.changeTrackingMode),
  });
}

/** A final read with its comment anchors settled by `around` (queueWordCommentAnchors). */
export function settleTargetVerification(
  verification: WordTargetVerification,
  around: readonly ReadonlySet<string>[],
): WordTargetVerification {
  return {
    ...verification,
    paragraphs: verification.paragraphs.map((live, i) => ({
      ...live,
      checks: settledChecks(live.checks, around[i]),
    })),
  };
}

export type WordTargetCheck =
  | {
      /** Null for a paragraph that keeps items: its OOXML keeps its formatting as it is. */
      formats: (WordSelectionTargetFormat | null)[];
      trackingOn: boolean;
      /** Each covered paragraph's own OOXML, for Undo. */
      backups: string[];
      /** Per covered paragraph, its table where it is in a cell. */
      cellTables: (WordCellTable | null)[];
    }
  | { refused: WordSelectionReplaceCode };

/** The pure checks between the last read and the write. */
export function checkTargetVerification(
  selection: WordSelectionSnapshot,
  verification: WordTargetVerification,
  support: WordSelectionSupport,
): WordTargetCheck {
  const { paragraphs, trackingMode } = verification;
  if (paragraphs.length !== selection.paragraphs.length)
    return { refused: "TARGET_TEXT_MISMATCH" };
  const unchanged = paragraphs.every((live, i) => {
    const captured = selection.paragraphs[i];
    return (
      live.text === captured.text &&
      live.rangeText === captured.rangeText &&
      live.style === captured.styleName &&
      live.tableNestingLevel === captured.tableNestingLevel
    );
  });
  if (!unchanged) return { refused: "TARGET_TEXT_MISMATCH" };
  if (trackingMode !== "Off" && !/^Track/.test(trackingMode))
    return { refused: "UNSUPPORTED_CONTENT" };
  const keeps = selection.paragraphs.some((p) => p.kept);
  // Word would redline a paragraph written as OOXML whole, its items inside the revision.
  if (keeps && trackingMode !== "Off") return { refused: "TRACKED_ITEMS" };
  // Emphasis a rewrite would lose, though the card did not say so at Send: it was added since.
  const unannounced = (evaluated: { flattensEmphasis: boolean }) =>
    evaluated.flattensEmphasis && !selection.flattensEmphasis;
  const offsets = wordSelectionPartOffsets(selection);
  const expected = wordSelectionParts(selection);
  if (
    paragraphs.some(
      (live, i) =>
        !selection.paragraphs[i].kept &&
        !offsets[i].whole &&
        live.partText !== expected[i],
    )
  )
    return { refused: "TARGET_RANGE_UNPROVEN" };
  const formats: (WordSelectionTargetFormat | null)[] = [];
  for (const [i, live] of paragraphs.entries()) {
    const { start, end, whole } = offsets[i];
    const { kept, formats: spans } = selection.paragraphs[i];
    // The part with its markers as it was sent, format spans included, which their emphasis
    // changed since would move or change.
    if (kept || spans) {
      const marked = markWordParagraphOoxml(
        live.checks.ooxml,
        live.rangeText,
        start,
        end,
        firstMarkerNumber(selection.paragraphs[i]),
        { items: !!kept, formats: !!spans },
      );
      if (
        !marked ||
        marked.text !== (kept?.text ?? spans?.text) ||
        JSON.stringify(marked.formats ?? []) !==
          JSON.stringify(spans?.spans ?? [])
      )
        return { refused: "TARGET_TEXT_MISMATCH" };
    }
    if (kept) {
      const evaluated = evaluateKeptParagraph(
        live.checks,
        { start, end, rangeText: live.rangeText },
        !!spans,
      );
      if (
        wordSelectionHazardReason(evaluated.hazards, [], support) ||
        unannounced(evaluated)
      )
        return { refused: "UNSUPPORTED_CONTENT" };
      formats.push(null);
      continue;
    }
    const evaluated = evaluateParagraphSpan(
      live.checks,
      live.style,
      support,
      whole ? undefined : { start, end, rangeText: live.rangeText },
      !!spans,
    );
    if (
      wordSelectionHazardReason(evaluated.hazards, [live.text], support) ||
      !evaluated.styleFontResolved ||
      !evaluated.format ||
      unannounced(evaluated)
    )
      return { refused: "UNSUPPORTED_CONTENT" };
    formats.push(evaluated.format);
  }
  return {
    formats,
    trackingOn: trackingMode !== "Off",
    backups: paragraphs.map((live) => live.checks.ooxml),
    cellTables: paragraphs.map((live) => live.cellTable),
  };
}

/** The number a paragraph's first marker has, from which marking its part again numbers on. */
function firstMarkerNumber(paragraph: WordSelectionParagraph): number {
  const numbers = [
    ...(paragraph.kept?.markers ?? []).map((marker) => marker.number),
    ...(paragraph.formats?.spans ?? []).map((span) => span.number),
  ];
  return numbers.length ? Math.min(...numbers) : 1;
}

export type WordSelectionShowResult =
  | "selected"
  | "changed"
  | "identity-mismatch"
  | "unavailable";

async function showResolved(
  resolve: (context: Word.RequestContext) => Promise<Word.Range | null>,
): Promise<WordSelectionShowResult> {
  const result = await runWordGuarded(
    async (context, guard) => {
      const range = await resolve(context);
      if (!range) return "changed" as const;
      guard.beforeSelect();
      await selectWordRange(context, range);
      return "selected" as const;
    },
    { timeoutMs: WORD_SELECTION_SHOW_TIMEOUT_MS },
  );
  return result.outcome === "ok" && result.value ? result.value : "unavailable";
}

const identityMatches = (
  expected: string,
  current: string | null | undefined,
): boolean => !!current && expected === current;

/**
 * A part's search hit, or one paragraph's own Content range: the selects Word for the web leaves
 * unchanged (preflight impact 1, ERMAIN-932).
 */
const rangeOf = (part: WordSelectionRangePart): Word.Range =>
  part.kind === "part" ? part.range : part.paragraph.getRange("Content");

/**
 * Desktop selects from the first paragraph's part to the last's. Word for the web rewrites the end
 * paragraphs of a range it selects across paragraphs (ERMAIN-932), so callers pass no last there
 * and the first stands in.
 */
const spanOf = (first: Word.Range, last: Word.Range | null) =>
  last ? first.expandTo(last) : first;

/** Selects the passage captured at Send, once it is proven unchanged. */
export function showWordSelection(
  selection: WordSelectionSnapshot,
  identity: string,
  currentIdentity: string | null | undefined,
  /** Tests only: the shapes the proof accepts. */
  enabledShapes?: ReadonlySet<WordSelectionShape>,
): Promise<WordSelectionShowResult> {
  if (!identityMatches(identity, currentIdentity))
    return Promise.resolve("identity-mismatch");
  return showResolved(async (context) => {
    const proof = await proveWordSelectionTarget(
      context,
      selection,
      currentWordSelectionSupport(),
      enabledShapes,
    );
    if ("refused" in proof) return null;
    const { parts } = proof;
    return spanOf(
      rangeOf(parts[0]),
      parts.length > 1 && selectsAcrossParagraphs()
        ? rangeOf(parts[parts.length - 1])
        : null,
    );
  });
}

/** What a Replace left: the written paragraphs with their text then, and their neighbours. */
export interface WordSelectionWritten {
  anchor: WordParagraphAnchor;
  /** paragraph.text right after the write. */
  rangeTexts: readonly string[];
  /** Where the written text starts in the first paragraph's rangeText. */
  startOffset: number;
  /** Where it ends in the last paragraph's rangeText, exclusive. */
  endOffset: number;
}

/**
 * Selects the passage a Replace wrote, while its paragraphs still hold the written text. Where
 * Word's search cannot pinpoint a written part again, its paragraph stands in; only a write needs
 * the part proven.
 */
export function showWrittenWordSelection(
  written: WordSelectionWritten,
  identity: string,
  currentIdentity: string | null | undefined,
): Promise<WordSelectionShowResult> {
  if (!identityMatches(identity, currentIdentity))
    return Promise.resolve("identity-mismatch");
  return showResolved(async (context) => {
    const story = await readWordStory(context);
    const resolved = resolveWordParagraphs(written.anchor, story.entries);
    if ("refused" in resolved) return null;
    const { positions } = resolved;
    if (
      positions.length !== written.rangeTexts.length ||
      positions.some(
        (position, i) => story.rangeTexts[position] !== written.rangeTexts[i],
      )
    )
      return null;
    const offsets = wordSelectionPartOffsets({
      paragraphs: written.rangeTexts.map((rangeText) => ({ rangeText })),
      startOffset: written.startOffset,
      endOffset: written.endOffset,
    });
    const support = currentWordSelectionSupport();
    const writtenRange = async (i: number) => {
      const paragraph = story.items[positions[i]];
      const built = await buildWordSelectionRanges(
        context,
        [
          {
            paragraph,
            rangeText: written.rangeTexts[i],
            start: offsets[i].start,
            end: offsets[i].end,
          },
        ],
        support,
      );
      return "refused" in built
        ? paragraph.getRange("Content")
        : rangeOf(built.parts[0]);
    };
    const first = await writtenRange(0);
    const last =
      positions.length > 1 && selectsAcrossParagraphs()
        ? await writtenRange(positions.length - 1)
        : null;
    return spanOf(first, last);
  });
}
