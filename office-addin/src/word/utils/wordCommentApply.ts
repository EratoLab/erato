import {
  recordWordCommentOutcome,
  wordCommentOutcomeRecord,
} from "./wordCommentCard";

import type { WordClientActionEntry } from "./wordClientActions";
import type { WordCommentDraft } from "./wordCommentChanges";
import type { WordCommentsCapture } from "./wordCommentSend";
import type { WordCommentRowResult } from "./wordCommentWrites";
import type { WordCommentCardState, WordReviewState } from "./wordReviewState";
import type { WordCommentConsentKind } from "@erato/frontend/word-review";

/** The document a checked draft belongs to, for a write with no copy of its request. */
export const wordDraftCapture = (identity: string): WordCommentsCapture => ({
  identity,
  ordinalMap: new Map(),
  paragraphsSent: 0,
  renderedOrdinals: new Set(),
  partialOrdinal: null,
});

/** What a comment write needs from the pane: its review and Word's one operation. */
export interface WordCommentApplyHost {
  updateReview: (key: string, patch: Partial<WordReviewState>) => void;
  holdOperationUntil: (settled: Promise<void>, owner: string) => void;
  endOperation: () => void;
}

export type WordCommentApplyOutcome =
  | {
      kind: "ran";
      ok: boolean;
      state: WordCommentCardState;
      /** The written rows' results, without the rows the user left out. */
      rows: readonly WordCommentRowResult[];
    }
  | { kind: "no-result" }
  | { kind: "failed" };

/**
 * Writes the chosen rows of a checked comment draft, for the card and for the server's apply
 * alike. The caller has begun Word's operation; this ends it, or holds it while Word may still
 * be writing after a timeout. On "no-result" the caller says what the review shows.
 */
export async function runWordCommentApply({
  key,
  draft,
  entry,
  fenceContent,
  capture,
  reviewCapture,
  rows,
  assistantAuthor,
  userModeRows,
  previous,
  consentKind,
  host,
  onBeforeWrite,
}: {
  key: string;
  draft: WordCommentDraft;
  entry: WordClientActionEntry;
  fenceContent: string;
  capture: WordCommentsCapture;
  /** The copy the review keeps, when the card has one. */
  reviewCapture?: WordCommentsCapture;
  rows: readonly number[];
  assistantAuthor: string | null;
  userModeRows: ReadonlySet<number>;
  previous: WordCommentCardState;
  consentKind: WordCommentConsentKind;
  host: WordCommentApplyHost;
  onBeforeWrite?: () => void;
}): Promise<WordCommentApplyOutcome> {
  let held = false;
  host.updateReview(key, {
    status: "applying",
    ...(reviewCapture ? { capture: reviewCapture } : {}),
  });
  try {
    onBeforeWrite?.();
    const run = await entry.execute({
      fenceContent,
      capture,
      comments: {
        selected: new Set(rows),
        assistantAuthor,
        userModeRows: new Set(userModeRows),
      },
    });
    const result = run.commentResult;
    if (result?.timedOut) {
      // Word may still be writing: every card waits until the run has really ended.
      host.holdOperationUntil(result.settled, key);
      held = true;
    }
    if (!result) return { kind: "no-result" };
    const touched = new Map(
      result.rows
        .filter((row) => rows.includes(row.i))
        .map((row) => [row.i, row]),
    );
    const merged = draft.rows.map(
      (row) =>
        touched.get(row.i) ??
        previous.rows.find((r) => r.i === row.i) ?? {
          i: row.i,
          op: row.op,
          ...(row.ref ? { ref: row.ref } : {}),
          status: "refused" as const,
          code: "DESELECTED",
        },
    );
    const state: WordCommentCardState = {
      ...previous,
      rows: merged,
      consent: "approved",
      consentKind: previous.consentKind ?? consentKind,
    };
    host.updateReview(key, { status: "done", comments: state });
    recordWordCommentOutcome(
      wordCommentOutcomeRecord({
        draft,
        consent: "approved",
        consentKind: state.consentKind ?? null,
        rows: state.rows,
        authorModeRequested:
          draft.action === "word.add_comments" ? draft.authorMode : null,
      }),
    );
    return { kind: "ran", ok: run.ok, state, rows: [...touched.values()] };
  } catch {
    host.updateReview(key, { status: "write-failed" });
    return { kind: "failed" };
  } finally {
    if (!held) host.endOperation();
  }
}
