import { plural, t } from "@lingui/core/macro";

import { commentOpCounts } from "./ownProposal";

import type { GistPhase } from "./gist";
import type { OwnProposal } from "./ownProposal";
import type { WordCommentOp } from "@/lib/wordReview/wordCommentChanges";

/**
 * The words of an Erato proposal's trace line, built from the call's verb,
 * kind and operation counts, never from what the proposal says. Kept under
 * `lib/` so the component registry does not put it on the kit surface.
 */

const commentsOf = (op: WordCommentOp | "other", count: number): string => {
  switch (op) {
    case "add":
      return t({
        id: "toolGist.proposal.comments.add",
        message: plural(count, {
          one: "a new comment",
          other: "# new comments",
        }),
      });
    case "reply":
      return t({
        id: "toolGist.proposal.comments.reply",
        message: plural(count, {
          one: "a reply to a comment",
          other: "replies to # comments",
        }),
      });
    case "resolve":
      return t({
        id: "toolGist.proposal.comments.resolve",
        message: plural(count, {
          one: "to resolve a comment",
          other: "to resolve # comments",
        }),
      });
    case "reopen":
      return t({
        id: "toolGist.proposal.comments.reopen",
        message: plural(count, {
          one: "to reopen a comment",
          other: "to reopen # comments",
        }),
      });
    case "edit":
      return t({
        id: "toolGist.proposal.comments.edit",
        message: plural(count, {
          one: "an edit to a comment",
          other: "edits to # comments",
        }),
      });
    case "delete":
      return t({
        id: "toolGist.proposal.comments.delete",
        message: plural(count, {
          one: "to delete a comment",
          other: "to delete # comments",
        }),
      });
    case "other":
      return t({
        id: "toolGist.proposal.comments.mixed",
        message: plural(count, {
          one: "a comment change",
          other: "# comment changes",
        }),
      });
  }
};

/** What the proposal is, as the object of "Proposed …". */
export const ownProposalObject = (proposal: OwnProposal): string => {
  switch (proposal.kind) {
    case "document":
      return t({
        id: "toolGist.proposal.document",
        message: "changes to the document",
      });
    case "comments": {
      const counts = commentOpCounts(proposal.changes);
      if (counts.length === 0)
        return t({
          id: "toolGist.proposal.comments.unknown",
          message: "comment changes",
        });
      // A batch of one known operation is named by it; any other by its size.
      return counts.length === 1
        ? commentsOf(counts[0].op, counts[0].count)
        : commentsOf("other", proposal.changes.length);
    }
    case "email":
      return t({ id: "toolGist.proposal.email", message: "an email" });
    case "event":
      return t({ id: "toolGist.proposal.event", message: "an appointment" });
    case "action":
      return t({ id: "toolGist.proposal.action", message: "an action" });
  }
};

/** One operation's count in a mixed batch, e.g. "2 resolved". */
export const commentOpCount = (op: WordCommentOp, count: number): string => {
  switch (op) {
    case "add":
      return t({
        id: "toolGist.proposal.count.add",
        message: plural(count, { one: "# new", other: "# new" }),
      });
    case "reply":
      return t({
        id: "toolGist.proposal.count.reply",
        message: plural(count, { one: "# reply", other: "# replies" }),
      });
    case "resolve":
      return t({
        id: "toolGist.proposal.count.resolve",
        message: plural(count, { one: "# resolved", other: "# resolved" }),
      });
    case "reopen":
      return t({
        id: "toolGist.proposal.count.reopen",
        message: plural(count, { one: "# reopened", other: "# reopened" }),
      });
    case "edit":
      return t({
        id: "toolGist.proposal.count.edit",
        message: plural(count, { one: "# edited", other: "# edited" }),
      });
    case "delete":
      return t({
        id: "toolGist.proposal.count.delete",
        message: plural(count, { one: "# deleted", other: "# deleted" }),
      });
  }
};

/** One change of a mixed batch, as its own row. */
export const commentChangeRow = (op: WordCommentOp | "other"): string => {
  switch (op) {
    case "add":
      return t({ id: "toolGist.proposal.change.add", message: "New comment" });
    case "reply":
      return t({ id: "toolGist.proposal.change.reply", message: "Reply" });
    case "resolve":
      return t({ id: "toolGist.proposal.change.resolve", message: "Resolve" });
    case "reopen":
      return t({ id: "toolGist.proposal.change.reopen", message: "Reopen" });
    case "edit":
      return t({ id: "toolGist.proposal.change.edit", message: "Edit" });
    case "delete":
      return t({ id: "toolGist.proposal.change.delete", message: "Delete" });
    case "other":
      return t({
        id: "toolGist.proposal.change.other",
        message: "Other change",
      });
  }
};

/** The changes of a long mixed batch past the rows its toggle lists. */
export const commentChangesMore = (more: number): string =>
  t({
    id: "toolGist.more",
    message: plural(more, { one: "+# more", other: "+# more" }),
  });

/** Whether a comment proposal mixes operations, so it lists one row per change. */
export const isMixedCommentProposal = (proposal: OwnProposal): boolean =>
  proposal.kind === "comments" && commentOpCounts(proposal.changes).length > 1;

/**
 * The proposal's line for a trace row, before the user decided, after the
 * host staged it, or after it could not; a mixed batch adds its counts.
 */
export const ownProposalLine = (
  proposal: OwnProposal,
  phase: GistPhase,
): string => {
  const what = ownProposalObject(proposal);
  const line =
    phase === "done"
      ? t({ id: "toolGist.proposal.done", message: `Proposed ${what}` })
      : phase === "failed"
        ? t({
            id: "toolGist.proposal.failed",
            message: `Could not propose ${what}`,
          })
        : t({ id: "toolGist.proposal.ask", message: `Propose ${what}` });
  if (proposal.kind !== "comments" || !isMixedCommentProposal(proposal)) {
    return line;
  }
  const counts = commentOpCounts(proposal.changes).flatMap(({ op, count }) =>
    op === "other" ? [] : [commentOpCount(op, count)],
  );
  return [line, ...counts].join(" · ");
};
