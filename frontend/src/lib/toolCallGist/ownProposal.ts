import { WORD_COMMENT_OPS } from "@/lib/wordReview/wordCommentChanges";

import { isRecord, readPointerAll } from "./serverText";

import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { WordCommentOp } from "@/lib/wordReview/wordCommentChanges";

/**
 * What one of Erato's own proposal tools proposes, for the one line its trace
 * row shows. The proposal's own card carries the rest.
 */
export type OwnProposal =
  | { kind: "document" }
  /** One entry per change in call order; `other` for an operation this build has no word for. */
  | { kind: "comments"; changes: (WordCommentOp | "other")[] }
  | { kind: "email" }
  | { kind: "event" }
  | { kind: "action" };

export type OwnProposalKind = OwnProposal["kind"];
export const OWN_PROPOSAL_KINDS = [
  "document",
  "comments",
  "email",
  "event",
  "action",
] as const satisfies readonly OwnProposalKind[];

const isCommentOp = (value: unknown): value is WordCommentOp =>
  (WORD_COMMENT_OPS as readonly unknown[]).includes(value);

// Counted from the input, not the label's values, which stop at ten. A
// stored label of any shape reads as no count rather than failing the row.
const commentChangesOf = (
  label: Record<string, unknown>,
  input: unknown,
): (WordCommentOp | "other")[] => {
  const items = Array.isArray(label.items) ? (label.items as unknown[]) : [];
  const ops = items
    .flatMap((item) =>
      isRecord(item) && Array.isArray(item.fields)
        ? (item.fields as unknown[])
        : [],
    )
    .find((field) => isRecord(field) && field.name === "op");
  const values = isRecord(ops) ? readPointerAll(input, ops.pointer) : [];
  return (values ?? []).map((op) => (isCommentOp(op) ? op : "other"));
};

/**
 * The proposal a label written by hand for one of Erato's own tools names, or
 * `undefined` for any other call, and for rows saved before such labels.
 */
export const ownProposalOf = (
  label: ToolCallLabel | null | undefined,
  input: unknown,
): OwnProposal | undefined => {
  const stored: unknown = label;
  if (!isRecord(stored) || stored.source !== "own_mapping") return undefined;
  const { action, object_kind: kind } = stored;
  if (kind === "document" && action === "update") return { kind: "document" };
  if (
    kind === "comment" &&
    (action === "comment" || action === "update" || action === "delete")
  ) {
    return { kind: "comments", changes: commentChangesOf(stored, input) };
  }
  if (kind === "email" && action === "send") return { kind: "email" };
  if (kind === "event" && action === "create") return { kind: "event" };
  return { kind: "action" };
};

/** How many changes of each operation a comment proposal holds, in operation order. */
export const commentOpCounts = (
  changes: readonly (WordCommentOp | "other")[],
): { op: WordCommentOp | "other"; count: number }[] =>
  [...WORD_COMMENT_OPS, "other" as const]
    .map((op) => ({
      op,
      count: changes.filter((change) => change === op).length,
    }))
    .filter(({ count }) => count > 0);
