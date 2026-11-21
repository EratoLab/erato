import { wordBodyRefIndex } from "./wordBodyRef";
import {
  WORD_PLAN_SECTIONS_TOOL,
  WORD_SUBMIT_PLAN_TOOL,
  WORD_WRITE_SECTION_TOOL,
} from "./wordHistoryNames";
import { isAcceptedWordSubmission } from "./wordHistoryParts";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The card of a change in parts (ERMAIN-1297): one row per section the section plan changes, plus
 * a Structure row for what moves, read from the message's own calls so it fills while Erato writes.
 */

export type WordPartsRowState =
  | "waiting"
  | "writing"
  | "checking"
  | "ready"
  | "not-written"
  | "changed-in-word";

export interface WordPartsSectionRow {
  /** The section plan's row number, from 1. */
  row: number;
  action: "rewrite" | "delete";
  /** The document's own name for the row, as the pane's receipt gives it; empty for untitled text. */
  title: string;
  state: WordPartsRowState;
}

export interface WordPartsStructure {
  /** Rows that change place: `after` names the row they now follow, `first` that none does. */
  moves: { row: number; title: string; after?: string; first?: true }[];
  /** Rewrite rows that join blocks from different places. */
  merges: { row: number; title: string }[];
  renames: { row: number; title: string; newTitle: string }[];
}

/** A row's status in the pane's section plan and finish receipts. */
export type WordPartReceiptStatus =
  | "waiting"
  | "ready"
  | "kept"
  | "deleted"
  | "not_written"
  | "changed_in_word";

/** Why the finish left the reordering out: the document changed in Word, and reordering replaces
 * the whole document, which Apply then refuses. */
export type WordPartsReorderingLeftOut = "changed_in_word";

export interface WordPartsProgress {
  /** Changes exactly when something the card shows changes. */
  key: string;
  /** The accepted section plan's call. */
  callId: string;
  draftId: string;
  intent?: string;
  rows: WordPartsSectionRow[];
  structure?: WordPartsStructure;
  /** A finish call is being written or checked. */
  finishing: boolean;
  /** The accepted finish's call id. */
  finished?: string;
  /** The accepted finish left the reordering out. */
  reorderingLeftOut?: WordPartsReorderingLeftOut;
  /** The turn ended without an accepted finish. */
  stopped: boolean;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type ToolPart = Extract<ContentPart, { content_type: "tool_use" }>;

const successResult = (part: ToolPart): Record<string, unknown> | undefined =>
  part.status === "success" &&
  object(part.output) &&
  part.output.status === "success" &&
  object(part.output.result)
    ? part.output.result
    : undefined;

/** A `plan_document_sections` call the pane accepted. */
export function isAcceptedWordSectionPlan(part: ContentPart): boolean {
  if (
    part.content_type !== "tool_use" ||
    part.tool_name !== WORD_PLAN_SECTIONS_TOOL ||
    !part.tool_call_id
  )
    return false;
  const result = successResult(part);
  return typeof result?.draft_id === "string" && Array.isArray(result.rows);
}

/** A `write_document_section` call the pane accepted for a row of `draftId`. */
export function isAcceptedWordSectionPart(
  part: ContentPart,
  draftId: string,
): boolean {
  if (
    part.content_type !== "tool_use" ||
    part.tool_name !== WORD_WRITE_SECTION_TOOL
  )
    return false;
  const result = successResult(part);
  return (
    result?.draft_id === draftId &&
    result.status === "ready" &&
    typeof result.row === "number"
  );
}

/** A `submit_document_plan` finish the pane accepted. */
export const isAcceptedWordPartsFinish = (part: ContentPart): boolean =>
  isAcceptedWordSubmission(part) &&
  part.content_type === "tool_use" &&
  object(part.input) &&
  part.input.finish === true;

/** The call id of the message's latest accepted section plan. */
export function wordPartsSectionPlanCall(
  content: readonly ContentPart[] | undefined,
): string | undefined {
  const part = content?.findLast(isAcceptedWordSectionPlan);
  return part?.content_type === "tool_use" ? part.tool_call_id : undefined;
}

const MAX_SOURCE_BLOCKS = 100_000;
const RANGE = /^\s*(b[1-9]\d*)\s*(?:[-–]\s*(b[1-9]\d*))?\s*$/u;

/** A row's `source` such as `b1-b57,b60` as body block indexes, in the order written. */
export function wordPartSourceIndexes(source: unknown): number[] | undefined {
  if (typeof source !== "string") return undefined;
  const indexes: number[] = [];
  for (const item of source.split(",")) {
    const match = RANGE.exec(item);
    const from = match ? wordBodyRefIndex(match[1]) : undefined;
    const to = match?.[2] ? wordBodyRefIndex(match[2]) : from;
    if (
      from === undefined ||
      to === undefined ||
      to < from ||
      indexes.length + to - from >= MAX_SOURCE_BLOCKS
    )
      return undefined;
    for (let at = from; at <= to; at++) indexes.push(at);
  }
  return indexes;
}

export interface WordPartsLayoutRow {
  action: string;
  /** Body block indexes in output order. */
  refs: readonly number[];
  renamed?: boolean;
}

export interface WordPartsLayout {
  /** Rows, from 0, that leave their place; a merge below is not counted here. */
  moved: number[];
  /** Rewrite rows whose blocks are not one run in document order, so their text moves blocks. */
  merged: number[];
  renamed: number[];
}

/** Consecutive block indexes, as runs in the order given. */
export const wordIndexRuns = (refs: readonly number[]): number[][] => {
  const runs: number[][] = [];
  for (const at of refs) {
    const last = runs.at(-1);
    if (last && at === last[last.length - 1] + 1) last.push(at);
    else runs.push([at]);
  }
  return runs;
};

/** The positions of one longest strictly increasing subsequence: what keeps its place. */
export function wordLongestIncreasing(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  values.forEach((value, k) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (values[tails[mid]] < value) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[k] = tails[low - 1];
    tails[low] = k;
  });
  const kept = new Set<number>();
  for (let k = tails.at(-1) ?? -1; k >= 0; k = previous[k]) kept.add(k);
  return kept;
}

/**
 * What the section plan does to the document's order. Leaving out the reordering puts every
 * moved row back and leaves out the merged rows and the renames, so the rest can go in place.
 * Deleted blocks have no place, so a delete row never moves.
 */
export function wordPartsLayout(
  rows: readonly WordPartsLayoutRow[],
): WordPartsLayout {
  const merged: number[] = [];
  const renamed: number[] = [];
  const pieces: { row: number; start: number }[] = [];
  rows.forEach((row, r) => {
    if (row.renamed) renamed.push(r);
    const runs = wordIndexRuns(row.refs);
    if (row.action === "rewrite" && runs.length > 1) merged.push(r);
    else if (row.action !== "delete")
      for (const run of runs) pieces.push({ row: r, start: run[0] });
  });
  const kept = wordLongestIncreasing(pieces.map((piece) => piece.start));
  const moved = [
    ...new Set(pieces.filter((_, k) => !kept.has(k)).map((piece) => piece.row)),
  ].sort((a, b) => a - b);
  return { moved, merged, renamed };
}

interface ReceiptRow {
  row: number;
  action: string;
  title: string;
  newTitle?: string;
  status: string;
}

const receiptRows = (value: unknown): ReceiptRow[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const rows: ReceiptRow[] = [];
  for (const [k, item] of value.entries()) {
    if (
      !object(item) ||
      item.row !== k + 1 ||
      typeof item.action !== "string" ||
      typeof item.title !== "string" ||
      typeof item.status !== "string"
    )
      return undefined;
    rows.push({
      row: k + 1,
      action: item.action,
      title: item.title,
      ...(typeof item.new_title === "string"
        ? { newTitle: item.new_title }
        : {}),
      status: item.status,
    });
  }
  return rows;
};

const ROW_IN_PREVIEW = /"row"\s*:\s*"?(\d{1,4})\b/u;
const FINISH_IN_PREVIEW = /"finish"\s*:\s*true/u;

/** The row a part call writes; a call still being written has only a preview of its arguments. */
function partRow(input: unknown): number | undefined {
  if (object(input))
    return typeof input.row === "number" && Number.isInteger(input.row)
      ? input.row
      : undefined;
  const match = typeof input === "string" ? ROW_IN_PREVIEW.exec(input) : null;
  return match ? Number(match[1]) : undefined;
}

const isFinish = (input: unknown) =>
  object(input)
    ? input.finish === true
    : typeof input === "string" && FINISH_IN_PREVIEW.test(input);

const FINISHED_STATES: Partial<
  Record<WordPartReceiptStatus, WordPartsRowState>
> = {
  ready: "ready",
  deleted: "ready",
  not_written: "not-written",
  changed_in_word: "changed-in-word",
};

/** `leftOut`: rows the finish kept as they were, so they neither rename nor join blocks. */
function structureOf(
  receipt: readonly ReceiptRow[],
  inputRows: unknown,
  leftOut: (row: ReceiptRow) => boolean,
): WordPartsStructure | undefined {
  if (!Array.isArray(inputRows) || inputRows.length !== receipt.length)
    return undefined;
  const refs = inputRows.map((row) =>
    object(row) ? wordPartSourceIndexes(row.source) : undefined,
  );
  if (refs.some((indexes) => !indexes)) return undefined;
  const layout = wordPartsLayout(
    receipt.map((row, k) => ({
      action: leftOut(row) ? "keep" : row.action,
      refs: refs[k]!,
      renamed: row.newTitle !== undefined && !leftOut(row),
    })),
  );
  const named = (r: number) => receipt[r].newTitle ?? receipt[r].title;
  const moves = layout.moved.map((r) => {
    let before = r - 1;
    while (before >= 0 && receipt[before].action === "delete") before--;
    return {
      row: r + 1,
      title: receipt[r].title,
      ...(before < 0
        ? { first: true as const }
        : named(before)
          ? { after: named(before) }
          : {}),
    };
  });
  const merges = layout.merged.map((r) => ({
    row: r + 1,
    title: receipt[r].title,
  }));
  const renames = layout.renamed.map((r) => ({
    row: r + 1,
    title: receipt[r].title,
    newTitle: receipt[r].newTitle!,
  }));
  return moves.length || merges.length || renames.length
    ? { moves, merges, renames }
    : undefined;
}

/**
 * The card's rows for the message's latest accepted section plan, or undefined without one. Until
 * the finish, a row is Ready once a part for it was accepted; a rejected part is a quiet fix and
 * shows as Writing while the turn runs. After the finish, its receipt decides.
 */
export function wordPartsProgress(
  content: readonly ContentPart[] | undefined,
  generating: boolean,
): WordPartsProgress | undefined {
  const at = content?.findLastIndex(isAcceptedWordSectionPlan) ?? -1;
  if (!content || at < 0) return undefined;
  const plan = content[at] as ToolPart;
  const result = successResult(plan)!;
  const draftId = result.draft_id as string;
  const receipt = receiptRows(result.rows);
  if (!receipt) return undefined;
  const written = new Set(
    receipt.filter((row) => row.status === "ready").map((row) => row.row),
  );
  const active = new Map<number, "writing" | "checking" | "retry">();
  let finishing = false;
  let finish:
    | { id: string; rows?: ReceiptRow[]; reordering?: unknown }
    | undefined;
  for (const part of content.slice(at + 1)) {
    if (part.content_type !== "tool_use") continue;
    if (part.tool_name === WORD_WRITE_SECTION_TOOL) {
      const row = partRow(part.input);
      if (row === undefined) continue;
      if (isAcceptedWordSectionPart(part, draftId)) {
        written.add(row);
        active.delete(row);
      } else
        active.set(
          row,
          part.status === "preparing"
            ? "writing"
            : part.status === "in_progress"
              ? "checking"
              : "retry",
        );
    } else if (part.tool_name === WORD_SUBMIT_PLAN_TOOL) {
      if (isAcceptedWordPartsFinish(part)) {
        finishing = false;
        const result = successResult(part);
        finish = {
          id: part.tool_call_id ?? "",
          rows: receiptRows(result?.rows),
          reordering: result?.reordering,
        };
      } else
        finishing =
          (part.status === "preparing" || part.status === "in_progress") &&
          isFinish(part.input);
    }
  }
  const finished = (row: ReceiptRow) => {
    const status = finish?.rows?.[row.row - 1]?.status;
    return status
      ? FINISHED_STATES[status as WordPartReceiptStatus]
      : undefined;
  };
  // The finish receipt is the pane's own rule for what Apply writes, so it decides first.
  const state = (row: ReceiptRow): WordPartsRowState => {
    if (finish)
      return (
        finished(row) ??
        (row.action === "delete" || written.has(row.row)
          ? "ready"
          : "not-written")
      );
    if (row.action === "delete") return "ready";
    const call = generating ? active.get(row.row) : undefined;
    if (call) return call === "retry" ? "writing" : call;
    if (written.has(row.row)) return "ready";
    return generating ? "waiting" : "not-written";
  };
  const rows = receipt.flatMap((row): WordPartsSectionRow[] =>
    row.action === "rewrite" || row.action === "delete"
      ? [
          {
            row: row.row,
            action: row.action,
            title: row.title,
            state: state(row),
          },
        ]
      : [],
  );
  const input: Record<string, unknown> = object(plan.input) ? plan.input : {};
  const structure = structureOf(
    receipt,
    input.rows,
    (row) => finished(row) === "changed-in-word",
  );
  const reorderingLeftOut =
    finish?.reordering === "changed_in_word"
      ? (finish.reordering as WordPartsReorderingLeftOut)
      : undefined;
  const progress = {
    callId: plan.tool_call_id ?? "",
    draftId,
    ...(typeof input.intent === "string" && input.intent.trim()
      ? { intent: input.intent }
      : {}),
    rows,
    ...(structure ? { structure } : {}),
    finishing: generating && finishing,
    ...(finish ? { finished: finish.id } : {}),
    ...(structure && reorderingLeftOut ? { reorderingLeftOut } : {}),
    stopped: !finish && !generating,
  };
  return { key: JSON.stringify(progress), ...progress };
}
