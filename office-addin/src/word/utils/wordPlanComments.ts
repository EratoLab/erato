import {
  wordPlanCommentRemovals,
  wordPlanCommentThreads,
} from "@erato/frontend/word-review";

import { parseWordXml } from "./wordDocumentPackageCodec";

import type {
  WordAuthoringSnapshot,
  WordPlanCommentRemoval,
  WordPlanCommentThread,
} from "@erato/frontend/word-review";

export interface WordPlanCommentConsequences {
  /** The compiled plan's fingerprint, which the user's tick is bound to. */
  fingerprint: string;
  /** In document order, one per thread. */
  removals: readonly WordPlanCommentRemoval[];
  /** Every thread of the captured document, which a whole-document import rebuilds. */
  threads: readonly WordPlanCommentThread[];
}

const captured = new WeakMap<WordAuthoringSnapshot, WordPlanCommentThread[]>();

/** The capture's threads; parsed once per capture, and not at all for a document without comments. */
export function wordCapturedCommentThreads(
  snapshot: WordAuthoringSnapshot,
): readonly WordPlanCommentThread[] {
  if (!snapshot.stories?.some((story) => story.type === "comment")) return [];
  let threads = captured.get(snapshot);
  if (!threads) {
    threads = wordPlanCommentThreads(parseWordXml(snapshot.ooxml));
    captured.set(snapshot, threads);
  }
  return threads;
}

/** What a compiled plan does to the capture's comment threads; the card and Apply both ask this. */
export function wordPlanCommentConsequences(
  snapshot: WordAuthoringSnapshot,
  compiled: string,
  prepared: Pick<WordAuthoringSnapshot, "fingerprint">,
): WordPlanCommentConsequences {
  const threads = wordCapturedCommentThreads(snapshot);
  return {
    fingerprint: prepared.fingerprint,
    removals: threads.length
      ? wordPlanCommentRemovals(threads, parseWordXml(compiled))
      : [],
    threads,
  };
}
