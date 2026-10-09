import { wordHostPlatform } from "./wordHostPlatform";
import { wordParagraphId } from "./wordParagraphIds";
import { wordParagraphAnchor } from "./wordParagraphResolver";
import { WORD_SELECTION_TEXT_OPTIONS } from "./wordReviewLocation";
import { runWordGuarded } from "./wordRunGuard";
import { buildWordSelectionSnapshot } from "./wordSelectionAnchor";
import { wordSelectionSupport } from "./wordSelectionSupport";

import type { WordParagraphEntry } from "./wordParagraphResolver";
import type {
  WordSelectionFacts,
  WordSelectionOrigin,
  WordSelectionParagraphFacts,
  WordSelectionShape,
  WordSelectionSnapshot,
  WordSelectionStory,
} from "./wordSelectionAnchor";
import type { WordSelectionSupport } from "./wordSelectionSupport";

export const WORD_SELECTION_DESCRIBE_TIMEOUT_MS = 5_000;
export const WORD_SELECTION_CAPTURE_TIMEOUT_MS = 15_000;

/** Kept for the chip, which shows less. */
const PREVIEW_MAX_CHARACTERS = 400;
/** Desktop search throws from 300 characters (PF5). */
const SEARCH_MAX_CHARACTERS = 255;

/** What the composer chip shows of the live selection. */
export interface WordSelectionPreview {
  /**
   * Changes when the selected text or the text of its paragraphs changes. Equal passages within one
   * paragraph share a key, because the light read does not tell them apart.
   */
  key: string;
  /** What would be sent, one line per paragraph, cut for display. */
  text: string;
  paragraphCount: number;
  shape: WordSelectionShape;
  story: WordSelectionStory;
  /** Too long to be sent whole. */
  truncated: boolean;
}

/** A failed read is not "nothing selected": the caller keeps what it had. */
export type WordSelectionRead<T> =
  | { status: "ok"; value: T | null }
  | { status: "failed" };

export function currentWordSelectionSupport(): WordSelectionSupport {
  const requirements = globalThis.Office?.context?.requirements;
  return wordSelectionSupport(
    (name, version) => requirements?.isSetSupported(name, version) ?? false,
    wordHostPlatform(),
  );
}

interface SelectionRead {
  selection: Word.Range;
  text: string;
  /** getReviewedText("Current"), read in the same sync where WordApi 1.4 is available. */
  reviewedText?: string;
  isEmpty: boolean;
  storyType: string;
  objectOnly: boolean;
  paragraphs: Word.Paragraph[];
}

/** The body types around the selection, innermost first, up to the first that is not a table cell. */
async function storyTypeOf(
  context: Word.RequestContext,
  body: Word.Body,
): Promise<string> {
  let current = body;
  for (;;) {
    if (current.type !== "TableCell") return current.type;
    const parent = current.parentBodyOrNullObject;
    parent.load("type");
    await context.sync();
    if (parent.isNullObject) return current.type;
    current = parent;
  }
}

/**
 * Only the user's selection and its paragraphs are read. Word for the web rewrites runs when an
 * expandTo range inside a paragraph is read (preflight impact 1), so no range is built here.
 */
async function readSelection(
  context: Word.RequestContext,
  paragraphProperties: string,
  withReviewedText = false,
): Promise<SelectionRead> {
  const selection = context.document.getSelection();
  selection.load("text,isEmpty");
  const reviewed = withReviewedText
    ? selection.getReviewedText("Current")
    : null;
  const body = selection.parentBody;
  body.load("type");
  const paragraphs = selection.paragraphs;
  paragraphs.load(paragraphProperties);
  const pictures = selection.inlinePictures;
  pictures.load("items");
  await context.sync();
  return {
    selection,
    text: selection.text,
    ...(reviewed ? { reviewedText: reviewed.value } : {}),
    isEmpty: selection.isEmpty,
    storyType: await storyTypeOf(context, body),
    // A selected picture reads as "" on desktop and " " on the web (SV2:133).
    objectOnly:
      !selection.isEmpty &&
      pictures.items.length > 0 &&
      selection.text.trim() === "",
    paragraphs: paragraphs.items,
  };
}

interface TableFacts {
  tables: WordSelectionFacts["tables"];
  /** Per selection paragraph; null outside tables. */
  cells: (string | null)[];
}

const COVERED = new Set(["Equal", "Inside", "InsideStart", "InsideEnd"]);

/** Queued only; resolves once the caller has synced. */
function queueTableFacts(read: SelectionRead): (() => TableFacts) | null {
  const inTable = read.paragraphs.map((p) => p.tableNestingLevel > 0);
  if (!inTable.some(Boolean)) return null;
  const queued = read.paragraphs.map((p, i) => {
    if (!inTable[i]) return null;
    const cell = p.parentTableCellOrNullObject;
    cell.load("rowIndex,cellIndex");
    const relation = cell.parentTable
      .getRange("Whole")
      .compareLocationWith(read.selection);
    return { cell, relation, nesting: p.tableNestingLevel };
  });
  return () => {
    const relations = queued.flatMap((q) => (q ? [q.relation.value] : []));
    return {
      tables: relations.every((r) => COVERED.has(r)) ? "whole" : "partial",
      cells: queued.map((q) =>
        q && !q.cell.isNullObject
          ? `${q.nesting}:${q.cell.rowIndex}:${q.cell.cellIndex}`
          : null,
      ),
    };
  };
}

/** Every start of `needle`, overlapping ones included. */
function startsOf(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + 1)
  )
    found.push(at);
  return found;
}

/** Left to right without overlap, as Word's search reports matches (PF5). */
function searchStartsOf(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  )
    found.push(at);
  return found;
}

type SpanOffsets =
  | { start: number; end: number }
  /** The covered text occurs more than once in its paragraph; Word's search must tell which. */
  | { part: string; candidates: number[] }
  | null;

/**
 * The span's offsets into its paragraphs' text, from the selection text alone. Paragraphs are
 * separated by \r in Range.text on every host; a selection that includes its last paragraph mark
 * (the web's whole-paragraph selection, desktop's triple-click) ends with one more.
 */
function spanOffsets(
  selectionText: string,
  rangeTexts: readonly string[],
): SpanOffsets {
  if (rangeTexts.length === 0) return null;
  if (rangeTexts.length === 1) {
    const [text] = rangeTexts;
    const trimmed = selectionText.replace(/(\r\n|\r|\n|\t)$/, "");
    if (trimmed === "") return { start: text.length, end: text.length };
    for (const part of new Set([selectionText, trimmed])) {
      const starts = startsOf(text, part);
      if (starts.length === 1)
        return { start: starts[0], end: starts[0] + part.length };
      if (starts.length > 1) return { part, candidates: starts };
    }
    return null;
  }
  const parts = selectionText.split("\r");
  if (parts.length === rangeTexts.length + 1 && parts[parts.length - 1] === "")
    parts.pop();
  if (parts.length !== rangeTexts.length) return null;
  const last = parts.length - 1;
  const fits = parts.every((part, i) =>
    i === 0
      ? rangeTexts[i].endsWith(part)
      : i === last
        ? rangeTexts[i].startsWith(part)
        : rangeTexts[i] === part,
  );
  return fits
    ? {
        start: rangeTexts[0].length - parts[0].length,
        end: parts[last].length,
      }
    : null;
}

function searchable(part: string): boolean {
  // Word's search reads ^ as a special-character code and cannot match control characters.
  return (
    part.length <= SEARCH_MAX_CHARACTERS && !/[\^\u0000-\u001F]/.test(part)
  );
}

function baseFacts(
  read: SelectionRead,
  tables: TableFacts | null,
): Omit<WordSelectionFacts, "paragraphs" | "startOffset" | "endOffset"> {
  return {
    isEmpty: read.isEmpty,
    storyType: read.storyType,
    selectionText: read.text,
    objectOnly: read.objectOnly,
    tables: tables?.tables ?? "none",
    anchor: null,
    hazards: {},
    pictureBeforeSpan: false,
    styleFontResolved: false,
    spanChecked: false,
  };
}

function lightFacts(
  read: SelectionRead,
  tables: TableFacts | null,
): WordSelectionFacts {
  const rangeTexts = read.paragraphs.map((p) => p.text);
  const offsets = spanOffsets(read.text, rangeTexts);
  // Any occurrence shows the same text; only the capture at Send must know which one it is.
  const span =
    offsets && "candidates" in offsets
      ? {
          start: offsets.candidates[0],
          end: offsets.candidates[0] + offsets.part.length,
        }
      : offsets;
  return {
    ...baseFacts(read, tables),
    paragraphs: read.paragraphs.map((p, i) => ({
      id: null,
      // Without getText, paragraph.text minus the web's comment marks stands in for the identity text.
      text: p.text.replace(/\u0005/g, ""),
      rangeText: p.text,
      index: -1,
      styleName: "",
      tableNestingLevel: p.tableNestingLevel,
      cell: tables?.cells[i] ?? null,
    })),
    startOffset: span?.start ?? -1,
    endOffset: span?.end ?? -1,
    ...(read.reviewedText === undefined
      ? {}
      : { reviewedText: read.reviewedText }),
  };
}

function previewOf(
  snapshot: WordSelectionSnapshot,
  facts: WordSelectionFacts,
): WordSelectionPreview {
  return {
    key: JSON.stringify([
      facts.storyType,
      facts.paragraphs.map((p) => p.rangeText),
      facts.startOffset,
      facts.endOffset,
      facts.selectionText,
    ]),
    text: Array.from(snapshot.selectedText)
      .slice(0, PREVIEW_MAX_CHARACTERS)
      .join(""),
    paragraphCount: snapshot.paragraphCount,
    shape: snapshot.shape,
    story: snapshot.story,
    truncated: snapshot.truncated,
  };
}

/**
 * The light read behind the composer chip, run after selection events. It reads the selection and
 * its paragraphs only, never the body, and never resolves which of several equal passages in a
 * paragraph is selected. Null when the selection offers no chip.
 */
export async function describeWordSelection(
  timeoutMs = WORD_SELECTION_DESCRIBE_TIMEOUT_MS,
): Promise<WordSelectionRead<WordSelectionPreview>> {
  const support = currentWordSelectionSupport();
  const result = await runWordGuarded(
    async (context) => {
      const read = await readSelection(
        context,
        "items/text,items/tableNestingLevel",
        support.trackingMode,
      );
      const tables = queueTableFacts(read);
      if (tables) await context.sync();
      const facts = lightFacts(read, tables?.() ?? null);
      const snapshot = buildWordSelectionSnapshot(facts, support, "user");
      return snapshot ? previewOf(snapshot, facts) : null;
    },
    { timeoutMs },
  );
  return result.outcome === "ok"
    ? { status: "ok", value: result.value ?? null }
    : { status: "failed" };
}

interface BodyRead {
  entries: WordParagraphEntry[];
  /** Per selection paragraph, null where it could not be placed in the body. */
  positions: (number | null)[];
}

/**
 * Places the selection paragraphs in the body: by paragraph ID where every one has an ID that
 * occurs once, otherwise by comparing each with the body paragraphs of the same text (PF1).
 */
async function readBody(
  context: Word.RequestContext,
  read: SelectionRead,
): Promise<BodyRead> {
  const body = context.document.body.paragraphs;
  body.load("items/uniqueLocalId,items/text");
  await context.sync();
  const texts = body.items.map((p) => p.getText(WORD_SELECTION_TEXT_OPTIONS));
  const ids = body.items.map((p) => wordParagraphId(p.uniqueLocalId));
  const idCounts = new Map<string, number>();
  for (const id of ids) if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  const selectedIds = read.paragraphs.map((p) =>
    wordParagraphId(p.uniqueLocalId),
  );
  const byId = selectedIds.every((id) => id && idCounts.get(id) === 1);
  const compared = byId
    ? []
    : read.paragraphs.map((p) => {
        const whole = p.getRange("Whole");
        return body.items.flatMap((candidate, j) =>
          candidate.text === p.text
            ? [
                {
                  j,
                  relation: whole.compareLocationWith(
                    candidate.getRange("Whole"),
                  ),
                },
              ]
            : [],
        );
      });
  await context.sync();
  const entries = body.items.map((_, j) => ({
    id: ids[j],
    text: texts[j].value,
  }));
  const positions = byId
    ? selectedIds.map((id) => ids.indexOf(id))
    : compared.map((candidates) => {
        const equal = candidates.filter((c) => c.relation.value === "Equal");
        return equal.length === 1 ? equal[0].j : null;
      });
  return { entries, positions };
}

function consecutive(
  positions: readonly (number | null)[],
): positions is number[] {
  return positions.every(
    (position, i) =>
      position !== null && (i === 0 || position === positions[0]! + i),
  );
}

/**
 * The Send-time read: the selection's paragraphs with their identity texts, the span's offsets
 * and, in the main story, the anchor a later Replace proves. Every read is one Word for the web
 * measured as leaving the document unchanged (preflight impact 1): a selected passage that occurs
 * more than once in its paragraph is told apart by search hits compared with the selection, not
 * by prefix ranges. The span's hazard scan and style font are rewrite checks and are not read
 * here, so the snapshot is context only. A timeout or error never yields a partial snapshot.
 */
export async function captureWordSelection(
  origin: WordSelectionOrigin = "user",
  timeoutMs = WORD_SELECTION_CAPTURE_TIMEOUT_MS,
): Promise<WordSelectionRead<WordSelectionSnapshot>> {
  const support = currentWordSelectionSupport();
  const result = await runWordGuarded(
    async (context) => {
      if (!support.canRewrite) {
        const read = await readSelection(
          context,
          "items/text,items/tableNestingLevel",
          support.trackingMode,
        );
        const tables = queueTableFacts(read);
        if (tables) await context.sync();
        return buildWordSelectionSnapshot(
          lightFacts(read, tables?.() ?? null),
          support,
          origin,
        );
      }

      const read = await readSelection(
        context,
        "items/text,items/tableNestingLevel,items/uniqueLocalId,items/style",
      );
      const tables = queueTableFacts(read);
      const identities = read.paragraphs.map((p) =>
        p.getText(WORD_SELECTION_TEXT_OPTIONS),
      );
      await context.sync();
      const tableFacts = tables?.() ?? null;
      const main = read.storyType === "MainDoc";
      const body = main ? await readBody(context, read) : null;

      const rangeTexts = read.paragraphs.map((p) => p.text);
      let offsets = spanOffsets(read.text, rangeTexts);
      let hits: Word.RangeCollection | null = null;
      if (offsets && "candidates" in offsets && searchable(offsets.part)) {
        hits = read.paragraphs[0].search(offsets.part, { matchCase: true });
        hits.load("items");
      }
      if (hits) await context.sync();
      if (offsets && "candidates" in offsets) {
        const searchStarts = searchStartsOf(rangeTexts[0], offsets.part);
        const relations = hits?.items.map((hit) =>
          hit.compareLocationWith(read.selection),
        );
        if (relations?.length) await context.sync();
        const equal = relations?.findIndex((r) => r.value === "Equal") ?? -1;
        // Word's hits must line up with the paragraph text's matches to give an offset.
        offsets =
          equal >= 0 && relations!.length === searchStarts.length
            ? {
                start: searchStarts[equal],
                end: searchStarts[equal] + offsets.part.length,
              }
            : null;
      }
      const span = offsets;

      const positions = body?.positions ?? [];
      const placed = main && positions.length > 0 && consecutive(positions);
      const paragraphs = read.paragraphs.map(
        (p, i): WordSelectionParagraphFacts => {
          const position = placed ? positions[i] : null;
          const entry = position === null ? null : body!.entries[position];
          return {
            id: entry ? entry.id : wordParagraphId(p.uniqueLocalId),
            text: entry ? entry.text : identities[i].value,
            rangeText: p.text,
            index: position ?? -1,
            styleName: p.style,
            tableNestingLevel: p.tableNestingLevel,
            cell: tableFacts?.cells[i] ?? null,
          };
        },
      );
      // paragraph.text on PC and the web holds tracked deletions that getText leaves out.
      const hidesText = paragraphs.some(
        (p) => p.rangeText.replace(/\u0005/g, "") !== p.text.replace(/\r$/, ""),
      );
      const reviewed =
        (hidesText || !span) && support.trackingMode
          ? read.selection.getReviewedText("Current")
          : null;
      if (reviewed) await context.sync();

      const facts: WordSelectionFacts = {
        ...baseFacts(read, tableFacts),
        paragraphs,
        startOffset: span?.start ?? -1,
        endOffset: span?.end ?? -1,
        anchor:
          placed && body
            ? wordParagraphAnchor(
                body.entries,
                positions[0],
                positions[positions.length - 1],
              )
            : null,
        ...(reviewed ? { reviewedText: reviewed.value } : {}),
      };
      return buildWordSelectionSnapshot(facts, support, origin);
    },
    { timeoutMs },
  );
  return result.outcome === "ok"
    ? { status: "ok", value: result.value ?? null }
    : { status: "failed" };
}
