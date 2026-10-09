import { wordParagraphId } from "./wordParagraphIds";
import { resolveWordParagraphs } from "./wordParagraphResolver";
import {
  selectWordRange,
  WORD_SELECTION_TEXT_OPTIONS,
} from "./wordReviewLocation";
import { runWordGuarded } from "./wordRunGuard";
import {
  resolveWordSelection,
  WORD_SELECTION_REPLACE_SHAPES,
  wordSelectionHazardReason,
  wordSelectionPartOffsets,
  wordSelectionParts,
} from "./wordSelectionAnchor";
import {
  WORD_SELECTION_TOGGLE_PROPERTIES,
  wordSelectionEdgeOnly,
  wordSelectionTargetFormat,
} from "./wordSelectionFormatting";
import { buildWordSelectionRanges } from "./wordSelectionRange";
import {
  scanWordSelectionSpan,
  wordSelectionStyleToggles,
} from "./wordSelectionSpan";
import { currentWordSelectionSupport } from "./wordSelectionSupport";

import type {
  WordParagraphAnchor,
  WordParagraphEntry,
} from "./wordParagraphResolver";
import type {
  WordSelectionHazards,
  WordSelectionReplaceCode,
  WordSelectionShape,
  WordSelectionSnapshot,
} from "./wordSelectionAnchor";
import type { WordSelectionTargetFormat } from "./wordSelectionFormatting";
import type { WordSelectionRangePart } from "./wordSelectionRange";
import type { WordSelectionSpanSlice } from "./wordSelectionSpan";
import type { WordSelectionSupport } from "./wordSelectionSupport";

export const WORD_SELECTION_SHOW_TIMEOUT_MS = 10_000;

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
}

/**
 * A whole paragraph's own OOXML, which is both the hazard scan's input and the Undo backup, and the
 * content controls and fields the OOXML can miss around it (PF3). All are reads Word for the web
 * leaves the document unchanged by: no range inside the paragraph is built.
 */
export function queueParagraphSpanChecks(
  paragraph: Word.Paragraph,
): () => WordParagraphSpanChecks {
  const ooxml = paragraph.getOoxml();
  const controls = paragraph.contentControls;
  controls.load("items/id");
  const parent = paragraph.parentContentControlOrNullObject;
  parent.load("id");
  const fields = paragraph.fields;
  fields.load("items/code");
  // Includes a revision of the paragraph mark, which the web's paragraph OOXML does not show.
  const revisions = paragraph.getTrackedChanges();
  revisions.load("items/type");
  return () => ({
    ooxml: ooxml.value,
    objectHazards: {
      ...(controls.items.length > 0 || !parent.isNullObject
        ? { contentControl: true }
        : {}),
      ...(fields.items.length > 0 ? { field: true } : {}),
      ...(revisions.items.length > 0 ? { trackedChange: true } : {}),
    },
  });
}

/** The sections wordParagraphEndsSection reads, loaded by the caller's next sync. */
export function queueWordSections(
  context: Word.RequestContext,
): Word.SectionCollection {
  const sections = context.document.sections;
  sections.load("items");
  return sections;
}

/**
 * True when the paragraph ends a section other than the last, so its mark holds the section break:
 * an Undo, which restores the paragraph from its OOXML, could move or drop it. Word for Mac's
 * paragraph OOXML leaves that sectPr out, so it is found through the sections instead. Only a
 * document with several sections needs another sync.
 */
export async function wordParagraphEndsSection(
  context: Word.RequestContext,
  sections: Word.SectionCollection,
  paragraph: Word.Paragraph,
): Promise<boolean> {
  if (sections.items.length < 2) return false;
  const whole = paragraph.getRange("Whole");
  const relations = sections.items
    .slice(0, -1)
    .map((section) =>
      section.body.paragraphs
        .getLast()
        .getRange("Whole")
        .compareLocationWith(whole),
    );
  await context.sync();
  return relations.some((relation) => relation.value === "Equal");
}

export interface WordParagraphSpanEvaluation {
  hazards: WordSelectionHazards;
  styleFontResolved: boolean;
  /** Null when the style font was needed but not found. */
  format: WordSelectionTargetFormat | null;
}

/**
 * The rewrite checks of one paragraph and the font its rewrite gets. The hazards always cover the
 * whole paragraph; with a slice, the font comes from the slice and the runs next to it.
 */
export function evaluateParagraphSpan(
  checks: WordParagraphSpanChecks,
  styleName: string,
  support: WordSelectionSupport,
  slice?: WordSelectionSpanSlice,
): WordParagraphSpanEvaluation {
  const scan = scanWordSelectionSpan(checks.ooxml, slice);
  const hazards = { ...scan.hazards, ...checks.objectHazards };
  const needsStyle = WORD_SELECTION_TOGGLE_PROPERTIES.some(
    (property) =>
      scan.format[property]?.state === "mixed" ||
      wordSelectionEdgeOnly(scan.format, scan.edges, property),
  );
  const style = needsStyle
    ? wordSelectionStyleToggles(checks.ooxml, styleName)
    : {};
  if (!style || support.styleFontSource === null)
    return { hazards, styleFontResolved: false, format: null };
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

/** The shapes whose target this proof can build. */
const PROVABLE_SHAPES: ReadonlySet<WordSelectionShape> = new Set([
  "paragraph",
  "inline",
]);

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
    !PROVABLE_SHAPES.has(selection.shape) ||
    selection.paragraphs.length !== 1
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
    paragraphs.map((paragraph, i) => ({
      paragraph,
      rangeText: selection.paragraphs[i].rangeText,
      start: offsets[i].start,
      end: offsets[i].end,
      ...(i === 0 ? { occurrence: selection.occurrence } : {}),
    })),
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
): () => WordTargetVerification {
  context.document.load("changeTrackingMode");
  const queued = parts.map((part) => {
    const { paragraph } = part;
    paragraph.load("text,style,tableNestingLevel");
    if (part.kind === "part") part.range.load("text");
    return {
      part,
      text: paragraph.getText(WORD_SELECTION_TEXT_OPTIONS),
      checks: queueParagraphSpanChecks(paragraph),
    };
  });
  return () => ({
    paragraphs: queued.map(({ part, text, checks }) => ({
      text: text.value,
      rangeText: part.paragraph.text,
      style: part.paragraph.style,
      tableNestingLevel: part.paragraph.tableNestingLevel,
      partText: part.kind === "part" ? part.range.text : null,
      checks: checks(),
    })),
    trackingMode: String(context.document.changeTrackingMode),
  });
}

export type WordTargetCheck =
  | {
      formats: WordSelectionTargetFormat[];
      trackingOn: boolean;
      /** Each covered paragraph's own OOXML, for Undo. */
      backups: string[];
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
  const offsets = wordSelectionPartOffsets(selection);
  const expected = wordSelectionParts(selection);
  if (
    paragraphs.some(
      (live, i) => !offsets[i].whole && live.partText !== expected[i],
    )
  )
    return { refused: "TARGET_RANGE_UNPROVEN" };
  const formats: WordSelectionTargetFormat[] = [];
  for (const [i, live] of paragraphs.entries()) {
    const { start, end, whole } = offsets[i];
    const evaluated = evaluateParagraphSpan(
      live.checks,
      live.style,
      support,
      whole ? undefined : { start, end, rangeText: live.rangeText },
    );
    if (
      wordSelectionHazardReason(evaluated.hazards, [live.text], support) ||
      !evaluated.styleFontResolved ||
      !evaluated.format
    )
      return { refused: "UNSUPPORTED_CONTENT" };
    formats.push(evaluated.format);
  }
  return {
    formats,
    trackingOn: trackingMode !== "Off",
    backups: paragraphs.map((live) => live.checks.ooxml),
  };
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
    return "refused" in proof ? null : rangeOf(proof.parts[0]);
  });
}

/** What a Replace left: the written paragraph with its text then, and its neighbours. */
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
 * Selects the passage a Replace wrote, while its paragraph still holds the written text. Where
 * Word's search cannot pinpoint the written part again, the paragraph stands in; only a write
 * needs the part proven.
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
    const position = resolved.positions[0];
    const rangeText = written.rangeTexts[0];
    if (story.rangeTexts[position] !== rangeText) return null;
    const paragraph = story.items[position];
    const built = await buildWordSelectionRanges(
      context,
      [
        {
          paragraph,
          rangeText,
          start: written.startOffset,
          end: written.endOffset,
        },
      ],
      currentWordSelectionSupport(),
    );
    return "refused" in built
      ? paragraph.getRange("Content")
      : rangeOf(built.parts[0]);
  });
}
