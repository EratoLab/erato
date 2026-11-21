import {
  canonicalWordPlan,
  isAcceptedWordSectionPlan,
  wordBodyRef,
  wordPartSourceIndexes,
  wordPartsProgress,
} from "@erato/frontend/word-review";
import { useMemo } from "react";

import {
  assembleWordParts,
  wordPartsFromContent,
  wordPartsWithout,
} from "../utils/wordDocumentParts";

import type { WordReviewState } from "../utils/wordReviewState";
import type { ContentPart } from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordPartsProgress,
  WordPlanReview,
  WordPlanRow,
} from "@erato/frontend/word-review";

export interface WordPlanParts {
  progress: WordPartsProgress;
  /** Each section plan row's review rows, by row number. */
  changes: ReadonlyMap<number, readonly WordPlanRow[]>;
  /** The draft rebuilt from the message's calls gives the accepted plan exactly, so rows can be
   * left out of Apply. */
  editable: boolean;
  /** The plan Apply writes with the left-out rows as they were; undefined while none is. */
  applied?: string;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const OUTPUT_ROW = /^output:r(\d+)_/u;
const SOURCE_ROW = /^(?:replaced|deleted):(.+)$/u;

/** The section plan row a review row of the assembled plan came from: block ids carry the row,
 * removed blocks are found by their ref. */
function sectionRowOf(
  key: string,
  rowOf: ReadonlyMap<string, number>,
): number | undefined {
  const output = OUTPUT_ROW.exec(key);
  if (output) return Number(output[1]);
  const source = SOURCE_ROW.exec(key);
  return source ? rowOf.get(source[1]) : undefined;
}

/**
 * A finished change in parts, for the plan card: its rows from the message's calls, and the plan
 * Apply writes once the user leaves rows or the reordering out. Undefined for any other plan.
 */
export function useWordPlanParts({
  content,
  messageContent,
  snapshot,
  review,
  leftOut,
}: {
  /** The accepted plan, as the card's fence carries it. */
  content: string;
  messageContent: readonly ContentPart[] | undefined;
  /** The live capture the plan was written against; without it nothing can be left out. */
  snapshot: WordAuthoringSnapshot | undefined;
  /** The accepted plan's review. */
  review: WordPlanReview | null | undefined;
  leftOut: WordReviewState["partsLeftOut"];
}): WordPlanParts | undefined {
  const progress = useMemo(() => {
    const found = wordPartsProgress(messageContent, false);
    return found?.finished ? found : undefined;
  }, [messageContent]);
  const changes = useMemo(() => {
    const rowOf = new Map<string, number>();
    const plan =
      progress && messageContent?.findLast(isAcceptedWordSectionPlan);
    const rows =
      plan?.content_type === "tool_use" &&
      object(plan.input) &&
      Array.isArray(plan.input.rows)
        ? (plan.input.rows as unknown[])
        : [];
    rows.forEach((row, k) =>
      wordPartSourceIndexes(object(row) ? row.source : undefined)?.forEach(
        (index) => rowOf.set(wordBodyRef(index), k + 1),
      ),
    );
    const byRow = new Map<number, WordPlanRow[]>();
    for (const row of review?.rows ?? []) {
      if (row.family === "unchanged") continue;
      const owner = sectionRowOf(row.key, rowOf);
      if (owner !== undefined)
        byRow.set(owner, [...(byRow.get(owner) ?? []), row]);
    }
    return byRow;
  }, [progress, messageContent, review]);
  const rebuilt = useMemo(() => {
    if (!progress || !snapshot) return undefined;
    const found = wordPartsFromContent(messageContent, snapshot);
    if (!found) return undefined;
    const { plan, parts } = wordPartsWithout(
      found.draft.plan,
      found.draft.parts,
      { rows: found.changed, structure: false },
      snapshot,
    );
    const assembled = assembleWordParts(
      snapshot,
      found.draft.readToken,
      plan,
      parts,
    ).plan;
    try {
      return canonicalWordPlan(assembled) ===
        canonicalWordPlan(JSON.parse(content))
        ? found
        : undefined;
    } catch {
      return undefined;
    }
  }, [progress, snapshot, messageContent, content]);
  const applied = useMemo(() => {
    if (
      !rebuilt ||
      !snapshot ||
      !leftOut ||
      (!leftOut.rows.length && !leftOut.structure)
    )
      return undefined;
    const { plan, parts } = wordPartsWithout(
      rebuilt.draft.plan,
      rebuilt.draft.parts,
      {
        rows: new Set([...rebuilt.changed, ...leftOut.rows.map((n) => n - 1)]),
        structure: leftOut.structure,
      },
      snapshot,
    );
    return JSON.stringify(
      assembleWordParts(snapshot, rebuilt.draft.readToken, plan, parts).plan,
    );
  }, [rebuilt, snapshot, leftOut]);
  return progress
    ? {
        progress,
        changes,
        editable: !!rebuilt,
        ...(applied ? { applied } : {}),
      }
    : undefined;
}
