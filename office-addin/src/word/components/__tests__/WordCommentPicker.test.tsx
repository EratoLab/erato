import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_WORD_COMMENT_LIST } from "../../hooks/useWordComments";
import {
  WORD_COMMENT_PICKER_SEARCH_ABOVE,
  WordCommentPicker,
  wordCommentPickerRows,
} from "../WordCommentPicker";

import type {
  WordCommentList,
  WordCommentListThread,
} from "../../hooks/useWordComments";
import type { WordCommentPickerProps } from "../WordCommentPicker";
import type { ReactNode } from "react";

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  const { useState } = await import("react");
  return mock.createEratoLibraryMock({
    SpinnerIcon: () => <span>spinner</span>,
    DropdownMenu: ({
      items,
      triggerAriaLabel,
      triggerIcon,
    }: {
      items: {
        id: string;
        label: string;
        checked?: boolean;
        onClick: () => void;
      }[];
      triggerAriaLabel: string;
      triggerIcon: ReactNode;
    }) => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            aria-label={triggerAriaLabel}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {triggerIcon}
          </button>
          {open && (
            <div role="menu">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  data-checked={item.checked || undefined}
                  onClick={() => {
                    item.onClick();
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </>
      );
    },
    ModalBase: ({
      isOpen,
      title,
      children,
    }: {
      isOpen: boolean;
      title: string;
      children: ReactNode;
    }) =>
      isOpen ? (
        <div role="dialog" aria-label={title}>
          {children}
        </div>
      ) : null,
  });
});

const AUTHORS = ["Maya Krüger", "Jonas Weber", "Lena Fischer"];

function thread(i: number, overrides: Partial<WordCommentListThread> = {}) {
  return {
    ref: `t${(i + 10).toString(36)}x`,
    commentId: String(1000 + i),
    author: AUTHORS[i % AUTHORS.length],
    status: i % 4 === 3 ? "resolved" : "open",
    quote: `anchor ${i}`,
    text: `Comment ${i} on the text.`,
    replies: i % 3,
    lastActivity: new Date(Date.UTC(2026, 8, 1 + ((i * 7) % 11))),
    pos: i + 1,
    para: 2 * i + 3,
    inSelection: false,
    ...overrides,
  } satisfies WordCommentListThread;
}

const listOf = (
  threads: readonly WordCommentListThread[],
  overrides: Partial<WordCommentList> = {},
): WordCommentList => ({
  ...NO_WORD_COMMENT_LIST,
  status: "ready",
  threads,
  counts: {
    open: threads.filter((t) => t.status === "open").length,
    resolved: threads.filter((t) => t.status === "resolved").length,
  },
  ...overrides,
});

const TWELVE = Array.from({ length: 12 }, (_, i) => thread(i));

describe("wordCommentPickerRows", () => {
  it("filters by status and sorts by document order or latest activity", () => {
    const refs = (rows: readonly WordCommentListThread[]) =>
      rows.map((t) => t.pos);
    const open = wordCommentPickerRows(TWELVE, {
      filter: "open",
      sort: "document",
      query: "",
    });
    expect(refs(open)).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11]);
    expect(
      refs(
        wordCommentPickerRows(TWELVE, {
          filter: "resolved",
          sort: "document",
          query: "",
        }),
      ),
    ).toEqual([4, 8, 12]);

    const byActivity = wordCommentPickerRows(TWELVE, {
      filter: "all",
      sort: "activity",
      query: "",
    });
    const times = byActivity.map((t) => t.lastActivity!.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("puts threads without a time last when sorting by activity", () => {
    const rows = wordCommentPickerRows(
      [thread(0, { lastActivity: null }), thread(1), thread(2)],
      { filter: "all", sort: "activity", query: "" },
    );
    expect(rows.at(-1)?.pos).toBe(1);
  });

  it("searches author, anchored text and comment", () => {
    const search = (query: string) =>
      wordCommentPickerRows(TWELVE, { filter: "all", sort: "document", query })
        .length;
    expect(search("lena")).toBe(4);
    expect(search("ANCHOR 11")).toBe(1);
    expect(search("comment 1")).toBe(3);
  });
});

describe("WordCommentPicker", () => {
  const props = (
    overrides: Partial<WordCommentPickerProps> = {},
  ): WordCommentPickerProps => ({
    isOpen: true,
    onClose: vi.fn(),
    list: listOf(TWELVE),
    onRefresh: vi.fn(),
    onPick: vi.fn(),
    onShowInWord: vi.fn(async () => "selected" as const),
    picked: null,
    web: false,
    ...overrides,
  });
  const rows = () => screen.queryAllByTestId("word-comment-picker-row");
  const rowRefs = () => rows().map((row) => row.getAttribute("data-ref"));

  beforeEach(() => i18n.activate("en"));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("counts every filter and shows the open threads first", () => {
    render(<WordCommentPicker {...props()} />);

    expect(screen.getByRole("button", { name: "Open (9)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(rows()).toHaveLength(9);
    fireEvent.click(screen.getByRole("button", { name: "Resolved (3)" }));
    expect(rows()).toHaveLength(3);
    expect(
      rows().every(
        (row) =>
          within(row).getByTestId("word-comment-picker-status").textContent ===
          "Resolved",
      ),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "All (12)" }));
    expect(rows()).toHaveLength(12);
    expect(
      screen.getByTestId("word-comment-picker-coverage"),
    ).toHaveTextContent("12 comments in this document: 9 open, 3 resolved.");
  });

  it("sorts by document order or latest activity", () => {
    render(<WordCommentPicker {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "All (12)" }));
    expect(rowRefs()).toEqual(TWELVE.map((t) => t.ref));

    fireEvent.click(
      screen.getByRole("button", { name: "Sort: Document order" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Document order" }),
    ).toHaveAttribute("data-checked", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Latest activity" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Sort: Latest activity" }),
    ).toBeInTheDocument();
    expect(rowRefs()).toEqual(
      wordCommentPickerRows(TWELVE, {
        filter: "all",
        sort: "activity",
        query: "",
      }).map((t) => t.ref),
    );
    expect(rowRefs()).not.toEqual(TWELVE.map((t) => t.ref));
  });

  it("offers a search only above eight threads", () => {
    const eight = TWELVE.slice(0, WORD_COMMENT_PICKER_SEARCH_ABOVE);
    const { rerender } = render(
      <WordCommentPicker {...props({ list: listOf(eight) })} />,
    );
    expect(screen.queryByRole("searchbox")).toBeNull();

    rerender(
      <WordCommentPicker
        {...props({
          list: listOf(TWELVE.slice(0, WORD_COMMENT_PICKER_SEARCH_ABOVE + 1)),
        })}
      />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search comments" }),
      {
        target: { value: "jonas" },
      },
    );
    expect(
      rows().map((row) => within(row).getByText("Jonas Weber")),
    ).toHaveLength(2);
  });

  it("names author, replies, last activity, anchored text and status, and marks the selection's threads", () => {
    const list = listOf([
      thread(0, { replies: 3, inSelection: true }),
      thread(1, { replies: null, lastActivity: null, quote: "" }),
    ]);
    render(<WordCommentPicker {...props({ list })} />);
    const [first, second] = rows();

    expect(first).toHaveTextContent("Maya Krüger");
    expect(first).toHaveTextContent("3 replies");
    expect(first).toHaveTextContent("on “anchor 0”");
    expect(first).toHaveTextContent("Open");
    expect(
      within(first).getByTestId("word-comment-picker-in-selection"),
    ).toHaveTextContent("In your selection");
    expect(second).toHaveTextContent("time unknown");
    expect(second).toHaveTextContent("on a spot without highlighted text");
    expect(second).not.toHaveTextContent("replies");
    expect(
      within(second).queryByTestId("word-comment-picker-in-selection"),
    ).toBeNull();
    expect(screen.getByTestId("word-comment-picker").textContent).not.toMatch(
      /¶/,
    );
  });

  it("dates each row in the app's language, not the browser's", () => {
    i18n.load("de", {});
    i18n.activate("de");
    const at = new Date(Date.UTC(2026, 8, 4, 7, 0));
    render(
      <WordCommentPicker
        {...props({ list: listOf([thread(0, { lastActivity: at })]) })}
      />,
    );
    expect(rows()[0]).toHaveTextContent(
      new Intl.DateTimeFormat("de", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(at),
    );
  });

  it("picks a thread and shows one in Word", async () => {
    const picker = props();
    render(<WordCommentPicker {...picker} />);
    const [first] = rows();

    fireEvent.click(within(first).getByText("Maya Krüger"));
    expect(picker.onPick).toHaveBeenCalledWith(TWELVE[0].ref);
    fireEvent.click(
      within(first).getByRole("button", { name: "Show in Word" }),
    );
    await waitFor(() =>
      expect(picker.onShowInWord).toHaveBeenCalledWith(
        TWELVE[0].commentId,
        TWELVE[0].para,
      ),
    );
  });

  it("says on the web that clicking a comment in Word does not choose it", () => {
    const { rerender } = render(<WordCommentPicker {...props()} />);
    expect(screen.queryByTestId("word-comment-picker-web-hint")).toBeNull();

    rerender(<WordCommentPicker {...props({ web: true })} />);
    expect(
      screen.getByTestId("word-comment-picker-web-hint"),
    ).toHaveTextContent(
      "In Word for the web, clicking a comment in the document does not choose it here.",
    );
  });

  it("refreshes when it opens and on Refresh, and never on a timer", async () => {
    vi.useFakeTimers();
    const picker = props({ isOpen: false });
    const { rerender } = render(<WordCommentPicker {...picker} />);
    expect(picker.onRefresh).not.toHaveBeenCalled();

    rerender(<WordCommentPicker {...picker} isOpen />);
    expect(picker.onRefresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(picker.onRefresh).toHaveBeenCalledTimes(2);

    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(picker.onRefresh).toHaveBeenCalledTimes(2);
  });

  it("shows progress while the replies are listed", () => {
    render(
      <WordCommentPicker
        {...props({
          list: listOf(TWELVE, {
            status: "reading",
            progress: { done: 12, total: 50 },
          }),
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reading comments… 12 of 50",
    );
  });
});
