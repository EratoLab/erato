import { readPointerAll } from "./serverText";

import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** The operations a comment proposal stages; any other value is counted, never named. */
export const COMMENT_OPS = [
  "add",
  "reply",
  "resolve",
  "reopen",
  "edit",
  "delete",
] as const;
export type CommentOp = (typeof COMMENT_OPS)[number];

/**
 * What one of Erato's own proposal tools proposes, for the one line its trace
 * row shows. The proposal's own card carries the rest.
 */
export type OwnProposal =
  | { kind: "document" }
  /** One entry per change in call order; `other` for an operation this build has no word for. */
  | { kind: "comments"; changes: (CommentOp | "other")[] }
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

const isCommentOp = (value: unknown): value is CommentOp =>
  (COMMENT_OPS as readonly unknown[]).includes(value);

// Counted from the input, not the label's values, which stop at ten.
const commentChangesOf = (
  label: ToolCallLabel,
  input: unknown,
): (CommentOp | "other")[] => {
  const ops = label.items
    ?.flatMap((item) => item.fields ?? [])
    .find((field) => field.name === "op");
  return ops
    ? readPointerAll(input, ops.pointer).map((op) =>
        isCommentOp(op) ? op : "other",
      )
    : [];
};

/**
 * The proposal a label written by hand for one of Erato's own tools names, or
 * `undefined` for any other call, and for rows saved before such labels.
 */
export const ownProposalOf = (
  label: ToolCallLabel | null | undefined,
  input: unknown,
): OwnProposal | undefined => {
  if (label?.source !== "own_mapping") return undefined;
  const { action, object_kind: kind } = label;
  if (kind === "document" && action === "update") return { kind: "document" };
  if (
    kind === "comment" &&
    (action === "comment" || action === "update" || action === "delete")
  ) {
    return { kind: "comments", changes: commentChangesOf(label, input) };
  }
  if (kind === "email" && action === "send") return { kind: "email" };
  if (kind === "event" && action === "create") return { kind: "event" };
  return { kind: "action" };
};

/** How many changes of each operation a comment proposal holds, in operation order. */
export const commentOpCounts = (
  changes: readonly (CommentOp | "other")[],
): { op: CommentOp | "other"; count: number }[] =>
  [...COMMENT_OPS, "other" as const]
    .map((op) => ({
      op,
      count: changes.filter((change) => change === op).length,
    }))
    .filter(({ count }) => count > 0);
