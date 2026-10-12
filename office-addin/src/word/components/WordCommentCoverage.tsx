import { AnchoredPopover } from "@erato/frontend/library";
import { WORD_COMMENT_NEAR_LIMIT } from "@erato/frontend/word-review";
import { plural, t } from "@lingui/core/macro";
import { useState } from "react";

import { ACTION_BUTTON_CLASS } from "../../core/clientActions/clientActionButtonStyles";

import type { WordCommentList } from "../hooks/useWordComments";
import type { WordCommentSendPlan } from "../utils/wordCommentSend";

/** What one message carries of the document's comments (contract §7–§8). */
export type WordCommentCoverageSent =
  | { kind: "selection"; threads: number }
  | { kind: "thread"; author: string }
  | { kind: "open-comments"; threads: number }
  | { kind: "map"; threads: number };

export interface WordCommentCoverageInfo {
  sent: WordCommentCoverageSent;
  /**
   * What word_read_comments may read without another gesture: the nearest threads, or any thread
   * once the document is included, a thread is picked or "Include open comments" is on.
   */
  nearby: "near" | "document";
  /** Threads whose text this message does not carry. */
  rest: number;
}

/**
 * The popover's facts for one message's plan, from the live list; null when the message carries no
 * comment. The nearby reach mirrors word_read_comments' gestures (contract §7).
 */
export function wordCommentCoverageInfo(
  plan: WordCommentSendPlan,
  list: WordCommentList,
  gestures: { document: boolean; picked: boolean; openComments: boolean },
): WordCommentCoverageInfo | null {
  const total = list.threads.length + list.unplaced;
  const nearby: WordCommentCoverageInfo["nearby"] =
    gestures.document || gestures.picked || gestures.openComments
      ? "document"
      : "near";
  const { carrier } = plan;
  const of = (
    sent: WordCommentCoverageSent,
    threads: number,
  ): WordCommentCoverageInfo => ({
    sent,
    nearby,
    rest: Math.max(0, total - threads),
  });
  switch (carrier.kind) {
    case "selection":
      return carrier.threads.length > 0
        ? of(
            { kind: "selection", threads: carrier.threads.length },
            carrier.threads.length,
          )
        : null;
    case "thread": {
      const thread = list.threads.find((t) => t.ref === carrier.ref);
      return thread ? of({ kind: "thread", author: thread.author }, 1) : null;
    }
    case "open-comments":
      return of(
        { kind: "open-comments", threads: list.counts.open },
        list.counts.open,
      );
    case "map":
      return total > 0 ? of({ kind: "map", threads: total }, total) : null;
    case "none":
      return null;
  }
}

function sentText(sent: WordCommentCoverageSent): string {
  switch (sent.kind) {
    case "selection": {
      const { threads } = sent;
      return t({
        id: "officeAddin.word.comments.coverage.sentSelection",
        message: plural(threads, {
          one: "The comment in your selection, with its replies.",
          other: "The # comments in your selection, with their replies.",
        }),
      });
    }
    case "thread": {
      const { author } = sent;
      return t({
        id: "officeAddin.word.comments.coverage.sentThread",
        message: `The comment by ${author}, with its replies.`,
      });
    }
    case "open-comments": {
      const { threads } = sent;
      return t({
        id: "officeAddin.word.comments.coverage.sentOpen",
        message: plural(threads, {
          one: "The open comment in the document, with its replies.",
          other: "The # open comments in the document, with their replies.",
        }),
      });
    }
    case "map": {
      const { threads } = sent;
      return t({
        id: "officeAddin.word.comments.coverage.sentMap",
        message: plural(threads, {
          one: "A list of the comment in the document: its author, place, status and how it starts.",
          other:
            "A list of the # comments in the document: each one's author, place, status and how it starts.",
        }),
      });
    }
  }
}

function nearbyText(nearby: WordCommentCoverageInfo["nearby"]): string {
  const limit = WORD_COMMENT_NEAR_LIMIT;
  return nearby === "document"
    ? t({
        id: "officeAddin.word.comments.coverage.nearbyDocument",
        message:
          "If your question needs them, Erato may read the other comments in the document.",
      })
    : t({
        id: "officeAddin.word.comments.coverage.nearbyNear",
        message: `If your question needs them, Erato may read up to ${limit} comments above and ${limit} below your selection.`,
      });
}

/** The coverage popover's lines; the text of no comment and no address. */
export function wordCommentCoverageLines(
  info: WordCommentCoverageInfo,
): string[] {
  const { rest } = info;
  return [
    sentText(info.sent),
    nearbyText(info.nearby),
    ...(rest > 0
      ? [
          t({
            id: "officeAddin.word.comments.coverage.rest",
            message: plural(rest, {
              one: "# other comment is not sent.",
              other: "# other comments are not sent.",
            }),
          }),
        ]
      : []),
    t({
      id: "officeAddin.word.comments.coverage.resolved",
      message:
        "Resolved comments are sent only when they are in your selection or when you ask for them.",
    }),
    t({
      id: "officeAddin.word.comments.coverage.emails",
      message: "Email addresses of comment authors are never sent.",
    }),
  ];
}

/** "What is sent": what this message carries, what Erato may read, and the rest. */
export function WordCommentCoverage({
  info,
}: {
  info: WordCommentCoverageInfo;
}) {
  const [open, setOpen] = useState(false);
  const title = t({
    id: "officeAddin.word.comments.coverage.trigger",
    message: "What is sent",
  });
  return (
    <AnchoredPopover
      isOpen={open}
      onOpenChange={setOpen}
      role="dialog"
      ariaHasPopup="dialog"
      ariaLabel={title}
      width="wide"
      preferredOrientation={{ vertical: "top", horizontal: "left" }}
      panelClassName="p-3"
      dataUi="word-comment-coverage"
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          className={ACTION_BUTTON_CLASS}
          data-testid="word-comment-coverage-trigger"
        >
          {title}
        </button>
      )}
    >
      <ul
        className="space-y-1.5 text-xs text-theme-fg-secondary"
        data-testid="word-comment-coverage"
      >
        {wordCommentCoverageLines(info).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </AnchoredPopover>
  );
}
