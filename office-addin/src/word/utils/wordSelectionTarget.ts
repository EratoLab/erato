import { wordParagraphId } from "./wordParagraphIds";
import { resolveWordParagraphs } from "./wordParagraphResolver";
import {
  selectWordRange,
  WORD_SELECTION_TEXT_OPTIONS,
} from "./wordReviewLocation";
import { runWordGuarded } from "./wordRunGuard";
import { resolveWordSelection } from "./wordSelectionAnchor";
import {
  WORD_SELECTION_TOGGLE_PROPERTIES,
  wordSelectionTargetFormat,
} from "./wordSelectionFormatting";
import {
  scanWordSelectionSpan,
  wordSelectionStyleToggles,
} from "./wordSelectionSpan";

import type {
  WordParagraphAnchor,
  WordParagraphEntry,
} from "./wordParagraphResolver";
import type {
  WordSelectionHazards,
  WordSelectionReplaceCode,
  WordSelectionSnapshot,
} from "./wordSelectionAnchor";
import type { WordSelectionTargetFormat } from "./wordSelectionFormatting";
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
  return () => ({
    ooxml: ooxml.value,
    objectHazards: {
      ...(controls.items.length > 0 || !parent.isNullObject
        ? { contentControl: true }
        : {}),
      ...(fields.items.length > 0 ? { field: true } : {}),
    },
  });
}

export interface WordParagraphSpanEvaluation {
  hazards: WordSelectionHazards;
  styleFontResolved: boolean;
  /** Null when the style font was needed but not found. */
  format: WordSelectionTargetFormat | null;
}

/** The rewrite checks of one whole paragraph and the font its rewrite gets. */
export function evaluateParagraphSpan(
  checks: WordParagraphSpanChecks,
  styleName: string,
  support: WordSelectionSupport,
): WordParagraphSpanEvaluation {
  const scan = scanWordSelectionSpan(checks.ooxml);
  const hazards = { ...scan.hazards, ...checks.objectHazards };
  const mixedToggle = WORD_SELECTION_TOGGLE_PROPERTIES.some(
    (property) => scan.format[property]?.state === "mixed",
  );
  const style = mixedToggle
    ? wordSelectionStyleToggles(checks.ooxml, styleName)
    : {};
  if (!style || support.styleFontSource === null)
    return { hazards, styleFontResolved: false, format: null };
  const format = wordSelectionTargetFormat(
    scan.format,
    style,
    support.bidiSetters,
  );
  return {
    hazards: format.unresolved.length
      ? { ...hazards, mixedFormatting: true }
      : hazards,
    styleFontResolved: true,
    format,
  };
}

const hasHazard = (hazards: WordSelectionHazards) =>
  Object.values(hazards).some(Boolean);

export type WordSelectionProof =
  | { paragraphs: Word.Paragraph[]; positions: number[]; story: WordStoryRead }
  | { refused: WordSelectionReplaceCode };

/**
 * Finds the captured paragraphs again: the resolver over the live body, then their offset text.
 * Only whole paragraphs can be targeted, so no range is built inside one.
 */
export async function proveWordSelectionTarget(
  context: Word.RequestContext,
  selection: WordSelectionSnapshot,
): Promise<WordSelectionProof> {
  if (selection.shape !== "paragraph" || selection.paragraphs.length !== 1)
    return { refused: "UNSUPPORTED_CONTENT" };
  const story = await readWordStory(context);
  const resolved = resolveWordSelection(
    selection,
    story.entries,
    story.rangeTexts,
  );
  if ("refused" in resolved) return resolved;
  return {
    paragraphs: resolved.positions.map((position) => story.items[position]),
    positions: resolved.positions,
    story,
  };
}

export interface WordTargetVerification {
  paragraphs: {
    text: string;
    rangeText: string;
    style: string;
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
  paragraphs: readonly Word.Paragraph[],
): () => WordTargetVerification {
  context.document.load("changeTrackingMode");
  const queued = paragraphs.map((paragraph) => {
    paragraph.load("text,style");
    return {
      paragraph,
      text: paragraph.getText(WORD_SELECTION_TEXT_OPTIONS),
      checks: queueParagraphSpanChecks(paragraph),
    };
  });
  return () => ({
    paragraphs: queued.map(({ paragraph, text, checks }) => ({
      text: text.value,
      rangeText: paragraph.text,
      style: paragraph.style,
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
      live.style === captured.styleName
    );
  });
  if (!unchanged) return { refused: "TARGET_TEXT_MISMATCH" };
  if (trackingMode !== "Off" && !/^Track/.test(trackingMode))
    return { refused: "UNSUPPORTED_CONTENT" };
  const formats: WordSelectionTargetFormat[] = [];
  for (const live of paragraphs) {
    const evaluated = evaluateParagraphSpan(live.checks, live.style, support);
    if (
      hasHazard(evaluated.hazards) ||
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
  resolve: (context: Word.RequestContext) => Promise<Word.Paragraph | null>,
): Promise<WordSelectionShowResult> {
  const result = await runWordGuarded(
    async (context, guard) => {
      const paragraph = await resolve(context);
      if (!paragraph) return "changed" as const;
      guard.beforeSelect();
      // One paragraph's own Content range: the select Word for the web leaves unchanged (ERMAIN-932).
      await selectWordRange(context, paragraph.getRange("Content"));
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

/** Selects the passage captured at Send, once it is proven unchanged. */
export function showWordSelection(
  selection: WordSelectionSnapshot,
  identity: string,
  currentIdentity: string | null | undefined,
): Promise<WordSelectionShowResult> {
  if (!identityMatches(identity, currentIdentity))
    return Promise.resolve("identity-mismatch");
  return showResolved(async (context) => {
    const proof = await proveWordSelectionTarget(context, selection);
    return "refused" in proof ? null : proof.paragraphs[0];
  });
}

/** What a Replace left: the written paragraph with its text then, and its neighbours. */
export interface WordSelectionWritten {
  anchor: WordParagraphAnchor;
  /** paragraph.text right after the write. */
  rangeTexts: readonly string[];
}

/** Selects the paragraph a Replace wrote, while it still holds the written text. */
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
    return story.rangeTexts[position] === written.rangeTexts[0]
      ? story.items[position]
      : null;
  });
}
