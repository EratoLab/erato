import {
  WORD_COMMENT_ACTION_CLASS,
  WORD_COMMENT_OP_META,
} from "@erato/frontend/word-review";

import {
  WORD_COMMENT_HOST_DEFAULTS,
  wordCommentAssistantAuthorAvailable,
  wordCommentAssistantAuthorName,
  wordCommentHostKey,
  wordCommentSessionReason,
  wordCommentWriteMode,
} from "./wordCommentPolicy";

import type { WordCommentDraft } from "./wordCommentChanges";
import type { WordCommentRowResult } from "./wordCommentWrites";
import type { WordHostPlatform } from "./wordHostPlatform";
import type { WordTrackingMode } from "./wordReviewLocation";
import type {
  WordCommentAuthorMode,
  WordCommentConsentKind,
  WordCommentConsentState,
  WordCommentOutcomeRecord,
} from "@erato/frontend/word-review";

/** Why a new comment posts under the user's name though the setting asks for Erato (O-28). */
export type WordCommentUserModeReason =
  /** Word for the web keeps user mode until repeated clean runs (P-AUTH-1). */
  | "web"
  /** The deployment switched AI-author mode off, or this session did after a failure. */
  | "unavailable"
  /** Track Changes is on: the re-attribution would be tracked as the user's insertion (F-14). */
  | "tracking"
  /** An anchor across paragraphs has no marks in one paragraph's package (F-13). */
  | "anchor"
  /** The signed-in Erato user has no display name to put in the author. */
  | "no-name";

export interface WordCommentAuthorPlan {
  /** The name Word will show for AI-authored rows; null when every row posts as the user. */
  authorName: string | null;
  /** Rows that post under the user's name although the setting asks for Erato, and why. */
  userModeRows: ReadonlyMap<number, WordCommentUserModeReason>;
}

/** Decided before consent, so the card says which rows Word will show as the user's (O-28). */
export function wordCommentAuthorPlan(
  draft: WordCommentDraft,
  input: {
    host: WordHostPlatform;
    tracking: WordTrackingMode;
    principalName: string | null | undefined;
    template: string;
  },
): WordCommentAuthorPlan {
  const none = { authorName: null, userModeRows: new Map() };
  if (draft.action !== "word.add_comments" || draft.authorMode !== "assistant")
    return none;
  const everyRow = (reason: WordCommentUserModeReason) => ({
    authorName: null,
    userModeRows: new Map(draft.rows.map((row) => [row.i, reason])),
  });
  if (!WORD_COMMENT_HOST_DEFAULTS[input.host].assistantAuthor)
    return everyRow("web");
  if (!wordCommentAssistantAuthorAvailable(input.host))
    return everyRow("unavailable");
  if (input.tracking === "on") return everyRow("tracking");
  const name = wordCommentAssistantAuthorName(
    input.template,
    input.principalName,
  );
  if (!name) return everyRow("no-name");
  return {
    authorName: name,
    userModeRows: new Map(
      draft.rows
        .filter((row) => (row.add?.rangeTexts.length ?? 1) > 1)
        .map((row) => [row.i, "anchor" as const]),
    ),
  };
}

export type WordCommentAlwaysBlock =
  /**
   * L2: the request carried comment text by someone other than the user. It suspends Always for
   * every comment action, not only adds: a reply, resolve, edit or delete it prompted is no safer.
   */
  | "tainted"
  /** O-8: without a label nothing in the comment says Erato wrote it. */
  | "empty-label";

/** Why a standing grant may not post these comments now; null when Always may apply. */
export function wordCommentAlwaysBlock(
  draft: WordCommentDraft,
  tainted: boolean,
): WordCommentAlwaysBlock | null {
  if (tainted) return "tainted";
  if (draft.action !== "word.add_comments") return null;
  return draft.label ? null : "empty-label";
}

/** The class's mode on this host now: "copy" offers Copy comment and Show passage only. */
export const wordCommentCardMode = (draft: WordCommentDraft) =>
  wordCommentWriteMode(WORD_COMMENT_ACTION_CLASS[draft.action], draft.host);

export const wordCommentSessionSwitch = (draft: WordCommentDraft) =>
  wordCommentSessionReason(WORD_COMMENT_ACTION_CLASS[draft.action]);

export const wordCommentRowReversible = (row: WordCommentRowResult) =>
  !!row.revert && WORD_COMMENT_OP_META[row.op].reversible;

/** Contract §9.8: content-free, per proposal; a pane receipt until ERMAIN-918 persists it. */
export function wordCommentOutcomeRecord(input: {
  draft: WordCommentDraft;
  consent: WordCommentConsentState;
  consentKind: WordCommentConsentKind | null;
  rows: readonly WordCommentRowResult[];
  authorModeRequested: WordCommentAuthorMode | null;
}): WordCommentOutcomeRecord {
  const { draft } = input;
  const authors = new Set(
    input.rows.flatMap((row) => (row.author ? [row.author] : [])),
  );
  return {
    action: draft.action,
    draftId: draft.draftId,
    host: wordCommentHostKey(draft.host),
    consent: input.consent,
    consentKind: input.consentKind,
    authorModeRequested: input.authorModeRequested,
    authorModeApplied:
      authors.size === 0 ? null : authors.size > 1 ? "mixed" : [...authors][0],
    label: draft.label,
    rows: input.rows.map((row) => ({
      i: row.i,
      op: row.op,
      ...(row.ref ? { ref: row.ref } : {}),
      status: row.status,
      ...(row.code ? { code: row.code } : {}),
      ...(row.newRef ? { newRef: row.newRef } : {}),
      // O-16: a legacy file's ids hold for one pane session only.
      ...(row.commentId && !draft.legacy ? { commentId: row.commentId } : {}),
    })),
  };
}

const receipts: WordCommentOutcomeRecord[] = [];

/** Kept in pane memory for the card's receipt and, once ERMAIN-918 lands, for persistence. */
export function recordWordCommentOutcome(
  record: WordCommentOutcomeRecord,
): void {
  const at = receipts.findIndex((r) => r.draftId === record.draftId);
  if (at >= 0) receipts[at] = record;
  else receipts.push(record);
}

export const wordCommentReceipts = (): readonly WordCommentOutcomeRecord[] =>
  receipts;
