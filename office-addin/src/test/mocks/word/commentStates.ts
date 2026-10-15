import { wordPlanCommentThreads } from "@erato/frontend/word-review";

import { currentWordOoxmlHost } from "./ooxmlHost";
import { parseWordXml } from "../../../word/utils/wordDocumentPackageCodec";

import type { WordCommentThreadState } from "../../../word/utils/wordPlanCommentCheck";

/**
 * What Word lists as comment threads for the installed ooxmlHost document, which has no Office.js
 * comment collection of its own: its package's threads, named by Comment.id, or by w:id in a file
 * without durableIds.
 */
export async function ooxmlHostCommentStates(): Promise<
  WordCommentThreadState[] | null
> {
  const host = currentWordOoxmlHost();
  if (!host) return null;
  const id = (entry: { commentId: string | null; wId: string }) =>
    entry.commentId ?? `w${entry.wId}`;
  return Promise.resolve(
    wordPlanCommentThreads(parseWordXml(host.ooxml())).map((thread) => ({
      id: id(thread),
      resolved: thread.resolved,
      author: thread.author,
      content: thread.text,
      replies: thread.replies.map((reply) => ({
        id: id(reply),
        author: reply.author,
        content: reply.text,
      })),
    })),
  );
}
