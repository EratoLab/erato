import { wordPartsProgress } from "@erato/frontend/word-review";
import { useMemo } from "react";

import {
  wordPartsApplied,
  wordPartsFromContent,
} from "../utils/wordDocumentParts";

import type { ContentPart } from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordPartsProgress,
  WordPlanReview,
  WordPlanRow,
} from "@erato/frontend/word-review";

export interface WordPlanParts {
  progress: WordPartsProgress;
  /** The section plan row (from 1) a review row of the accepted plan belongs to. */
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
 * A finished change in parts, for the plan card: its rows from the message's calls, and which row
 * each change of the accepted plan belongs to. Undefined for any other plan.
 */
export function useWordPlanParts({
  messageContent,
  snapshot,
}: {
  messageContent: readonly ContentPart[] | undefined;
  /** The capture the card reviews against: the live one, or one rebuilt from the chat. */
  snapshot: WordAuthoringSnapshot | undefined;
}): WordPlanParts | undefined {
  const progress = useMemo(() => {
    const found = wordPartsProgress(messageContent, false);
    return found?.finished ? found : undefined;
  }, [messageContent]);
  const sectionRowOf = useMemo(() => {
    if (!progress || !snapshot) return undefined;
    const found = wordPartsFromContent(messageContent, snapshot);
    return found
      ? wordPartsApplied(found.draft, snapshot, {
          rows: found.changed,
          structure: found.reorderingLeftOut,
        }).sectionRowOf
      : undefined;
  }, [progress, snapshot, messageContent]);
  return progress
    ? { progress, ...(sectionRowOf ? { sectionRowOf } : {}) }
    : undefined;
}
