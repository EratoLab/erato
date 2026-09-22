import type { WordDocumentCapture } from "./wordDocumentCapture";

export interface WordEdit {
  /** 1-based paragraph ordinal, as the document text showed it. */
  paragraph: number;
  /** Last ordinal of a multi-paragraph span; absent for a single paragraph. */
  through?: number;
  /** Plain replacement text. A newline creates further paragraphs. */
  text: string;
}

/** Reject the whole list when any edit is malformed; applying a subset would change the request. */
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

export type WordEditRejection =
  | "unknown-ordinal"
  | "partial-ordinal"
  | "overlapping"
  | "changed";

export type WordEditStatus = "applied" | "failed" | WordEditRejection;

export interface WordEditOutcome {
  /** Use list position as the edit identity; multiple edits can name the same paragraph. */
  index: number;
  paragraph: number;
  through?: number;
  status: WordEditStatus;
  excerpt: string;
}

export interface ResolvedWordEdit {
  index: number;
  paragraph: number;
  through?: number;
  text: string;
  targets: { ordinal: number; uniqueLocalId: string; sentText: string }[];
  excerpt: string;
}

export interface WordEditPlan {
  resolved: ResolvedWordEdit[];
  rejected: WordEditOutcome[];
}

const EXCERPT_CODE_POINTS = 60;

export function editExcerpt(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  const points = [...collapsed];
  return points.length <= EXCERPT_CODE_POINTS
    ? collapsed
    : `${points.slice(0, EXCERPT_CODE_POINTS).join("")}…`;
}

/** Endpoints must be fully read; blank interior paragraphs remain in the span.
 * Never locate an unknown ordinal by searching its text. */
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
  applicable: ResolvedWordEdit[];
  skipped: WordEditOutcome[];
}

/** Whitespace changes count as later edits. Apply from the end because newlines shift paragraph positions. */
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

export function buildWordEditReport(
  outcomes: readonly WordEditOutcome[],
): WordEditOutcome[] {
  return [...outcomes].sort((a, b) => a.index - b.index);
}
