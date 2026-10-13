import {
  parseWordCommentEnvelope,
  WORD_READ_COMMENTS_TOOL,
} from "./wordCommentContext";

import type { WordCommentStatus } from "./wordCommentContext";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type WordCommentReadView = "near" | "section" | "document" | "map";

/** One word_read_comments call as its read row shows it: counts, never comment text or names. */
export type WordCommentReadRow =
  | {
      toolCallId: string;
      state: "read";
      view: WordCommentReadView;
      /** The status the call asked for; null when it went on from a cursor without naming one. */
      status: WordCommentStatus | "all" | null;
      /** Threads, or map rows, the call returned. */
      count: number;
      /** Matching threads after this page, left for the cursor. */
      notShown: number;
    }
  | { toolCallId: string; state: "failed" };

const VIEWS: ReadonlySet<unknown> = new Set<WordCommentReadView>([
  "near",
  "section",
  "document",
  "map",
]);
const STATUSES: ReadonlySet<unknown> = new Set(["open", "resolved", "all"]);

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

function statusOf(input: unknown): WordCommentStatus | "all" | null {
  const args = object(input) ? input : {};
  if (STATUSES.has(args.status))
    return args.status as WordCommentStatus | "all";
  // word_read_comments reads open threads unless told otherwise; a cursor keeps its first call's status.
  return typeof args.cursor === "string" && args.cursor !== "" ? null : "open";
}

function readRowOf(part: ContentPart): WordCommentReadRow | null {
  if (
    part.content_type !== "tool_use" ||
    part.tool_name !== WORD_READ_COMMENTS_TOOL ||
    !part.tool_call_id
  )
    return null;
  const toolCallId = part.tool_call_id;
  if (part.status === "error") return { toolCallId, state: "failed" };
  const output = part.output;
  if (
    part.status !== "success" ||
    !object(output) ||
    output.status !== "success" ||
    !object(output.result)
  )
    return null;
  const result = output.result;
  const envelope = parseWordCommentEnvelope(result);
  if (envelope?.scope !== "read" || !VIEWS.has(result.view)) return null;
  const view = result.view as WordCommentReadView;
  return {
    toolCallId,
    state: "read",
    view,
    status: statusOf(part.input),
    count: view === "map" ? envelope.index.length : envelope.threads.length,
    notShown: isCount(result.remaining) ? result.remaining : 0,
  };
}

/** A row per settled word_read_comments call, in call order; a result that is not a read is left out. */
export function wordCommentReadRows(
  content: readonly ContentPart[],
): WordCommentReadRow[] {
  const rows = new Map<string, WordCommentReadRow>();
  for (const part of content) {
    const row = readRowOf(part);
    if (row) rows.set(row.toolCallId, row);
  }
  return [...rows.values()];
}
