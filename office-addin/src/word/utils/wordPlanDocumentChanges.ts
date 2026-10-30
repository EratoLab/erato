import {
  START_OF_DOCUMENT,
  wordBlockIndex,
  wordCaptureSections,
  wordOutlineTitle,
} from "./wordDocumentOutline";
import { wordWrittenChanges } from "./wordReadFreshness";

import type { WordCaptureSections } from "./wordDocumentOutline";
import type { WordReadCapture } from "./wordReadFreshness";
import type { ClientToolExecutionResult } from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "@erato/frontend/word-review";

const MAX_NAMED_PARTS = 3;
const PASSAGE_START_CHARS = 40;

/** Indexes of a longest run of values in increasing order. */
function inOrder(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  values.forEach((value, k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[k] = tails[lo - 1];
    tails[lo] = k;
  });
  const kept = new Set<number>();
  for (let k = tails.at(-1) ?? -1; k >= 0; k = previous[k]) kept.add(k);
  return kept;
}

/** The blocks a scoped or table_cell plan writes: the sources it replaces, deletes or moves, and the
 * blocks its insertions and new notes are anchored to. A kept source counts as moved when it is out
 * of the longest run the plan keeps in the captured order. */
export function wordPlanWrittenBlocks(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
): Set<number> {
  const index = wordBlockIndex(snapshot);
  const written = new Set<number>();
  const add = (ref: string) => {
    const at = index.get(ref);
    if (at !== undefined) written.add(at);
  };
  const placed: { at: number; source: readonly string[] }[] = [];
  for (const entry of plan.entries) {
    if (entry.kind === "insert") {
      entry.contextRefs?.forEach(add);
      continue;
    }
    if (entry.kind === "replace") entry.source.forEach(add);
    const at = index.get(entry.source[0]);
    if (at !== undefined) placed.push({ at, source: entry.source });
  }
  for (const { source } of plan.deleted) source.forEach(add);
  for (const story of plan.stories ?? [])
    if (story.anchor) add(story.anchor.block);
  const kept = inOrder(placed.map((p) => p.at));
  placed.forEach((p, k) => {
    if (!kept.has(k)) p.source.forEach(add);
  });
  return written;
}

/** The document's own name for the part a block lies in: the title of the innermost heading or
 * numbered section that holds it, else the start of the block's text. Never a ref or outline tag. */
function partName(
  snapshot: WordAuthoringSnapshot,
  sections: WordCaptureSections,
  block: number,
): string | undefined {
  let innermost: WordCaptureSections["outline"][number] | undefined;
  for (const entry of sections.outline)
    if (
      entry.tag !== "P" &&
      entry.from <= block &&
      block < entry.to &&
      (!innermost || entry.level >= innermost.level)
    )
      innermost = entry;
  if (innermost && innermost.title && innermost.title !== START_OF_DOCUMENT)
    return `"${innermost.title}"`;
  const text = Array.from(wordOutlineTitle(snapshot.blocks[block].text));
  if (!text.length) return undefined;
  const start = text.slice(0, PASSAGE_START_CHARS).join("");
  return `the passage beginning "${start}${text.length > PASSAGE_START_CHARS ? "…" : ""}"`;
}

const listed = (names: readonly string[]) =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Refuses a plan Apply would refuse: a local or remote change since the capture lies in a block a
 * scoped or table_cell plan writes, or anywhere for a whole-document plan. The refusal is terminal and
 * names the part by the document's own title, so the model tells the user what changed and that the
 * request can run again instead of proposing another plan (owner decision 2026-10-30).
 */
export function wordDocumentChangedRefusal(
  snapshot: WordAuthoringSnapshot,
  capture: WordReadCapture | undefined,
  plan: WordDocumentPlan | "document",
): ClientToolExecutionResult | undefined {
  const changes = wordWrittenChanges(
    snapshot,
    capture,
    plan === "document" ? "document" : wordPlanWrittenBlocks(plan, snapshot),
  );
  if (!changes) return undefined;
  const sections = wordCaptureSections(snapshot);
  const names: string[] = [];
  for (const block of changes.blocks) {
    const name = partName(snapshot, sections, block);
    if (name && !names.includes(name)) names.push(name);
    if (names.length > MAX_NAMED_PARTS) break;
  }
  const parts = !names.length
    ? "the document"
    : names.length > MAX_NAMED_PARTS
      ? `${names.slice(0, MAX_NAMED_PARTS).join(", ")} and other parts`
      : listed(names);
  const error = `${changes.local ? "The user" : "A co-author"} changed ${parts} in Word while you were working, so Apply would refuse this plan.`;
  return {
    ok: false,
    error,
    validationErrors: [
      {
        path: "",
        code: "document-changed",
        message: `${error} Tell the user in one sentence that ${changes.local ? "they" : "a co-author"} changed ${parts} while you were working and that they can run the request again. Do not propose another plan.`,
      },
    ],
    submissionFeedback: { terminal: true, recovery: "cannot_continue" },
  };
}
