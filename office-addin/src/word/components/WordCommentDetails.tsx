import { Alert, Button } from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useId } from "react";

import { WordShowInWordButton } from "./WordShowInWordButton";
import {
  wordCommentActivityText,
  wordCommentByText,
  wordCommentChooseText,
  wordCommentQuoteText,
  wordCommentRepliesText,
  wordCommentStatusText,
  wordCommentWhyText,
} from "../utils/wordCommentText";

import type { WordCommentListThread } from "../hooks/useWordComments";
import type {
  WordCommentChipModel,
  WordCommentCoverageSection,
  WordOpenCommentsChipModel,
  WordPassageCommentsModel,
} from "../utils/wordCommentChips";
import type { WordCommentWhy } from "../utils/wordCommentSend";
import type { WordContextNote } from "../utils/wordContextChips";
import type { WordSelectionShowResult } from "../utils/wordSelectionTarget";
import type { ComposerContextDetailRenderContext } from "@erato/frontend/library";

// Read with the detail when it opens; a live role would announce it again.
function Note({ note }: { note: WordContextNote }) {
  return (
    <div data-ui="word-context-detail-note" data-tone={note.tone}>
      <Alert role="none" type={note.tone}>
        {note.text}
      </Alert>
    </div>
  );
}

function Lifetime({ text }: { text: string }) {
  return (
    <p
      className="text-xs text-theme-fg-secondary"
      data-ui="word-context-detail-lifetime"
    >
      {text}
    </p>
  );
}

export function WordCommentWhyTag({ why }: { why: WordCommentWhy }) {
  return (
    <span
      className="pill-geometry self-start border border-theme-border px-1.5 py-px text-xs font-medium text-theme-fg-primary"
      data-ui="word-comment-detail-why"
    >
      {wordCommentWhyText(why)}
    </span>
  );
}

/** "What is sent", or "If included" while the chip is off: what this message carries, never a comment's text. */
export function WordCommentCoverageList({
  coverage,
  dataUi = "word-comment-what-is-sent",
}: {
  coverage: WordCommentCoverageSection;
  dataUi?: string;
}) {
  const headingId = useId();
  return (
    <section className="flex flex-col gap-1" data-ui={dataUi}>
      <h3
        id={headingId}
        className="text-xs font-semibold text-theme-fg-secondary"
      >
        {coverage.heading}
      </h3>
      <ul
        aria-labelledby={headingId}
        className="flex list-disc flex-col gap-1 pl-4 text-xs text-theme-fg-secondary"
      >
        {coverage.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

/** Replies and the date only when Word listed them; never "0 replies" for a count it did not read. */
function ThreadFacts({ thread }: { thread: WordCommentListThread }) {
  const replies = wordCommentRepliesText(thread.replies);
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-xs text-theme-fg-secondary">
      <span className="font-medium text-theme-fg-primary">{thread.author}</span>
      {thread.lastActivity && (
        <span>{wordCommentActivityText(thread.lastActivity)}</span>
      )}
      <span>{wordCommentStatusText(thread.status)}</span>
      {replies && <span>{replies}</span>}
    </span>
  );
}

function ThreadCard({ thread }: { thread: WordCommentListThread }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-[var(--theme-radius-control)] border border-theme-border bg-theme-bg-secondary px-3 py-2"
      data-ui="word-comment-detail-thread"
    >
      <ThreadFacts thread={thread} />
      <p className="whitespace-pre-wrap break-words text-sm text-theme-fg-primary">
        {thread.text}
      </p>
    </div>
  );
}

export interface WordCommentDetailProps {
  model: WordCommentChipModel;
  context: ComposerContextDetailRenderContext;
  /** Show in Word from a cursor thread picks it first, so it stays the target. */
  onShowInWord: (
    thread: WordCommentListThread,
  ) => Promise<WordSelectionShowResult>;
  onPick: (ref: string) => void;
  onOpenPicker: () => void;
}

/**
 * The comment chip's detail: the thread (why it goes, where it is, what it says and what is sent),
 * the threads at the caret to choose from, or the note that a pick is gone.
 */
export function WordCommentDetail({
  model,
  context,
  onShowInWord,
  onPick,
  onOpenPicker,
}: WordCommentDetailProps) {
  const { detail } = model;
  const thread = detail.thread;
  return (
    <div
      className="flex flex-col gap-3"
      data-ui="word-comment-detail"
      data-variant={model.variant}
    >
      {thread ? (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm [&>.word-review__hint]:basis-full"
          data-ui="word-comment-detail-quote"
        >
          {detail.why && <WordCommentWhyTag why={detail.why} />}
          <span className="break-words text-theme-fg-secondary">
            {wordCommentQuoteText(thread.quote)}
          </span>
          <WordShowInWordButton
            onShow={() => onShowInWord(thread)}
            disabled={false}
          />
        </div>
      ) : (
        detail.why && <WordCommentWhyTag why={detail.why} />
      )}
      {detail.intro && <p className="text-sm">{detail.intro}</p>}
      {thread && <ThreadCard thread={thread} />}
      {detail.choices.length > 0 && (
        <ul
          className="flex flex-col gap-2"
          aria-label={t({
            id: "officeAddin.word.context.comment.choices",
            message: "Comments at your cursor",
          })}
          data-ui="word-comment-choices"
        >
          {detail.choices.map((choice) => (
            <li key={choice.ref}>
              <button
                type="button"
                className="flex w-full flex-col gap-1 rounded-[var(--theme-radius-control)] border border-theme-border bg-theme-bg-secondary px-3 py-2 text-left hover:bg-theme-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
                onClick={() => {
                  const { author } = choice;
                  context.runAction({
                    id: `pick:${choice.ref}`,
                    label: wordCommentByText(author),
                    announcement: t({
                      id: "officeAddin.word.context.comment.announce.chosen",
                      message: `Comment by ${author} chosen.`,
                    }),
                    onSelect: () => onPick(choice.ref),
                  });
                }}
              >
                <ThreadFacts thread={choice} />
                <span className="line-clamp-2 text-sm text-theme-fg-primary">
                  {choice.text}
                </span>
                <span className="truncate text-xs text-theme-fg-secondary">
                  {wordCommentQuoteText(choice.quote)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {model.variant === "choose" && (
        <div className="self-start">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              context.runAction({
                id: "choose",
                label: wordCommentChooseText(),
                onSelect: onOpenPicker,
              })
            }
          >
            {wordCommentChooseText()}
          </Button>
        </div>
      )}
      {detail.notes.map((note) => (
        <Note key={note.text} note={note} />
      ))}
      {detail.coverage && (
        <WordCommentCoverageList coverage={detail.coverage} />
      )}
      <Lifetime text={detail.lifetime} />
    </div>
  );
}

/** "Open comments (9)": why it shows, what it sends and how long leaving them out lasts. */
export function WordOpenCommentsDetail({
  model,
}: {
  model: WordOpenCommentsChipModel;
}) {
  return (
    <div className="flex flex-col gap-3" data-ui="word-open-comments-detail">
      <p className="text-sm">{model.detail.intro}</p>
      {model.detail.notes.map((note) => (
        <Note key={note.text} note={note} />
      ))}
      {model.detail.coverage && (
        <WordCommentCoverageList coverage={model.detail.coverage} />
      )}
      <Lifetime text={model.detail.lifetime} />
    </div>
  );
}

/** The selection detail's section for the passage's own threads, with the one-message switch. */
export function WordPassageCommentsSection({
  comments,
  locked,
  onSetPassageComments,
}: {
  comments: WordPassageCommentsModel;
  locked: boolean;
  onSetPassageComments: (on: boolean) => void;
}) {
  const hintId = useId();
  const checkboxId = useId();
  const count = comments.count;
  return (
    <section
      className="flex flex-col gap-2"
      data-ui="word-context-detail-passage-comments"
    >
      <h3 className="text-xs font-semibold text-theme-fg-secondary">
        {t({
          id: "officeAddin.word.context.selection.commentsHeading",
          message: "Comments in this passage",
        })}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        {comments.threads.map((thread) => (
          <li key={thread.ref} className="break-words">
            <span className="font-medium">{thread.author}</span>
            {" · "}
            <span className="text-theme-fg-secondary">{thread.text}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-start gap-2 text-sm">
        <input
          id={checkboxId}
          type="checkbox"
          checked={comments.checked}
          disabled={locked}
          aria-describedby={hintId}
          onChange={(event) => onSetPassageComments(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--theme-fg-accent)]"
        />
        <div className="flex flex-col">
          <label htmlFor={checkboxId}>
            {t({
              id: "officeAddin.word.context.selection.sendComments",
              message: plural(count, {
                one: "Send the comment in this passage",
                other: "Send the # comments in this passage",
              }),
            })}
          </label>
          <span id={hintId} className="text-xs text-theme-fg-secondary">
            {t({
              id: "officeAddin.word.context.selection.sendCommentsHint",
              message: "Off lasts for this message only",
            })}
          </span>
        </div>
      </div>
      {comments.why && <WordCommentWhyTag why={comments.why} />}
      {comments.coverage && (
        <WordCommentCoverageList coverage={comments.coverage} />
      )}
    </section>
  );
}
