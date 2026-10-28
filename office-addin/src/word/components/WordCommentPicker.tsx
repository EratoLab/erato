import {
  Button,
  Input,
  ModalBase,
  Select,
  SpinnerIcon,
} from "@erato/frontend/library";
import { plural, t } from "@lingui/core/macro";
import { useEffect, useMemo, useState } from "react";

import { WordShowInWordButton } from "./WordShowInWordButton";
import { ACTION_BUTTON_CLASS } from "../../core/clientActions/clientActionButtonStyles";
import {
  wordCommentActivityText,
  wordCommentQuoteText,
  wordCommentReadingText,
  wordCommentRepliesText,
  wordCommentStatusText,
} from "../utils/wordCommentText";

import type {
  WordCommentList,
  WordCommentListThread,
} from "../hooks/useWordComments";
import type { WordSelectionShowResult } from "../utils/wordSelectionTarget";
import type { WordCommentStatus } from "@erato/frontend/word-review";

/** Above this many threads the picker offers a search. */
export const WORD_COMMENT_PICKER_SEARCH_ABOVE = 8;

export type WordCommentPickerFilter = WordCommentStatus | "all";
export type WordCommentPickerSort = "document" | "activity";

/** The filter's threads in the chosen order; search matches author, anchored text and comment. */
export function wordCommentPickerRows(
  threads: readonly WordCommentListThread[],
  options: {
    filter: WordCommentPickerFilter;
    sort: WordCommentPickerSort;
    query: string;
  },
): WordCommentListThread[] {
  const query = options.query.trim().toLocaleLowerCase();
  const rows = threads.filter(
    (thread) =>
      (options.filter === "all" || thread.status === options.filter) &&
      (!query ||
        [thread.author, thread.quote ?? "", thread.text].some((field) =>
          field.toLocaleLowerCase().includes(query),
        )),
  );
  return options.sort === "document"
    ? rows.sort((a, b) => a.pos - b.pos)
    : rows.sort(
        (a, b) =>
          (b.lastActivity?.getTime() ?? -Infinity) -
            (a.lastActivity?.getTime() ?? -Infinity) || a.pos - b.pos,
      );
}

export interface WordCommentPickerProps {
  isOpen: boolean;
  onClose: () => void;
  list: WordCommentList;
  /** Reads Word again; the hook coalesces a refresh asked for while one runs. */
  onRefresh: () => void;
  onPick: (ref: string) => void;
  onShowInWord: (
    commentId: string,
    para: number,
  ) => Promise<WordSelectionShowResult>;
  picked: string | null;
  /** Word for the web, where clicking a comment in the document fires no selection event (#4394). */
  web: boolean;
}

/**
 * The thread picker (contract §8): Open, Resolved or All with counts, document order or latest
 * activity, a search above eight threads, and rows naming author, replies, last activity, the
 * anchored text and status. It reads Word when it opens and on Refresh, and useWordComments on pane
 * focus; nothing polls.
 */
export function WordCommentPicker({
  isOpen,
  onClose,
  list,
  onRefresh,
  onPick,
  onShowInWord,
  picked,
  web,
}: WordCommentPickerProps) {
  const [filter, setFilter] = useState<WordCommentPickerFilter>("open");
  const [sort, setSort] = useState<WordCommentPickerSort>("document");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (isOpen) onRefresh();
  }, [isOpen, onRefresh]);

  const total = list.threads.length;
  const searchable = total > WORD_COMMENT_PICKER_SEARCH_ABOVE;
  const rows = useMemo(
    () =>
      wordCommentPickerRows(list.threads, {
        filter,
        sort,
        query: searchable ? query : "",
      }),
    [list.threads, filter, sort, query, searchable],
  );
  const reading = list.status === "reading" || list.status === "idle";
  const { open, resolved } = list.counts;

  const filters: { value: WordCommentPickerFilter; label: string }[] = [
    {
      value: "open",
      label: t({
        id: "officeAddin.word.comments.picker.filterOpen",
        message: `Open (${open})`,
      }),
    },
    {
      value: "resolved",
      label: t({
        id: "officeAddin.word.comments.picker.filterResolved",
        message: `Resolved (${resolved})`,
      }),
    },
    {
      value: "all",
      label: t({
        id: "officeAddin.word.comments.picker.filterAll",
        message: `All (${total})`,
      }),
    },
  ];

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={t({
        id: "officeAddin.word.comments.picker.title",
        message: "Choose a comment",
      })}
      contentClassName="h-[80vh] max-h-[600px] max-w-xl"
    >
      <div
        className="flex h-full min-h-0 flex-col gap-3 overflow-hidden text-sm"
        data-testid="word-comment-picker"
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={t({
              id: "officeAddin.word.comments.picker.filter",
              message: "Show comments",
            })}
            className="flex flex-wrap gap-1"
          >
            {filters.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={`${ACTION_BUTTON_CLASS} ${filter === option.value ? "bg-theme-bg-selected font-medium text-theme-fg-primary" : ""}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <Select
              aria-label={t({
                id: "officeAddin.word.comments.picker.sort",
                message: "Sort",
              })}
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as WordCommentPickerSort)
              }
            >
              <option value="document">
                {t({
                  id: "officeAddin.word.comments.picker.sortDocument",
                  message: "Document order",
                })}
              </option>
              <option value="activity">
                {t({
                  id: "officeAddin.word.comments.picker.sortActivity",
                  message: "Latest activity",
                })}
              </option>
            </Select>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={list.status === "reading"}
          >
            {t({
              id: "officeAddin.word.comments.picker.refresh",
              message: "Refresh",
            })}
          </Button>
        </div>

        {searchable && (
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t({
              id: "officeAddin.word.comments.picker.searchPlaceholder",
              message: "Search by author or text",
            })}
            aria-label={t({
              id: "officeAddin.word.comments.picker.search",
              message: "Search comments",
            })}
          />
        )}

        <p
          className="shrink-0 text-xs text-theme-fg-secondary"
          data-testid="word-comment-picker-coverage"
        >
          {pickerCoverageText(list)}
        </p>
        {web && (
          <p
            className="shrink-0 text-xs text-theme-fg-secondary"
            data-testid="word-comment-picker-web-hint"
          >
            {t({
              id: "officeAddin.word.comments.picker.webHint",
              message:
                "In Word for the web, clicking a comment in the document does not choose it here. Choose it from this list.",
            })}
          </p>
        )}
        {reading && (
          <div
            className="flex shrink-0 items-center gap-2 text-xs text-theme-fg-secondary"
            role="status"
          >
            <SpinnerIcon size="sm" />
            <span>{wordCommentReadingText(list.progress)}</span>
          </div>
        )}
        {list.status === "failed" && (
          <p className="shrink-0 text-xs text-theme-fg-secondary" role="alert">
            {t({
              id: "officeAddin.word.comments.blocked.readFailed",
              message: "Erato could not read the comments in Word.",
            })}
          </p>
        )}

        <ul
          className="min-h-0 flex-1 divide-y divide-theme-border overflow-y-auto"
          aria-label={t({
            id: "officeAddin.word.comments.picker.list",
            message: "Comments",
          })}
        >
          {rows.map((thread) => (
            <WordCommentPickerRow
              key={thread.ref}
              thread={thread}
              picked={thread.ref === picked}
              onPick={() => onPick(thread.ref)}
              onShowInWord={() => onShowInWord(thread.commentId, thread.para)}
            />
          ))}
          {!reading && rows.length === 0 && (
            <li className="py-3 text-xs text-theme-fg-secondary">
              {emptyText(filter, total, searchable && query.trim() !== "")}
            </li>
          )}
        </ul>
      </div>
    </ModalBase>
  );
}

function pickerCoverageText(list: WordCommentList): string {
  const total = list.threads.length;
  const { open, resolved } = list.counts;
  const line = t({
    id: "officeAddin.word.comments.picker.coverage",
    message: plural(total, {
      0: "No comments in this document.",
      one: `# comment in this document: ${open} open, ${resolved} resolved.`,
      other: `# comments in this document: ${open} open, ${resolved} resolved.`,
    }),
  });
  const { unplaced } = list;
  if (unplaced === 0) return line;
  const notListed = t({
    id: "officeAddin.word.comments.picker.unplaced",
    message: plural(unplaced, {
      one: "Word gave no place for # more, so it is not listed.",
      other: "Word gave no place for # more, so they are not listed.",
    }),
  });
  return `${line} ${notListed}`;
}

function emptyText(
  filter: WordCommentPickerFilter,
  total: number,
  searching: boolean,
): string {
  if (searching)
    return t({
      id: "officeAddin.word.comments.picker.noMatch",
      message: "No comment matches your search.",
    });
  if (total === 0)
    return t({
      id: "officeAddin.word.comments.picker.none",
      message: "This document has no comments.",
    });
  if (filter === "open")
    return t({
      id: "officeAddin.word.comments.picker.noneOpen",
      message: "No open comments.",
    });
  return t({
    id: "officeAddin.word.comments.picker.noneResolved",
    message: "No resolved comments.",
  });
}

function WordCommentPickerRow({
  thread,
  picked,
  onPick,
  onShowInWord,
}: {
  thread: WordCommentListThread;
  picked: boolean;
  onPick: () => void;
  onShowInWord: () => Promise<WordSelectionShowResult>;
}) {
  const replies = wordCommentRepliesText(thread.replies);
  return (
    <li
      className="space-y-1 py-2"
      data-testid="word-comment-picker-row"
      data-ref={thread.ref}
    >
      <button
        type="button"
        onClick={onPick}
        aria-current={picked || undefined}
        className="w-full space-y-0.5 rounded-[var(--theme-radius-control)] px-1 py-0.5 text-left hover:bg-theme-bg-hover"
      >
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-theme-fg-secondary">
          <span className="font-medium text-theme-fg-primary">
            {thread.author}
          </span>
          {replies && <span>{replies}</span>}
          <span>{wordCommentActivityText(thread.lastActivity)}</span>
          <span
            className="rounded-[var(--theme-radius-control)] bg-theme-bg-tertiary px-1.5"
            data-testid="word-comment-picker-status"
          >
            {wordCommentStatusText(thread.status)}
          </span>
          {thread.inSelection && (
            <span
              className="font-medium text-theme-fg-primary"
              data-testid="word-comment-picker-in-selection"
            >
              {t({
                id: "officeAddin.word.comments.picker.inSelection",
                message: "In your selection",
              })}
            </span>
          )}
        </span>
        <span className="block truncate text-theme-fg-primary">
          {thread.text}
        </span>
        {thread.quote !== null && (
          <span className="block truncate text-xs text-theme-fg-secondary">
            {wordCommentQuoteText(thread.quote)}
          </span>
        )}
      </button>
      <WordShowInWordButton onShow={onShowInWord} disabled={false} />
    </li>
  );
}
