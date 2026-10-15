import { ChatBubbleIcon } from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";

import { WordCommentCoverage } from "./WordCommentCoverage";
import { WordShowInWordButton } from "./WordShowInWordButton";
import { ACTION_BUTTON_CLASS } from "../../core/clientActions/clientActionButtonStyles";
import { wordCommentMapListed } from "../utils/wordCommentMap";

import type { WordCommentCoverageInfo } from "./WordCommentCoverage";
import type {
  WordCommentList,
  WordCommentListThread,
} from "../hooks/useWordComments";
import type {
  WordCommentOverride,
  WordCommentSendPlan,
  WordCommentWhy,
} from "../utils/wordCommentSend";
import type { WordSelectionShowResult } from "../utils/wordSelectionTarget";
import type { ReactNode } from "react";

/** Characters of the anchored text the thread chip quotes; the rest is one click away in Word. */
export const WORD_COMMENT_CHIP_QUOTE_CHARS = 48;

/** What the composer shows of the next message's comments; the same §8 plan Send resolves. */
export type WordCommentChipView =
  | { kind: "none" }
  /** "Send without comments" holds for this message; comments would otherwise go. */
  | { kind: "without" }
  /** The passage goes with the threads that reach it. */
  | {
      kind: "passage";
      threads: readonly WordCommentListThread[];
      /** The one thread the switch would work on instead. */
      switchTo: WordCommentListThread | null;
      offerChoose: boolean;
      why: WordCommentWhy | null;
    }
  /** One thread goes instead of the passage or the document. */
  | {
      kind: "thread";
      /** Null while the live list has not seen the thread yet. */
      thread: WordCommentListThread | null;
      why: WordCommentWhy | null;
      picked: boolean;
      /** A passage is selected that the switch would send instead. */
      backToPassage: boolean;
    }
  /** The caret is in more than one anchor; nothing goes until the user chooses. */
  | { kind: "choose"; count: number }
  | { kind: "picked-gone" }
  /** The document goes with the comment map. */
  | { kind: "map"; threads: number };

export interface WordCommentChipInput {
  /** resolveWordCommentSend for the live selection, as if comments went. */
  plan: WordCommentSendPlan;
  list: WordCommentList;
  /** The selection chip shows a passage that goes with the message. */
  passage: boolean;
  pick: string | null;
  withoutComments: boolean;
}

export function wordCommentChipView({
  plan,
  list,
  passage,
  pick,
  withoutComments,
}: WordCommentChipInput): WordCommentChipView {
  const byRef = new Map(list.threads.map((thread) => [thread.ref, thread]));
  const { carrier } = plan;
  const carries =
    !!plan.block ||
    carrier.kind === "thread" ||
    carrier.kind === "open-comments" ||
    (carrier.kind === "selection" && carrier.threads.length > 0) ||
    (carrier.kind === "map" && list.threads.length > 0);
  if (withoutComments) return carries ? { kind: "without" } : { kind: "none" };
  if (plan.block === "choose-comment")
    return {
      kind: "choose",
      count:
        list.selection.kind === "caret" ? list.selection.threads.length : 2,
    };
  if (plan.block === "picked-gone") return { kind: "picked-gone" };
  if (carrier.kind === "thread")
    return {
      kind: "thread",
      thread: byRef.get(carrier.ref) ?? null,
      why: plan.why,
      picked: carrier.ref === pick,
      backToPassage: passage,
    };
  if (carrier.kind === "selection" && carrier.threads.length > 0) {
    const threads = carrier.threads.flatMap((ref) => {
      const thread = byRef.get(ref);
      return thread ? [thread] : [];
    });
    return {
      kind: "passage",
      threads,
      switchTo:
        plan.switchTo === "comment"
          ? (byRef.get(carrier.threads[0]) ?? null)
          : null,
      offerChoose: plan.offerChoose,
      why: plan.why,
    };
  }
  if (carrier.kind === "map" && list.threads.length > 0)
    return { kind: "map", threads: wordCommentMapListed(list.threads.length) };
  return { kind: "none" };
}

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

export function wordCommentThreadTitle(
  thread: Pick<WordCommentListThread, "author" | "replies">,
): string {
  const { author, replies } = thread;
  if (replies === null)
    return t({
      id: "officeAddin.word.comments.thread.title",
      message: `Comment by ${author}`,
    });
  return t({
    id: "officeAddin.word.comments.thread.titleWithReplies",
    message: plural(replies, {
      0: `Comment by ${author}`,
      one: `Comment by ${author} · # reply`,
      other: `Comment by ${author} · # replies`,
    }),
  });
}

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

export interface WordCommentChipProps {
  view: WordCommentChipView;
  coverage: WordCommentCoverageInfo | null;
  /** The thread facet is advertised, so the precedence setting exists to change. */
  canChangeDefault: boolean;
  /** "Send without comments" for this message; the passage still goes. */
  onWithoutComments: () => void;
  onWithComments: () => void;
  onSwitch: (to: WordCommentOverride) => void;
  onDismissPick: () => void;
  onChoose: () => void;
  onChangeDefault: () => void;
  onShowInWord: (
    commentId: string,
    para: number,
  ) => Promise<WordSelectionShowResult>;
}

const CHIP_CLASS =
  "rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary px-3 py-1.5 text-xs text-theme-fg-secondary";
const DISMISS_CLASS =
  "ml-auto shrink-0 rounded-[var(--theme-radius-control)] p-0.5 hover:bg-theme-bg-tertiary";
export const WORD_COMMENT_LINK_CLASS =
  "font-medium underline underline-offset-2 hover:text-theme-fg-primary";

function Shell({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] px-2 pb-1 sm:px-4">
      <div className={CHIP_CLASS} data-testid={testId}>
        {children}
      </div>
    </div>
  );
}

function WhyTag({
  why,
  canChangeDefault,
  onChangeDefault,
}: {
  why: WordCommentWhy | null;
  canChangeDefault: boolean;
  onChangeDefault: () => void;
}) {
  if (!why) return null;
  return (
    <>
      <span
        className="rounded-[var(--theme-radius-control)] bg-theme-bg-tertiary px-1.5 py-0.5 font-medium text-theme-fg-primary"
        data-testid="word-comment-why"
      >
        {wordCommentWhyText(why)}
      </span>
      {canChangeDefault && (
        <button
          type="button"
          className={WORD_COMMENT_LINK_CLASS}
          onClick={onChangeDefault}
        >
          {t({
            id: "officeAddin.word.comments.changeDefault",
            message: "Change default",
          })}
        </button>
      )}
    </>
  );
}

function DismissButton({
  label,
  onClick,
  testId,
}: {
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={DISMISS_CLASS}
      aria-label={label}
      data-testid={testId}
    >
      &#x2715;
    </button>
  );
}

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

const dismissPickText = () =>
  t({
    id: "officeAddin.word.comments.dismissPick",
    message: "Remove the chosen comment",
  });

/**
 * The comment chip (contract §8). Its × sends the next message without comments and leaves the
 * passage chip alone; a picked thread's × ends the pick. The location shown is the anchored text
 * and "Show in Word", never a paragraph number.
 */
export function WordCommentChip({
  view,
  coverage,
  canChangeDefault,
  onWithoutComments,
  onWithComments,
  onSwitch,
  onDismissPick,
  onChoose,
  onChangeDefault,
  onShowInWord,
}: WordCommentChipProps) {
  const chooseButton = (
    <button type="button" className={ACTION_BUTTON_CLASS} onClick={onChoose}>
      {wordCommentChooseText()}
    </button>
  );
  const coverageButton = coverage ? (
    <WordCommentCoverage info={coverage} />
  ) : null;

  switch (view.kind) {
    case "none":
      return null;
    case "without":
      return (
        <Shell testId="word-comment-chip">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              {t({
                id: "officeAddin.word.comments.without",
                message: "This message is sent without comments.",
              })}
            </span>
            <button
              type="button"
              className={ACTION_BUTTON_CLASS}
              onClick={onWithComments}
            >
              {t({
                id: "officeAddin.word.comments.withAgain",
                message: "Include comments",
              })}
            </button>
          </div>
        </Shell>
      );
    case "choose": {
      const { count } = view;
      return (
        <Shell testId="word-comment-chip">
          <div className="flex items-center gap-2">
            <ChatBubbleIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {t({
                id: "officeAddin.word.comments.atCursorMany",
                message: plural(count, {
                  one: "Your cursor is in # comment",
                  other: "Your cursor is in # comments",
                }),
              })}
            </span>
            {chooseButton}
          </div>
        </Shell>
      );
    }
    case "picked-gone":
      return (
        <Shell testId="word-comment-chip">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              {t({
                id: "officeAddin.word.comments.blocked.pickedGone",
                message: "The comment you chose is no longer in the document.",
              })}
            </span>
            {chooseButton}
            <DismissButton label={dismissPickText()} onClick={onDismissPick} />
          </div>
        </Shell>
      );
    case "map": {
      const { threads } = view;
      return (
        <Shell testId="word-comment-chip">
          <div className="flex flex-wrap items-center gap-2">
            <ChatBubbleIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {t({
                id: "officeAddin.word.comments.mapListed",
                message: plural(threads, {
                  one: "# comment is listed with the document",
                  other: "# comments are listed with the document",
                }),
              })}
            </span>
            {coverageButton}
          </div>
        </Shell>
      );
    }
    case "passage": {
      const { switchTo } = view;
      const count = view.threads.length;
      return (
        <Shell testId="word-comment-chip">
          <div className="flex items-center gap-2">
            <ChatBubbleIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">
              {t({
                id: "officeAddin.word.comments.inSelection",
                message: plural(count, {
                  one: "# comment in selection",
                  other: "# comments in selection",
                }),
              })}
            </span>
            <DismissButton
              label={wordCommentSendWithoutText()}
              onClick={onWithoutComments}
              testId="word-comment-chip-dismiss"
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <WhyTag
              why={view.why}
              canChangeDefault={canChangeDefault}
              onChangeDefault={onChangeDefault}
            />
            {switchTo && (
              <button
                type="button"
                className={ACTION_BUTTON_CLASS}
                onClick={() => onSwitch("comment")}
              >
                {wordCommentSwitchToCommentText(switchTo.author)}
              </button>
            )}
            {view.offerChoose && chooseButton}
            {coverageButton}
          </div>
        </Shell>
      );
    }
    case "thread": {
      const { thread } = view;
      return (
        <Shell testId="word-comment-chip">
          <div className="flex items-center gap-2">
            <ChatBubbleIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate font-medium text-theme-fg-primary">
              {thread
                ? wordCommentThreadTitle(thread)
                : t({
                    id: "officeAddin.word.comments.thread.unknown",
                    message: "Chosen comment",
                  })}
            </span>
            <DismissButton
              label={
                view.picked ? dismissPickText() : wordCommentSendWithoutText()
              }
              onClick={view.picked ? onDismissPick : onWithoutComments}
              testId="word-comment-chip-dismiss"
            />
          </div>
          {thread && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
              <span className="min-w-0 truncate">
                {wordCommentQuoteText(thread.quote)}
              </span>
              <WordShowInWordButton
                onShow={() => onShowInWord(thread.commentId, thread.para)}
                disabled={false}
              />
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <WhyTag
              why={view.why}
              canChangeDefault={canChangeDefault}
              onChangeDefault={onChangeDefault}
            />
            {view.backToPassage && (
              <button
                type="button"
                className={ACTION_BUTTON_CLASS}
                onClick={() =>
                  view.picked ? onDismissPick() : onSwitch("passage")
                }
              >
                {t({
                  id: "officeAddin.word.comments.switchToPassage",
                  message: "Use selected passage instead",
                })}
              </button>
            )}
            {coverageButton}
          </div>
        </Shell>
      );
    }
  }
}

export function wordCommentSwitchToCommentText(author: string): string {
  return t({
    id: "officeAddin.word.comments.switchToComment",
    message: `Work on ${author}'s comment instead`,
  });
}
