import { plural, t } from "@lingui/core/macro";

import type {
  WordPlanCommentRemoval,
  WordPlanCommentThread,
} from "@erato/frontend/word-review";

const QUOTE_CHARS = 80;

export function wordCommentQuote(quote: string, chars = QUOTE_CHARS): string {
  return quote.length > chars
    ? `${quote.slice(0, chars - 1).trimEnd()}…`
    : quote;
}

export function wordCommentRemovalsIntroText(count: number): string {
  return t({
    id: "officeAddin.word.planComments.intro",
    message: plural(count, {
      one: "Removing this text also deletes # comment thread, with its replies:",
      other:
        "Removing this text also deletes # comment threads, with their replies:",
    }),
  });
}

export function wordCommentRemovalsTickText(count: number): string {
  return t({
    id: "officeAddin.word.planComments.tick",
    message: plural(count, {
      one: "Also delete # comment thread",
      other: "Also delete # comment threads",
    }),
  });
}

export function wordCommentThreadStatusText(resolved: boolean): string {
  return resolved
    ? t({ id: "officeAddin.word.planComments.resolved", message: "Resolved" })
    : t({ id: "officeAddin.word.planComments.open", message: "Open" });
}

export function wordCommentRepliesText(count: number): string {
  return t({
    id: "officeAddin.word.planComments.replies",
    message: plural(count, {
      0: "No replies",
      one: "# reply",
      other: "# replies",
    }),
  });
}

export function wordCommentPointText(): string {
  return t({
    id: "officeAddin.word.planComments.point",
    message: "Comment on a single point",
  });
}

/** The web import keeps ids and threads but changes dates and reply flags (P-IMP, F-20). */
export function wordCommentRebuildText(count: number): string {
  return t({
    id: "officeAddin.word.planComments.rebuild",
    message: plural(count, {
      one: "Rebuilds # comment thread (dates and resolved flags may change).",
      other:
        "Rebuilds # comment threads (dates and resolved flags may change).",
    }),
  });
}

/** Appended to the user's request, so the model keeps the anchors of the threads it would delete. */
export function wordKeepCommentedPassagesText(
  removals: readonly WordPlanCommentRemoval[],
): string {
  const passages = removals
    .map(({ thread }) =>
      thread.quote
        ? `“${wordCommentQuote(thread.quote, 60)}”`
        : t({
            id: "officeAddin.word.planComments.keepPoint",
            message: `the point commented by ${thread.author}`,
          }),
    )
    .join(", ");
  return t({
    id: "officeAddin.word.planComments.keepRequest",
    message: `Keep the passages these comments are attached to, so their comment threads stay: ${passages}.`,
  });
}

export function wordKeepCommentedPassagesNote(): string {
  return t({
    id: "officeAddin.word.planComments.keepNote",
    message:
      "Your request is back in the message box, asking to keep the commented passages. Review it, then send.",
  });
}

/** Plain text for the clipboard: who wrote what, on which passage, and the replies. */
export function wordCommentThreadsCopyText(
  threads: readonly WordPlanCommentThread[],
): string {
  return threads
    .map((thread) => {
      const head = thread.quote
        ? t({
            id: "officeAddin.word.planComments.copyHead",
            message: `${thread.author} (${wordCommentThreadStatusText(thread.resolved)}) on “${thread.quote}”:`,
          })
        : t({
            id: "officeAddin.word.planComments.copyHeadPoint",
            message: `${thread.author} (${wordCommentThreadStatusText(thread.resolved)}):`,
          });
      const replies = thread.replies.map((reply) =>
        t({
          id: "officeAddin.word.planComments.copyReply",
          message: `  Reply from ${reply.author}: ${reply.text}`,
        }),
      );
      return [head, thread.text, ...replies].join("\n");
    })
    .join("\n\n");
}

export function wordCommentThreadsCopiedText(): string {
  return t({
    id: "officeAddin.word.planComments.copied",
    message: "Comment threads copied.",
  });
}

export function wordCommentThreadsCopyFailedText(): string {
  return t({
    id: "officeAddin.word.planComments.copyFailed",
    message: "The comment threads could not be copied.",
  });
}

/** After Apply: Word's Undo restores removed comments on desktop with their ids, the web's does not (F-16). */
export function wordCommentsChangedText(count: number, web: boolean): string {
  return web
    ? t({
        id: "officeAddin.word.planComments.changed.web",
        message: plural(count, {
          one: "Applied — # comment thread changed unexpectedly. Word for the web's Undo can't bring it back; restore an earlier version from Version History.",
          other:
            "Applied — # comment threads changed unexpectedly. Word for the web's Undo can't bring them back; restore an earlier version from Version History.",
        }),
      })
    : t({
        id: "officeAddin.word.planComments.changed",
        message: plural(count, {
          one: "Applied — # comment thread changed unexpectedly. Word's Undo brings a removed comment back.",
          other:
            "Applied — # comment threads changed unexpectedly. Word's Undo brings removed comments back.",
        }),
      });
}

export function wordCommentsUncheckedText(): string {
  return t({
    id: "officeAddin.word.planComments.unchecked",
    message:
      "Applied. Erato couldn't list the document's comments afterwards, so check them in Word.",
  });
}

export function wordCommentsDeletedText(count: number): string {
  return t({
    id: "officeAddin.word.planComments.deleted",
    message: plural(count, {
      one: "Deleted # comment thread, as you confirmed.",
      other: "Deleted # comment threads, as you confirmed.",
    }),
  });
}
