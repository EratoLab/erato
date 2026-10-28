import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { useId, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Collapse } from "@/components/ui/Controls/Collapse";
import { DisclosureChevron } from "@/components/ui/Controls/DisclosureChevron";
import {
  WORD_ANCHORED_COMMENTS_ARG,
  WORD_COMMENT_MAP_ARG,
} from "@/lib/wordReview/wordCommentContext";

import type {
  WordCommentContextSummary,
  WordCommentEntry,
  WordCommentMapRow,
  WordCommentStatus,
  WordCommentThread,
  WordCommentWhy,
} from "@/lib/wordReview/wordCommentContext";

const commentsText = (count: number) =>
  t({
    id: "chat.message.action_facet.comments.count",
    message: plural(count, { one: "# comment", other: "# comments" }),
  });

const repliesText = (count: number) =>
  t({
    id: "chat.message.action_facet.comments.replies",
    message: plural(count, { one: "# reply", other: "# replies" }),
  });

const notShownText = (count: number) =>
  t({
    id: "chat.message.action_facet.comments.notShown",
    message: plural(count, { one: "# not shown", other: "# not shown" }),
  });

function whyText(why: WordCommentWhy): string {
  if (why === "chosen")
    return t({
      id: "chat.message.action_facet.comments.why.chosen",
      message: "Chosen by you",
    });
  if (why === "cursor")
    return t({
      id: "chat.message.action_facet.comments.why.cursor",
      message: "At your cursor",
    });
  return t({
    id: "chat.message.action_facet.comments.why.default",
    message: "Your default",
  });
}

const rootOf = (thread: WordCommentThread) =>
  thread.entries.find((entry) => entry.n === 0) ?? thread.entries[0];

/** What the request carried, as counts and the picked thread's author; null when it carried no comment. */
function sentContextParts(context: WordCommentContextSummary): string[] | null {
  const { envelope, picked } = context;
  const listed = context.threads.length + (envelope?.index.length ?? 0);
  if (context.carrier === WORD_ANCHORED_COMMENTS_ARG) {
    if (listed === 0) return null;
    return [
      t({
        id: "chat.message.action_facet.comments.passage",
        message: "Selected passage",
      }),
      commentsText(listed),
    ];
  }
  if (context.carrier === WORD_COMMENT_MAP_ARG) {
    const notShown = context.notShown;
    if (listed + notShown === 0) return null;
    return [
      t({
        id: "chat.message.action_facet.comments.map",
        message: "Comment map",
      }),
      t({
        id: "chat.message.action_facet.comments.threads",
        message: plural(listed, { one: "# thread", other: "# threads" }),
      }),
      ...(notShown > 0 ? [notShownText(notShown)] : []),
    ];
  }
  if (picked) {
    const author = rootOf(picked).by;
    const replies = picked.entries.length - 1 + (picked.omitted_replies ?? 0);
    return [
      t({
        id: "chat.message.action_facet.comments.thread",
        message: `Comment by ${author}`,
      }),
      ...(replies > 0 ? [repliesText(replies)] : []),
      ...(envelope?.why ? [whyText(envelope.why)] : []),
    ];
  }
  // An empty thread_json: "Include open comments" sent the open threads, so resolved ones are not missing.
  const notShown = Math.max(0, (envelope?.coverage.open ?? 0) - listed);
  if (listed + notShown === 0) return null;
  return [
    t({
      id: "chat.message.action_facet.comments.open",
      message: "Open comments",
    }),
    commentsText(listed),
    ...(notShown > 0 ? [notShownText(notShown)] : []),
  ];
}

/** Whether the request carried any comment the "Sent context" line can name. */
export const wordCommentContextSent = (
  context: WordCommentContextSummary,
): boolean => sentContextParts(context) !== null;

function timeText(at: string | null): string {
  const date = at === null ? null : new Date(at);
  // A time without a zone is the author's own clock, so it shows as written.
  return date && !Number.isNaN(date.getTime())
    ? i18n.date(date, { dateStyle: "medium", timeStyle: "short" })
    : t({
        id: "chat.message.action_facet.comments.timeUnknown",
        message: "time unknown",
      });
}

const statusText = (status: WordCommentStatus) =>
  status === "resolved"
    ? t({
        id: "chat.message.action_facet.comments.resolved",
        message: "Resolved",
      })
    : t({
        id: "chat.message.action_facet.comments.openStatus",
        message: "Open",
      });

/** Null when the read had no anchored text, as Word for the web without packages. */
function quoteText(quote: string, point = false): string | null {
  if (point)
    return t({
      id: "chat.message.action_facet.comments.point",
      message: "on a spot without highlighted text",
    });
  if (!quote) return null;
  return t({
    id: "chat.message.action_facet.comments.on",
    message: `on “${quote}”`,
  });
}

const META_CLASS = "text-xs text-theme-fg-muted";
const AUTHOR_CLASS = "font-medium text-theme-fg-secondary";
const TEXT_CLASS = "whitespace-pre-line text-sm text-theme-fg-secondary";

function EntryView({ entry }: { entry: WordCommentEntry }) {
  return (
    <li data-testid="word-comment-entry">
      <div className={META_CLASS}>
        <span className={AUTHOR_CLASS}>{entry.by}</span>
        {" · "}
        {timeText(entry.at)}
      </div>
      <p className={TEXT_CLASS}>{entry.text}</p>
    </li>
  );
}

function ThreadView({ thread }: { thread: WordCommentThread }) {
  const [root, ...replies] = thread.entries;
  const omitted = thread.omitted_replies ?? 0;
  const where = quoteText(thread.where.quote, thread.where.point);
  return (
    <li className="flex flex-col gap-1" data-testid="word-comment-thread">
      <div className={META_CLASS}>
        <span className={AUTHOR_CLASS}>{statusText(thread.status)}</span>
        {where && (
          <>
            {" · "}
            <span className="line-clamp-2">{where}</span>
          </>
        )}
        {thread.matched_by_content &&
          ` · ${t({
            id: "chat.message.action_facet.comments.matchedByContent",
            message: "matched by content",
          })}`}
      </div>
      <ol className="flex flex-col gap-1 border-l border-theme-border pl-2">
        <EntryView entry={root} />
        {omitted > 0 && (
          <li className={META_CLASS}>
            {t({
              id: "chat.message.action_facet.comments.omittedReplies",
              message: plural(omitted, {
                one: "# earlier reply was not sent",
                other: "# earlier replies were not sent",
              }),
            })}
          </li>
        )}
        {replies.map((entry) => (
          <EntryView key={entry.n} entry={entry} />
        ))}
        {thread.replies_unread && (
          <li className={META_CLASS}>
            {t({
              id: "chat.message.action_facet.comments.repliesUnread",
              message: "Its replies were not read.",
            })}
          </li>
        )}
      </ol>
    </li>
  );
}

function MapRowView({ row }: { row: WordCommentMapRow }) {
  const replies = row.r ?? 0;
  return (
    <li className="flex flex-col gap-0.5" data-testid="word-comment-map-row">
      <div className={META_CLASS}>
        <span className={AUTHOR_CLASS}>{row.by}</span>
        {" · "}
        {statusText(row.st)}
        {replies > 0 && ` · ${repliesText(replies)}`}
        {" · "}
        {timeText(row.at)}
      </div>
      {row.sec && <div className={META_CLASS}>{row.sec}</div>}
      {row.q && (
        <div className={`line-clamp-2 ${META_CLASS}`}>{quoteText(row.q)}</div>
      )}
      {row.g && <p className={TEXT_CLASS}>{row.g}</p>}
    </li>
  );
}

/**
 * The "Sent context" line under a sent Word request that carried comments, and the comments
 * themselves behind a toggle, read-only. Comment text is other people's text: it renders as plain
 * text, never as markdown.
 */
export function WordCommentSentContext({
  context,
}: {
  context: WordCommentContextSummary;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const parts = sentContextParts(context);
  if (!parts) return null;
  const summary = parts.join(" · ");
  const rows = context.envelope?.index ?? [];
  const hasComments = context.threads.length + rows.length > 0;
  return (
    <div data-testid="word-comment-sent-context">
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-theme-fg-muted">
        <span>
          {t({
            id: "chat.message.action_facet.comments.sentContext",
            message: `Sent context: ${summary}`,
          })}
        </span>
        {hasComments && (
          <Button
            type="button"
            variant="ghost"
            aria-expanded={open}
            aria-controls={id}
            icon={<DisclosureChevron open={open} />}
            onClick={() => setOpen(!open)}
          >
            {open
              ? t({
                  id: "chat.message.action_facet.comments.hide",
                  message: "Hide comments",
                })
              : t({
                  id: "chat.message.action_facet.comments.show",
                  message: "Show comments",
                })}
          </Button>
        )}
      </div>
      {hasComments && (
        <Collapse isOpen={open}>
          <div id={id}>
            {open && (
              <ol className="mt-1 flex flex-col gap-2">
                {context.threads.map((thread) => (
                  <ThreadView key={thread.id} thread={thread} />
                ))}
                {rows.map((row) => (
                  <MapRowView key={row.id} row={row} />
                ))}
              </ol>
            )}
          </div>
        </Collapse>
      )}
    </div>
  );
}
