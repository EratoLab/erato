import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Word comment changes (contract §9, ERMAIN-949): the submission tool the model proposes them
 * through, the three registered actions a card runs them under, and the row outcomes the card and
 * its receipt report. Shared with the Erato web app, which renders stored submissions read-only.
 */

export const WORD_SUBMIT_COMMENT_CHANGES_TOOL = "word_submit_comment_changes";

export type WordCommentAction =
  | "word.add_comments"
  | "word.respond_to_comments"
  | "word.modify_comments";

export const WORD_COMMENT_ACTIONS: readonly WordCommentAction[] = [
  "word.add_comments",
  "word.respond_to_comments",
  "word.modify_comments",
];

export type WordCommentOp =
  | "add"
  | "reply"
  | "resolve"
  | "reopen"
  | "edit"
  | "delete";

export const WORD_COMMENT_OPS: readonly WordCommentOp[] = [
  "add",
  "reply",
  "resolve",
  "reopen",
  "edit",
  "delete",
];

export const WORD_COMMENT_OP_ACTION: Readonly<
  Record<WordCommentOp, WordCommentAction>
> = {
  add: "word.add_comments",
  reply: "word.respond_to_comments",
  resolve: "word.respond_to_comments",
  reopen: "word.respond_to_comments",
  edit: "word.modify_comments",
  delete: "word.modify_comments",
};

/** The class key the host × action matrix and the row caps use. */
export type WordCommentActionClass = "add" | "respond" | "modify";

export const WORD_COMMENT_ACTION_CLASS: Readonly<
  Record<WordCommentAction, WordCommentActionClass>
> = {
  "word.add_comments": "add",
  "word.respond_to_comments": "respond",
  "word.modify_comments": "modify",
};

export interface WordCommentOpMeta {
  /** Removes or overwrites what someone wrote. */
  destructive: boolean;
  /** Running it twice leaves the document as running it once. */
  idempotent: boolean;
  /** Erato's Revert can undo it. */
  reversible: boolean;
  /** It can change a thread or text another author owns. */
  touchesOthers: boolean;
}

export const WORD_COMMENT_OP_META: Readonly<
  Record<WordCommentOp, WordCommentOpMeta>
> = {
  add: {
    destructive: false,
    idempotent: false,
    reversible: true,
    touchesOthers: false,
  },
  reply: {
    destructive: false,
    idempotent: false,
    reversible: true,
    touchesOthers: true,
  },
  resolve: {
    destructive: false,
    idempotent: true,
    reversible: true,
    touchesOthers: true,
  },
  reopen: {
    destructive: false,
    idempotent: true,
    reversible: true,
    touchesOthers: true,
  },
  edit: {
    destructive: true,
    idempotent: true,
    reversible: true,
    touchesOthers: true,
  },
  delete: {
    destructive: true,
    idempotent: true,
    reversible: false,
    touchesOthers: true,
  },
};

/** Rows per card when the deployment sets no cap (contract §9.1: add 1–50). */
export const WORD_COMMENT_DEFAULT_ROW_CAPS: Readonly<
  Record<WordCommentActionClass, number>
> = { add: 50, respond: 20, modify: 20 };

/** Plain text, non-empty after trim, at most this many UTF-16 units (contract §9.2). */
export const WORD_COMMENT_TEXT_MAX = 2000;

export const WORD_COMMENT_DEFAULT_LABEL = "Erato AI:";
export const WORD_COMMENT_DEFAULT_ASSISTANT_AUTHOR = "Erato (AI) for {user}";
/** The expanded AI-author name Word shows, at most (contract §9.6). */
export const WORD_COMMENT_ASSISTANT_AUTHOR_MAX = 120;

/** Errors the model can repair in the same turn; any other ends the submission. */
export const WORD_COMMENT_REPAIRABLE_ERRORS = [
  "unknown-ref",
  "quote-not-found",
  "quote-ambiguous",
  "position-unknown",
  "reply-ref-for-reply",
  "empty-text",
  "mixed-action-classes",
  "invalid-text",
  "label-in-text",
  "invalid-change",
  "too-many-rows",
  "duplicate-target",
  "reopen-first",
  "thread-not-read",
  "thread-read-only",
  "selection-unavailable",
  "paragraph-changed",
  "unsupported-anchor",
] as const;

export type WordCommentRepairableError =
  (typeof WORD_COMMENT_REPAIRABLE_ERRORS)[number];

export type WordCommentRowStatus =
  /** Written and read back in a fresh run. */
  | "applied"
  /** AI-author mode was asked for; the comment stands under the user's name with the label. */
  | "applied_as_user"
  /** Already in the requested state; nothing was written. */
  | "unchanged"
  /** Nothing was written; the code says why. */
  | "refused"
  /** Proven absent after a failed write, or the run ended before writing. */
  | "failed"
  /** A write was queued but could not be confirmed; never retried. */
  | "unverified";

export const WORD_COMMENT_REFUSAL_CODES = [
  "THREAD_NOT_FOUND",
  "REPLY_NOT_FOUND",
  "THREAD_AMBIGUOUS",
  "THREAD_CHANGED",
  "NEW_ACTIVITY",
  "STATE_CHANGED",
  "TARGET_TEXT_MISMATCH",
  "TARGET_NOT_FOUND",
  "AMBIGUOUS_TARGET",
  "TARGET_RANGE_UNPROVEN",
  "UNSUPPORTED_STORY",
  "DOCUMENT_READ_ONLY",
  "HOST_NOT_ALLOWED",
  "IDENTITY_MISMATCH",
  "DEPENDENCY_NOT_MET",
  "DESELECTED",
  "AUTHOR_MODE_UNAVAILABLE",
  "COPY_ONLY",
  /** Word for the web would unhide hidden text in the comment's paragraph (ERMAIN-949 gate W1). */
  "HIDDEN_TEXT",
] as const;

export type WordCommentRefusalCode =
  (typeof WORD_COMMENT_REFUSAL_CODES)[number];

/** Kept apart from row states: a declined card wrote nothing, but no row was refused. */
export type WordCommentConsentState =
  | "approved"
  | "declined"
  | "dismissed"
  | "expired";

export type WordCommentConsentKind = "click" | "standing_grant";

export type WordCommentAuthorMode = "user" | "assistant";

/** A row as the receipt keeps it: refs and codes, never comment text or names. */
export interface WordCommentOutcomeRow {
  i: number;
  op: WordCommentOp;
  /** The thread or entry ref the row targets; absent for an add. */
  ref?: string;
  status: WordCommentRowStatus;
  code?: WordCommentRefusalCode | string;
  /** The ref a new comment or reply goes by. */
  newRef?: string;
  /** String(Comment.id) of what the row wrote; modern files only (O-16). */
  commentId?: string;
}

/** Contract §9.8 (D-42): one per proposal, content-free; a pane receipt until ERMAIN-918. */
export interface WordCommentOutcomeRecord {
  action: WordCommentAction;
  draftId: string;
  host: string;
  consent: WordCommentConsentState;
  consentKind: WordCommentConsentKind | null;
  authorModeRequested: WordCommentAuthorMode | null;
  authorModeApplied: WordCommentAuthorMode | "mixed" | null;
  label: string;
  rows: WordCommentOutcomeRow[];
}

/**
 * The tool's parameters for ERMAIN-951, shaped for strict tool calling: every property required and
 * nullable, no oneOf. The add-in also takes the contract's short forms (`"anchor":"selection"`,
 * omitted properties); its validator, not the schema, decides.
 */
export const WORD_SUBMIT_COMMENT_CHANGES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["changes"],
  properties: {
    changes: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "anchor", "thread", "target", "text"],
        properties: {
          op: { type: "string", enum: [...WORD_COMMENT_OPS] },
          anchor: {
            type: ["object", "null"],
            description:
              "add only: the user's selection, or a quote in a numbered paragraph.",
            additionalProperties: false,
            required: ["selection", "para", "through", "quote", "occurrence"],
            properties: {
              selection: { type: ["boolean", "null"] },
              para: { type: ["integer", "null"], minimum: 1 },
              through: { type: ["integer", "null"], minimum: 1 },
              quote: { type: ["string", "null"] },
              occurrence: { type: ["integer", "null"], minimum: 1 },
            },
          },
          thread: {
            type: ["string", "null"],
            description: "reply, resolve, reopen: the thread ref, e.g. t7k.",
          },
          target: {
            type: ["string", "null"],
            description:
              "edit, delete: t7k for the thread's comment (delete: the whole thread), t7k.2 for its second reply.",
          },
          text: {
            type: ["string", "null"],
            description:
              "add, reply, edit: plain text without any label; Erato adds the label.",
          },
        },
      },
    },
  },
} as const;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isWordCommentAction = (
  value: unknown,
): value is WordCommentAction =>
  WORD_COMMENT_ACTIONS.includes(value as WordCommentAction);

/** A word_submit_comment_changes call the host accepted; its draft_id is the call's id. */
export function isAcceptedWordCommentSubmission(part: ContentPart): boolean {
  if (
    part.content_type !== "tool_use" ||
    part.tool_name !== WORD_SUBMIT_COMMENT_CHANGES_TOOL ||
    part.status !== "success" ||
    typeof part.tool_call_id !== "string" ||
    !part.tool_call_id
  )
    return false;
  const output = part.output;
  return (
    object(output) &&
    output.status === "success" &&
    object(output.result) &&
    output.result.draft_id === part.tool_call_id &&
    isWordCommentAction(output.result.action)
  );
}

/** The one accepted submission of a message, if exactly one. */
export function acceptedWordCommentSubmission(
  content: readonly ContentPart[] | undefined,
): { toolCallId: string; action: WordCommentAction } | undefined {
  const accepted = (content ?? []).filter(isAcceptedWordCommentSubmission);
  if (accepted.length !== 1) return undefined;
  const part = accepted[0] as ContentPart & {
    tool_call_id: string;
    output: { result: { action: WordCommentAction } };
  };
  return {
    toolCallId: part.tool_call_id,
    action: part.output.result.action,
  };
}
