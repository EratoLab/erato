import type { WordDocumentCapture } from "./wordDocumentCapture";

/**
 * Pure parsing, source resolution and verification for erato-word-edits.
 * Rejection reasons are machine codes localized by the report card.
 */

/** One edit as the model writes it inside the fence. */
export interface WordEdit {
  /** 1-based paragraph ordinal, as the document text showed it. */
  paragraph: number;
  /** Last ordinal of a multi-paragraph span; absent for a single paragraph. */
  through?: number;
  /** Plain replacement text. A newline creates further paragraphs. */
  text: string;
}

/**
 * Return null for incomplete or invalid payloads, including streaming input.
 * Validate the entire edit list: dropping a malformed entry would apply only
 * part of the proposed instruction.
 */
export function parseWordEdits(content: string): WordEdit[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const rawEdits = (parsed as Record<string, unknown>).edits;
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    return null;
  }
  const edits: WordEdit[] = [];
  for (const raw of rawEdits) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return null;
    }
    const entry = raw as Record<string, unknown>;
    const paragraph = entry.paragraph;
    const text = entry.text;
    if (!Number.isInteger(paragraph) || (paragraph as number) < 1) {
      return null;
    }
    if (typeof text !== "string") {
      return null;
    }
    const through = entry.through;
    if (through !== undefined) {
      if (!Number.isInteger(through) || (through as number) < 1) {
        return null;
      }
      if ((through as number) < (paragraph as number)) {
        return null;
      }
    }
    edits.push({
      paragraph: paragraph as number,
      ...(through === undefined ? {} : { through: through as number }),
      text,
    });
  }
  return edits;
}

/** Why an edit will not be applied. Mapped to localized copy by the card. */
export type WordEditRejection =
  /** The ordinal was not rendered into the send, so the model never read it. */
  | "unknown-ordinal"
  /** The edit covers the paragraph the send could only include in part. */
  | "partial-ordinal"
  /** Two edits in the same batch cover the same paragraph. */
  | "overlapping"
  /** The paragraph's current text differs from what the model was shown. */
  | "changed";

export type WordEditStatus = "applied" | "failed" | WordEditRejection;

/** One line of the per-edit report. */
export interface WordEditOutcome {
  /**
   * Position in the model's list. The identity of an edit, because an ordinal
   * is NOT unique: a model may name paragraph 3 twice, and the second one is
   * rejected as overlapping — keying the report by ordinal would then let one
   * line inherit the other's verdict and report a skipped edit as applied.
   */
  index: number;
  /** First ordinal the edit targets. */
  paragraph: number;
  /** Last ordinal, when the edit spans a range. */
  through?: number;
  status: WordEditStatus;
  /** Short, code-point-safe excerpt of the replacement text. */
  excerpt: string;
}

/** An edit that survived resolution, with the paragraphs it maps to. */
export interface ResolvedWordEdit {
  /** Position in the model's list; carried so the report cannot misattribute. */
  index: number;
  paragraph: number;
  through?: number;
  text: string;
  /**
   * The targeted paragraphs in ascending document order. The FIRST one keeps
   * its style and receives the replacement; the rest are removed.
   */
  targets: { ordinal: number; uniqueLocalId: string; sentText: string }[];
  excerpt: string;
}

export interface WordEditPlan {
  /** Ordered ascending by start ordinal; the executor applies them reversed. */
  resolved: ResolvedWordEdit[];
  /** Edits rejected before any document read. */
  rejected: WordEditOutcome[];
}

const EXCERPT_CODE_POINTS = 60;

/**
 * A short, code-point-safe excerpt for the report. Cuts on a code point, never
 * inside a surrogate pair, so an emoji or an astral character never renders as
 * a replacement glyph. A replacement can be tens of kilobytes; the report line
 * must stay one line.
 */
export function editExcerpt(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  const points = [...collapsed];
  return points.length <= EXCERPT_CODE_POINTS
    ? collapsed
    : `${points.slice(0, EXCERPT_CODE_POINTS).join("")}…`;
}

/**
 * Phase one, part one: map each edit onto the paragraphs the send captured.
 * Writes nothing and reads nothing from the live document.
 *
 * Rejections here are final:
 * - an edit whose first or last ordinal is not in `capture.renderedOrdinals`
 *   is `unknown-ordinal`: the send rendered no line for it, so the model
 *   cannot have read it and an ordinal it guessed must not be written. NO
 *   fallback search is issued — that is the whole point of addressing by
 *   ordinal;
 * - an edit touching `capture.partialOrdinal` is `partial-ordinal`. That
 *   paragraph WAS shown, but only a prefix of it, and a replacement would
 *   delete the rest. It gets its own code so the report can say so;
 * - an ordinal outside `1..capture.paragraphsSent`, or one the capture has no
 *   entry for, is `unknown-ordinal` as well. This still covers the INTERIOR of
 *   a span, which the rendered-set gate deliberately does not;
 * - an edit whose paragraphs overlap an EARLIER edit's is `overlapping`.
 *   Earlier wins, so the outcome does not depend on how the model happened to
 *   order its list.
 *
 * A range is required to be ascending and contiguous by construction: it names
 * `paragraph..through`, every ordinal in between must resolve, and the
 * paragraphs are taken in ascending order. Its two ENDS must be paragraphs the
 * model actually read; blank paragraphs between them are part of the passage
 * it read and stay replaceable.
 */
export function planWordEdits(
  edits: readonly WordEdit[],
  capture: WordDocumentCapture,
): WordEditPlan {
  const resolved: ResolvedWordEdit[] = [];
  const rejected: WordEditOutcome[] = [];
  const claimed = new Set<number>();

  for (const [index, edit] of edits.entries()) {
    const through = edit.through ?? edit.paragraph;
    const excerpt = editExcerpt(edit.text);
    const outcome = (status: WordEditRejection): WordEditOutcome => ({
      index,
      paragraph: edit.paragraph,
      ...(edit.through === undefined ? {} : { through: edit.through }),
      status,
      excerpt,
    });

    // The ends of the edit are what the model claims to have read; check them
    // against what was actually rendered before resolving anything.
    if (
      capture.partialOrdinal !== null &&
      edit.paragraph <= capture.partialOrdinal &&
      capture.partialOrdinal <= through
    ) {
      rejected.push(outcome("partial-ordinal"));
      continue;
    }
    if (
      !capture.renderedOrdinals.has(edit.paragraph) ||
      !capture.renderedOrdinals.has(through)
    ) {
      rejected.push(outcome("unknown-ordinal"));
      continue;
    }

    const targets: ResolvedWordEdit["targets"] = [];
    let unknown = false;
    for (let ordinal = edit.paragraph; ordinal <= through; ordinal += 1) {
      const captured = capture.ordinalMap.get(ordinal);
      if (!captured || ordinal > capture.paragraphsSent) {
        unknown = true;
        break;
      }
      targets.push({
        ordinal,
        uniqueLocalId: captured.uniqueLocalId,
        sentText: captured.text,
      });
    }
    if (unknown) {
      rejected.push(outcome("unknown-ordinal"));
      continue;
    }
    if (targets.some((target) => claimed.has(target.ordinal))) {
      rejected.push(outcome("overlapping"));
      continue;
    }
    for (const target of targets) {
      claimed.add(target.ordinal);
    }
    resolved.push({
      index,
      paragraph: edit.paragraph,
      ...(edit.through === undefined ? {} : { through: edit.through }),
      text: edit.text,
      targets,
      excerpt,
    });
  }

  resolved.sort((a, b) => a.paragraph - b.paragraph);
  return { resolved, rejected };
}

export interface WordEditVerification {
  /** Survivors, ordered DESCENDING by start ordinal — the application order. */
  applicable: ResolvedWordEdit[];
  /** Edits dropped because the document moved under them. */
  skipped: WordEditOutcome[];
}

/**
 * Phase one, part two: compare each target paragraph's CURRENT text against
 * the text the model was shown.
 *
 * Exact string equality, deliberately: no trimming, no whitespace collapsing,
 * no case folding, no similarity threshold. A paragraph the user touched since
 * the send is skipped and reported, never overwritten — partial application is
 * what makes a standing "always allow" grant safe, because the executor may
 * apply less than was consented to and never more.
 *
 * A paragraph whose id no longer resolves (the user deleted it) counts as
 * changed for the same reason.
 *
 * The result is ordered DESCENDING by start ordinal. A replacement containing
 * a newline creates paragraphs and shifts everything after it, so applying
 * last-to-first leaves the not-yet-applied targets where the plan found them.
 */
export function verifyWordEdits(
  plan: WordEditPlan,
  currentTextById: ReadonlyMap<string, string | null>,
  currentParagraphIds?: readonly string[],
): WordEditVerification {
  const applicable: ResolvedWordEdit[] = [];
  const skipped: WordEditOutcome[] = [];

  for (const edit of plan.resolved) {
    const positions = currentParagraphIds
      ? edit.targets.map((target) =>
          currentParagraphIds.indexOf(target.uniqueLocalId),
        )
      : null;
    const contiguous =
      !positions ||
      positions.every(
        (position, index) =>
          position >= 0 &&
          (index === 0 || position === positions[index - 1] + 1),
      );
    const unchanged =
      contiguous &&
      edit.targets.every(
        (target) =>
          currentTextById.get(target.uniqueLocalId) === target.sentText,
      );
    if (unchanged) {
      applicable.push(edit);
    } else {
      skipped.push({
        index: edit.index,
        paragraph: edit.paragraph,
        ...(edit.through === undefined ? {} : { through: edit.through }),
        status: "changed",
        excerpt: edit.excerpt,
      });
    }
  }

  applicable.sort((a, b) => b.paragraph - a.paragraph);
  return { applicable, skipped };
}

/**
 * The report lines for one batch, in the order the model wrote the edits —
 * which is the order the user read them in, not the reverse order they were
 * applied in.
 *
 * Ordered by the edit's position in the list, never by its ordinal: two edits
 * may name the same paragraph, and each must keep its own verdict.
 */
export function buildWordEditReport(
  outcomes: readonly WordEditOutcome[],
): WordEditOutcome[] {
  return [...outcomes].sort((a, b) => a.index - b.index);
}
