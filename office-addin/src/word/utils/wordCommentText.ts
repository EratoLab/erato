import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";

import type { WordCommentWhy } from "./wordCommentSend";
import type {
  WordCommentList,
  WordCommentListThread,
} from "../hooks/useWordComments";

/** Characters of the anchored text a quote shows; the rest is one click away in Word. */
export const WORD_COMMENT_CHIP_QUOTE_CHARS = 48;

export function wordCommentWhyText(why: WordCommentWhy): string {
  if (why === "chosen")
    return t({
      id: "officeAddin.word.comments.why.chosen",
      message: "Chosen by you",
    });
  if (why === "cursor")
    return t({
      id: "officeAddin.word.comments.why.cursor",
      message: "At your cursor",
    });
  return t({
    id: "officeAddin.word.comments.why.default",
    message: "Your default",
  });
}

/** The start of a long quote, cut at a space where one is near. */
export function wordCommentChipQuote(quote: string): string {
  const characters = Array.from(quote);
  if (characters.length <= WORD_COMMENT_CHIP_QUOTE_CHARS) return quote;
  const head = characters.slice(0, WORD_COMMENT_CHIP_QUOTE_CHARS).join("");
  const cut = head.lastIndexOf(" ");
  return `${cut > WORD_COMMENT_CHIP_QUOTE_CHARS / 2 ? head.slice(0, cut) : head} …`;
}

/** "Comment by Maya Krüger": the comment chip's label and its detail's title. */
export function wordCommentByText(author: string): string {
  return t({
    id: "officeAddin.word.comments.thread.title",
    message: `Comment by ${author}`,
  });
}

export function wordCommentThreadTitle(
  thread: Pick<WordCommentListThread, "author" | "replies">,
): string {
  const { author, replies } = thread;
  if (replies === null) return wordCommentByText(author);
  return t({
    id: "officeAddin.word.comments.thread.titleWithReplies",
    message: plural(replies, {
      0: `Comment by ${author}`,
      one: `Comment by ${author} · # reply`,
      other: `Comment by ${author} · # replies`,
    }),
  });
}

export const wordCommentUnknownText = () =>
  t({
    id: "officeAddin.word.comments.thread.unknown",
    message: "Chosen comment",
  });

/** Where the thread is, as Word shows it: the anchored text, never a paragraph number. */
export function wordCommentQuoteText(quote: string): string {
  if (!quote)
    return t({
      id: "officeAddin.word.comments.thread.point",
      message: "on a spot without highlighted text",
    });
  const shown = wordCommentChipQuote(quote);
  return t({
    id: "officeAddin.word.comments.thread.on",
    message: `on “${shown}”`,
  });
}

export function wordCommentSwitchToCommentText(author: string): string {
  return t({
    id: "officeAddin.word.comments.switchToComment",
    message: `Work on ${author}'s comment instead`,
  });
}

export const wordCommentSwitchToPassageText = () =>
  t({
    id: "officeAddin.word.comments.switchToPassage",
    message: "Use selected passage instead",
  });

export const wordCommentSendWithoutText = () =>
  t({
    id: "officeAddin.word.comments.sendWithout",
    message: "Send without comments",
  });

export const wordCommentChooseText = () =>
  t({
    id: "officeAddin.word.comments.choose",
    message: "Choose comment…",
  });

export const wordCommentDismissPickText = () =>
  t({
    id: "officeAddin.word.comments.dismissPick",
    message: "Remove the chosen comment",
  });

export const wordCommentIncludeText = () =>
  t({
    id: "officeAddin.word.comments.withAgain",
    message: "Include comments",
  });

export const wordCommentChangeDefaultText = () =>
  t({
    id: "officeAddin.word.comments.changeDefault",
    message: "Change default",
  });

export function wordCommentReadingText(
  progress: WordCommentList["progress"],
): string {
  if (!progress)
    return t({
      id: "officeAddin.word.send.readingComments",
      message: "Reading comments…",
    });
  const { done, total } = progress;
  return t({
    id: "officeAddin.word.comments.readingProgress",
    message: `Reading comments… ${done} of ${total}`,
  });
}

/** "3 of 12", drawn after "Reading comments…" and never announced. */
export function wordCommentReadingCountText({
  done,
  total,
}: {
  done: number;
  total: number;
}): string {
  return t({
    id: "officeAddin.word.comments.readingCount",
    message: `${done} of ${total}`,
  });
}

/** In the app's language, not the browser's, as every other date in the pane. */
export function wordCommentActivityText(date: Date | null): string {
  if (!date)
    return t({
      id: "officeAddin.word.comments.picker.timeUnknown",
      message: "time unknown",
    });
  return new Intl.DateTimeFormat(i18n.locale || undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function wordCommentRepliesText(replies: number | null): string | null {
  if (replies === null) return null;
  return t({
    id: "officeAddin.word.comments.picker.replies",
    message: plural(replies, {
      0: "no replies",
      one: "# reply",
      other: "# replies",
    }),
  });
}

export const wordCommentStatusText = (
  status: WordCommentListThread["status"],
) =>
  status === "open"
    ? t({
        id: "officeAddin.word.comments.picker.statusOpen",
        message: "Open",
      })
    : t({
        id: "officeAddin.word.comments.picker.statusResolved",
        message: "Resolved",
      });
