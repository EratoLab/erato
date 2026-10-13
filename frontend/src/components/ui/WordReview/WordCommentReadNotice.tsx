import { plural, t } from "@lingui/core/macro";
import { useMemo } from "react";

import { ChatBubbleIcon } from "@/components/ui/icons";
import { wordCommentReadRows } from "@/lib/wordReview/wordCommentReads";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { WordCommentReadRow } from "@/lib/wordReview/wordCommentReads";

function readText(row: Extract<WordCommentReadRow, { state: "read" }>) {
  const { count } = row;
  if (row.view === "near")
    return t({
      id: "chat.message.wordCommentRead.near",
      message: plural(count, {
        one: "Read # nearby comment",
        other: "Read # nearby comments",
      }),
    });
  if (row.view === "section")
    return t({
      id: "chat.message.wordCommentRead.section",
      message: plural(count, {
        one: "Read # comment in a section",
        other: "Read # comments in a section",
      }),
    });
  if (row.view === "map")
    return t({
      id: "chat.message.wordCommentRead.map",
      message: plural(count, {
        one: "Read the comment map: # thread",
        other: "Read the comment map: # threads",
      }),
    });
  if (row.status === "open")
    return t({
      id: "chat.message.wordCommentRead.open",
      message: plural(count, {
        one: "Read # open comment",
        other: "Read # open comments",
      }),
    });
  if (row.status === "resolved")
    return t({
      id: "chat.message.wordCommentRead.resolved",
      message: plural(count, {
        one: "Read # resolved comment",
        other: "Read # resolved comments",
      }),
    });
  return t({
    id: "chat.message.wordCommentRead.all",
    message: plural(count, {
      one: "Read # comment",
      other: "Read # comments",
    }),
  });
}

function rowText(row: WordCommentReadRow): string {
  if (row.state === "failed")
    return t({
      id: "chat.message.wordCommentRead.failed",
      message: "Comments were not read",
    });
  const read = readText(row);
  const { notShown } = row;
  if (notShown === 0) return read;
  return `${read} · ${t({
    id: "chat.message.wordCommentRead.notShown",
    message: plural(notShown, { one: "# not shown", other: "# not shown" }),
  })}`;
}

/**
 * A row per word_read_comments call under the answer, so the user sees which comments Erato
 * read. Built from the calls' arguments and result counts, never from comment text or names.
 */
export function WordCommentReadNotice({
  content,
}: {
  content: readonly ContentPart[];
}) {
  const rows = useMemo(() => wordCommentReadRows(content), [content]);
  if (rows.length === 0) return null;
  return (
    <ul
      data-testid="word-comment-read-notice"
      className="mt-2 flex flex-col gap-1 text-xs text-theme-fg-muted"
    >
      {rows.map((row) => (
        <li
          key={row.toolCallId}
          data-testid="word-comment-read-row"
          data-state={row.state}
          className="flex items-start gap-2"
        >
          <ChatBubbleIcon
            className="mt-px size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span>{rowText(row)}</span>
        </li>
      ))}
    </ul>
  );
}
