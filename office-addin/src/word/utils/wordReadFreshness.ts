import { wordChangesSince } from "./wordChangeJournal";
import { wordCaptureSections } from "./wordDocumentOutline";

import type { WordDocumentBuild } from "./buildWordDocumentArgs";
import type { WordChangeEntry, WordChangePosition } from "./wordChangeJournal";
import type { ClientToolExecutionResult } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

/** Where the change journal stood when a capture started, and when that was. A send's copy of the
 * capture keeps both. */
export interface WordCaptureChanges {
  position: WordChangePosition;
  capturedAt: string;
}

/** What a read needs from its capture to tell what changed since: the position and the paragraph
 * ids by ordinal, which the snapshot's blocks reach through paragraphOrdinal. */
export interface WordReadCapture {
  changes?: WordCaptureChanges;
  ordinalMap?: WordDocumentBuild["ordinalMap"];
}

/** The blocks a response depends on, as indexes into the capture's body blocks. */
export type WordFreshnessScope =
  | { kind: "document" }
  | { kind: "extent"; from: number; to: number }
  | { kind: "blocks"; blocks: ReadonlySet<number> };

/** A read's response, with the scope its freshness covers when it read the capture. */
export interface WordReadOutcome {
  result: ClientToolExecutionResult;
  scope?: WordFreshnessScope;
}

export type WordFreshnessChanges =
  | "none"
  | "elsewhere"
  | "in-scope"
  | "unknown";

export interface WordReadFreshness {
  context_ref: string;
  capturedAt?: string;
  changes: WordFreshnessChanges;
  counts: { own: number; local: number; remote: number; unknown: number };
  sections: string[];
}

const MAX_SECTIONS = 32;
/** Replay keeps a receipt field only up to 512 bytes of JSON (MAX_RECEIPT_FIELD_BYTES). */
export const MAX_WORD_FRESHNESS_BYTES = 512;
const encoder = new TextEncoder();

interface Mapping {
  ordinalOf: ReadonlyMap<string, number>;
  idsMissing: boolean;
  /** Per ordinal, the nearest block at or before it, and at or after it, that a paragraph maps to. */
  before: Int32Array;
  after: Int32Array;
}

const mappings = new WeakMap<
  WordReadCapture,
  { snapshot: WordAuthoringSnapshot; mapping: Mapping }
>();

function mappingOf(
  snapshot: WordAuthoringSnapshot,
  capture: WordReadCapture,
): Mapping {
  const cached = mappings.get(capture);
  if (cached?.snapshot === snapshot) return cached.mapping;
  const ordinalOf = new Map<string, number>();
  let idsMissing = !capture.ordinalMap?.size;
  let last = 0;
  for (const [ordinal, paragraph] of capture.ordinalMap ?? []) {
    if (paragraph.uniqueLocalId)
      ordinalOf.set(paragraph.uniqueLocalId, ordinal);
    else idsMissing = true;
    last = Math.max(last, ordinal);
  }
  const before = new Int32Array(last + 2).fill(-1);
  const after = new Int32Array(last + 2).fill(-1);
  snapshot.blocks.forEach((block, index) => {
    const ordinal = block.paragraphOrdinal;
    if (ordinal !== undefined && ordinal <= last)
      before[ordinal] = after[ordinal] = index;
  });
  for (let k = 1; k <= last; k++) if (before[k] < 0) before[k] = before[k - 1];
  for (let k = last; k >= 1; k--) if (after[k] < 0) after[k] = after[k + 1];
  const mapping = { ordinalOf, idsMissing, before, after };
  mappings.set(capture, { snapshot, mapping });
  return mapping;
}

/** The blocks a paragraph of the capture lies in. A paragraph no block maps to, such as a
 * table-cell paragraph or one whose text repeats, lies between its mapped neighbours. */
function blocksOfOrdinal(
  mapping: Mapping,
  ordinal: number,
  blockCount: number,
): [number, number] | null {
  const before = mapping.before[ordinal];
  const after = mapping.after[ordinal];
  if (before >= 0 && before === after) return [before, before];
  if (before < 0 && after < 0) return null;
  const from = before < 0 ? 0 : before + 1;
  const to = after < 0 ? blockCount - 1 : after - 1;
  return from <= to
    ? [from, to]
    : [Math.max(before, 0), Math.max(after, before)];
}

function blocksOfId(
  id: string,
  mapping: Mapping,
  since: readonly WordChangeEntry[],
  blockCount: number,
): [number, number] | null {
  const ordinal = mapping.ordinalOf.get(id);
  if (ordinal !== undefined)
    return blocksOfOrdinal(mapping, ordinal, blockCount);
  for (const entry of since) {
    const neighbours = entry.location?.get(id);
    if (!neighbours) continue;
    for (const neighbour of neighbours) {
      const at = mapping.ordinalOf.get(neighbour);
      if (at !== undefined) return blocksOfOrdinal(mapping, at, blockCount);
    }
  }
  return null;
}

export interface WordWrittenChanges {
  /** The written blocks the changes lie in, ascending; for a whole-document plan, every block a
   * placed change lies in. */
  blocks: number[];
  /** Whether one of them came from this pane's user (or, on the web, a desktop co-author). */
  local: boolean;
}

/** The local or remote changes since the capture that lie in blocks a plan writes, or anywhere for
 * a whole-document plan. Own changes, unknown entries and ids the journal cannot place count for
 * nothing here: Apply's check of the live document guards those. */
export function wordWrittenChanges(
  snapshot: WordAuthoringSnapshot,
  capture: WordReadCapture | undefined,
  written: ReadonlySet<number> | "document",
): WordWrittenChanges | undefined {
  if (!capture?.changes) return undefined;
  const since = wordChangesSince(capture.changes.position);
  if (!since.ok) return undefined;
  const mapping = mappingOf(snapshot, capture);
  const blockCount = snapshot.blocks.length;
  const hit = new Set<number>();
  let found = false;
  let local = false;
  for (const entry of since.entries) {
    if (entry.source !== "local" && entry.source !== "remote") continue;
    let inWritten = written === "document";
    for (const id of entry.ids) {
      const blocks = blocksOfId(id, mapping, since.entries, blockCount);
      if (!blocks) continue;
      for (let block = blocks[0]; block <= blocks[1]; block++)
        if (written === "document" || written.has(block)) {
          hit.add(block);
          inWritten = true;
        }
    }
    if (!inWritten) continue;
    found = true;
    local ||= entry.source === "local";
  }
  return found ? { blocks: [...hit].sort((a, b) => a - b), local } : undefined;
}

/** changes: "in-scope" when a local or remote change lies in what the response read; otherwise
 * "unknown" when the journal cannot tell, "elsewhere" when such a change lies outside, else "none".
 * The pane's own writes never change it. */
export function wordReadFreshness(
  snapshot: WordAuthoringSnapshot,
  capture: WordReadCapture | undefined,
  scope: WordFreshnessScope,
): WordReadFreshness {
  const counts = { own: 0, local: 0, remote: 0, unknown: 0 };
  const freshness: WordReadFreshness = {
    context_ref: snapshot.token,
    ...(capture?.changes ? { capturedAt: capture.changes.capturedAt } : {}),
    changes: "unknown",
    counts,
    sections: [],
  };
  if (!capture?.changes) return freshness;
  const since = wordChangesSince(capture.changes.position);
  if (!since.ok) return freshness;
  const mapping = mappingOf(snapshot, capture);
  let unknown = mapping.idsMissing;
  const sections = wordCaptureSections(snapshot);
  const blockCount = snapshot.blocks.length;
  const readEntries =
    scope.kind === "blocks"
      ? new Set(
          [...scope.blocks]
            .map((block) => sections.entryOf[block])
            .filter((entry) => entry >= 0),
        )
      : undefined;
  const inScope = (from: number, to: number) => {
    if (scope.kind === "document") return true;
    if (scope.kind === "extent") return from < scope.to && to >= scope.from;
    for (let block = from; block <= to; block++)
      if (scope.blocks.has(block) || readEntries!.has(sections.entryOf[block]))
        return true;
    return false;
  };
  const touched = new Set<number>();
  let outside = false;
  let within = false;
  for (const entry of since.entries) {
    counts[entry.source] += 1;
    if (entry.source === "unknown") {
      unknown = true;
      continue;
    }
    if (entry.source === "own") continue;
    outside = true;
    if (scope.kind === "document") within = true;
    for (const id of entry.ids) {
      const blocks = blocksOfId(id, mapping, since.entries, blockCount);
      if (!blocks) {
        unknown = true;
        continue;
      }
      if (inScope(blocks[0], blocks[1])) within = true;
      for (let block = blocks[0]; block <= blocks[1]; block++)
        if (sections.entryOf[block] >= 0) touched.add(sections.entryOf[block]);
    }
    if (!entry.ids.length || entry.moreIds) unknown = true;
  }
  freshness.changes = within
    ? "in-scope"
    : unknown
      ? "unknown"
      : outside
        ? "elsewhere"
        : "none";
  const refs = [...touched]
    .sort((a, b) => a - b)
    .slice(0, MAX_SECTIONS)
    .map((entry) => sections.outline[entry].ref);
  freshness.sections = refs;
  while (
    refs.length &&
    encoder.encode(JSON.stringify(freshness)).length > MAX_WORD_FRESHNESS_BYTES
  )
    refs.pop();
  return freshness;
}
