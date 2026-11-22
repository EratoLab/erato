import {
  canonicalWordPlan,
  wordPartsProgress,
} from "@erato/frontend/word-review";
import { useMemo } from "react";

import {
  wordPartsApplied,
  wordPartsFromContent,
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
  /** The draft rebuilt from the message's calls gives the accepted plan exactly, so rows can be
   * left out of Apply. */
  editable: boolean;
  /** The plan Apply writes with the left-out rows as they were; undefined while none is. */
  applied?: string;
  /** The section plan row (from 1) a review row of the plan Apply writes belongs to. */
  sectionRowOf?: (reviewRowKey: string) => number | undefined;
}

/** The review rows of the plan Apply writes, by the section plan row they belong to. */
export function wordPartsChangesByRow(
  review: WordPlanReview | null | undefined,
  sectionRowOf: ((reviewRowKey: string) => number | undefined) | undefined,
): Map<number, WordPlanRow[]> {
  const byRow = new Map<number, WordPlanRow[]>();
  if (!sectionRowOf) return byRow;
  for (const row of review?.rows ?? []) {
    if (row.family === "unchanged") continue;
    const owner = sectionRowOf(row.key);
    if (owner !== undefined)
      byRow.set(owner, [...(byRow.get(owner) ?? []), row]);
  }
  return byRow;
}

/**
 * A finished change in parts, for the plan card: its rows from the message's calls, and the plan
 * Apply writes once the user leaves rows or the reordering out. Undefined for any other plan.
 */
export function useWordPlanParts({
  content,
  messageContent,
  snapshot,
  live,
  leftOut,
}: {
  /** The accepted plan, as the card's fence carries it. */
  content: string;
  messageContent: readonly ContentPart[] | undefined;
  /** The capture the card reviews against: the live one, or one rebuilt from the chat. */
  snapshot: WordAuthoringSnapshot | undefined;
  /** `snapshot` is the live capture the plan was written against; only then can rows be left out. */
  live: boolean;
  leftOut: WordReviewState["partsLeftOut"];
}): WordPlanParts | undefined {
  const progress = useMemo(() => {
    const found = wordPartsProgress(messageContent, false);
    return found?.finished ? found : undefined;
  }, [messageContent]);
  const rebuilt = useMemo(() => {
    if (!progress || !snapshot) return undefined;
    const found = wordPartsFromContent(messageContent, snapshot);
    if (!found) return undefined;
    const accepted = wordPartsApplied(found.draft, snapshot, {
      rows: found.changed,
      structure: found.reorderingLeftOut,
    });
    let exact = false;
    try {
      exact =
        canonicalWordPlan(accepted.plan) ===
        canonicalWordPlan(JSON.parse(content));
    } catch {
      // A fence that does not parse is never left out of.
    }
    return { ...found, accepted, exact };
  }, [progress, snapshot, messageContent, content]);
  const editable = live && !!rebuilt?.exact;
  const applied = useMemo(() => {
    if (
      !editable ||
      !rebuilt ||
      !snapshot ||
      !leftOut ||
      (!leftOut.rows.length && !leftOut.structure)
    )
      return undefined;
    return wordPartsApplied(rebuilt.draft, snapshot, {
      rows: new Set([...rebuilt.changed, ...leftOut.rows.map((n) => n - 1)]),
      structure: leftOut.structure || rebuilt.reorderingLeftOut,
    });
  }, [editable, rebuilt, snapshot, leftOut]);
  return progress
    ? {
        progress,
        editable,
        ...(applied ? { applied: JSON.stringify(applied.plan) } : {}),
        ...(rebuilt
          ? {
              sectionRowOf: (applied ?? rebuilt.accepted).sectionRowOf,
            }
          : {}),
      }
    : undefined;
}
