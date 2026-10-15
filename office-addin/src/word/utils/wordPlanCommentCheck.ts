import { readWordComments } from "./wordCommentReader";
import { wordHostPlatform } from "./wordHostPlatform";

import type { WordPlanCommentThread } from "@erato/frontend/word-review";

/**
 * Whether a written plan left the document's comment threads as planned (contract §13.1.3). Both
 * sides are Office.js lists from the ERMAIN-948 reader, because a multi-paragraph anchor has no
 * marks in a single paragraph's package (F-13); without package reads it calls no
 * Comment.getRange() on Word for the web (ERMAIN-983).
 */

export interface WordCommentThreadState {
  /** String(Comment.id). */
  id: string;
  resolved: boolean;
  author: string;
  content: string;
  /** In Word's order; null when the reader could not list them. */
  replies: { id: string; author: string; content: string }[] | null;
}

/** Counts only: content-free, for the card and the copyable report. */
export interface WordPlanCommentCheck {
  /** Threads the plan deleted, as the user confirmed. */
  removed: number;
  /** Threads the plan would delete that Word kept, as it does inside a tracked deletion. */
  kept: number;
  /** Threads deleted, added, resolved, reopened or given other replies without the plan. */
  unexpected: number;
  /** Word could not list the comments before or after the write, so nothing was compared. */
  unverified?: true;
}

const WEB_SETTLE_READS = 3;
const WEB_SETTLE_MS = 1_000;

export async function readWordCommentStates(): Promise<
  WordCommentThreadState[] | null
> {
  const read = await readWordComments({ replies: "all", packages: false });
  if (!read.ok) return null;
  return read.threads.map((thread) => ({
    id: thread.id,
    resolved: thread.resolved,
    author: thread.authorName,
    content: thread.content,
    replies:
      thread.replies?.map((reply) => ({
        id: reply.id,
        author: reply.authorName,
        content: reply.content,
      })) ?? null,
  }));
}

const text = (value: string) => value.replace(/\r\n?/g, "\n").trim();
const sameEntry = (
  a: { author: string; content: string },
  b: { author: string; content: string },
) => a.author === b.author && text(a.content) === text(b.content);

/** Office.js ids of the planned threads: by durableId, else by author and text (legacy files). */
export function plannedWordCommentIds(
  threads: readonly WordPlanCommentThread[],
  before: readonly WordCommentThreadState[],
): Set<string> {
  const ids = new Set(before.map((state) => state.id));
  const planned = new Set<string>();
  for (const thread of threads) {
    if (thread.commentId && ids.has(thread.commentId)) {
      planned.add(thread.commentId);
      continue;
    }
    const match = before.find(
      (state) =>
        !planned.has(state.id) &&
        sameEntry(state, { author: thread.author, content: thread.text }),
    );
    if (match) planned.add(match.id);
  }
  return planned;
}

/**
 * A tracked cut and paste lists the moved comment twice, the copy under a new id (F-19): a new id
 * whose author and text match a listed thread is that thread's copy, and one matching a thread
 * that is gone is that thread, moved. Neither counts as a change.
 */
export function diffWordCommentStates(
  before: readonly WordCommentThreadState[],
  after: readonly WordCommentThreadState[],
  planned: ReadonlySet<string>,
): WordPlanCommentCheck {
  const was = new Map(before.map((state) => [state.id, state]));
  const now = new Map<string, WordCommentThreadState>();
  for (const state of after) if (!now.has(state.id)) now.set(state.id, state);
  const changed = new Set<string>();
  const moved = new Set<string>();
  const matched = new Set<string>();
  for (const [id, state] of now) {
    if (was.has(id)) continue;
    const origin = before.find(
      (candidate) => !matched.has(candidate.id) && sameEntry(candidate, state),
    );
    if (!origin) {
      changed.add(id);
      continue;
    }
    matched.add(origin.id);
    if (!now.has(origin.id)) moved.add(origin.id);
  }
  let removed = 0;
  let kept = 0;
  for (const [id, state] of was) {
    const current = now.get(id);
    if (planned.has(id)) {
      if (current) kept += 1;
      else if (!moved.has(id)) removed += 1;
      continue;
    }
    if (!current) {
      if (!moved.has(id)) changed.add(id);
      continue;
    }
    if (
      current.resolved !== state.resolved ||
      (current.replies &&
        state.replies &&
        current.replies.map((r) => r.id).join() !==
          state.replies.map((r) => r.id).join())
    )
      changed.add(id);
  }
  return { removed, kept, unexpected: changed.size };
}

const pause = (ms: number) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

/**
 * Reads the threads after a write and compares them with `before`. Word for the web may list a
 * change a moment late, so there an unexpected difference is read again before it is reported.
 */
export async function checkWordPlanComments(
  before: readonly WordCommentThreadState[] | null,
  planned: readonly WordPlanCommentThread[],
  read: () => Promise<WordCommentThreadState[] | null>,
): Promise<WordPlanCommentCheck> {
  const unverified: WordPlanCommentCheck = {
    removed: 0,
    kept: 0,
    unexpected: 0,
    unverified: true,
  };
  if (!before) return unverified;
  const ids = plannedWordCommentIds(planned, before);
  const reads = wordHostPlatform() === "OfficeOnline" ? WEB_SETTLE_READS : 1;
  let check = unverified;
  for (let attempt = 0; attempt < reads; attempt += 1) {
    if (attempt) await pause(WEB_SETTLE_MS);
    const after = await read();
    check = after ? diffWordCommentStates(before, after, ids) : unverified;
    if (!check.unexpected && !check.unverified) break;
  }
  return check;
}
