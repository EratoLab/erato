import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WordCommentDetail,
  WordOpenCommentsDetail,
  WordPassageCommentsSection,
} from "../WordCommentDetails";

import type { WordCommentListThread } from "../../hooks/useWordComments";
import type {
  WordCommentChipModel,
  WordOpenCommentsChipModel,
  WordPassageCommentsModel,
} from "../../utils/wordCommentChips";
import type { ComposerContextDetailRenderContext } from "@erato/frontend/library";

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  const { AlertMock } = await import("../../../test/helpers/contextLaneDouble");
  return mock.createEratoLibraryMock({ Alert: AlertMock });
});

const ACTIVITY = new Date("2026-09-04T07:00:00Z");
const thread = (
  over: Partial<WordCommentListThread> = {},
): WordCommentListThread => ({
  ref: "t7k",
  commentId: "1331001789",
  author: "Maya Krüger",
  status: "open",
  quote:
    "delivery dates set out in Schedule 2 of this agreement and its annexes",
  text: "Can we commit to these dates?",
  replies: 2,
  lastActivity: ACTIVITY,
  pos: 12,
  para: 9,
  inSelection: false,
  ...over,
});
const MAYA = thread();
const PAUL = thread({
  ref: "t9x",
  commentId: "99",
  author: "Paul Martin",
  text: "Legal wants a cap.",
  quote: "",
  replies: null,
  lastActivity: null,
});

const COVERAGE = {
  heading: "What is sent",
  lines: [
    "The comment by Maya Krüger, with its replies.",
    "Email addresses of comment authors are never sent.",
  ],
};

const threadModel = (
  over: Partial<WordCommentChipModel> = {},
): WordCommentChipModel => ({
  variant: "thread",
  origin: "ambient",
  state: "included",
  label: "Comment by Maya Krüger",
  spokenLabel: "Comments",
  meta: "At your cursor",
  removeLabel: "Send without comments",
  removeAction: "without",
  detail: {
    title: "Comment by Maya Krüger",
    why: "cursor",
    thread: MAYA,
    choices: [],
    coverage: COVERAGE,
    lifetime: "Leaving comments out lasts for the next message only.",
    notes: [],
    showInWordPicks: true,
  },
  actions: ["choose"],
  ...over,
});

const context = (): ComposerContextDetailRenderContext => ({
  locked: false,
  runAction: vi.fn(),
});

const renderDetail = (
  model: WordCommentChipModel,
  given = context(),
  handlers: Partial<{
    onShowInWord: (thread: WordCommentListThread) => Promise<"selected">;
    onPick: (ref: string) => void;
    onOpenPicker: () => void;
  }> = {},
) => {
  const props = {
    onShowInWord: vi.fn(async () => "selected" as const),
    onPick: vi.fn(),
    onOpenPicker: vi.fn(),
    ...handlers,
  };
  render(<WordCommentDetail model={model} context={given} {...props} />);
  return { ...props, context: given };
};

beforeEach(() => {
  i18n.load({ en: {}, de: {} });
  i18n.activate("en");
});
afterEach(cleanup);

describe("WordCommentDetail", () => {
  it("reads like Word shows the thread: why, where, Show in Word, the thread, what is sent", async () => {
    const { onShowInWord } = renderDetail(threadModel());
    const detail = document.querySelector('[data-ui="word-comment-detail"]');
    expect(detail).toHaveAttribute("data-variant", "thread");
    expect(
      document.querySelector('[data-ui="word-comment-detail-why"]'),
    ).toHaveTextContent("At your cursor");
    const where = document.querySelector<HTMLElement>(
      '[data-ui="word-comment-detail-quote"]',
    )!;
    expect(where).toHaveTextContent(
      "on “delivery dates set out in Schedule 2 of this …”",
    );
    expect(where).toContainElement(
      document.querySelector<HTMLElement>(
        '[data-ui="word-comment-detail-why"]',
      ),
    );
    expect(where).toContainElement(
      screen.getByRole("button", { name: "Show in Word" }),
    );
    const card = document.querySelector<HTMLElement>(
      '[data-ui="word-comment-detail-thread"]',
    )!;
    expect(card).toHaveTextContent("Maya Krüger");
    expect(card).toHaveTextContent("Can we commit to these dates?");
    expect(card).toHaveTextContent("2 replies");
    expect(card).toHaveTextContent("Open");
    // Never a paragraph number.
    expect(detail?.textContent).not.toMatch(/¶|\b12\b|para/i);
    const sent = document.querySelector<HTMLElement>(
      '[data-ui="word-comment-what-is-sent"]',
    )!;
    expect(within(sent).getByRole("heading")).toHaveTextContent("What is sent");
    expect(
      within(sent).getByRole("list", { name: "What is sent" }),
    ).toBeInTheDocument();
    expect(within(sent).getAllByRole("listitem")).toHaveLength(2);
    expect(detail).toHaveTextContent(
      "Leaving comments out lasts for the next message only.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Show in Word" }));
    await waitFor(() => expect(onShowInWord).toHaveBeenCalledWith(MAYA));
  });

  it("dates the thread in the app's language, not the browser's", () => {
    i18n.activate("de");
    renderDetail(threadModel());
    expect(
      document.querySelector('[data-ui="word-comment-detail-thread"]'),
    ).toHaveTextContent(
      new Intl.DateTimeFormat("de", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(ACTIVITY),
    );
  });

  it("leaves out the replies and the date Word did not list, never saying none", () => {
    renderDetail(
      threadModel({ detail: { ...threadModel().detail, thread: PAUL } }),
    );
    const card = document.querySelector(
      '[data-ui="word-comment-detail-thread"]',
    );
    expect(card).not.toHaveTextContent(/repl/);
    expect(card).not.toHaveTextContent("time unknown");
    expect(
      document.querySelector('[data-ui="word-comment-detail-quote"]'),
    ).toHaveTextContent("on a spot without highlighted text");
  });

  it.each(["", null])(
    "calls only a real point comment one (quote %j)",
    (quote) => {
      renderDetail(
        threadModel({
          detail: { ...threadModel().detail, thread: { ...MAYA, quote } },
        }),
      );
      const where = document.querySelector(
        '[data-ui="word-comment-detail-quote"]',
      )!;
      expect(
        where.textContent.includes("on a spot without highlighted text"),
      ).toBe(quote === "");
      expect(where).not.toHaveTextContent("on “");
      expect(
        screen.getByRole("button", { name: "Show in Word" }),
      ).toBeEnabled();
    },
  );

  it("chooses at the caret through the lane, with what to say once chosen", () => {
    const given = context();
    const { onPick, onOpenPicker } = renderDetail(
      threadModel({
        variant: "choose",
        state: "attention",
        detail: {
          title: "Your cursor is in 2 comments",
          why: null,
          thread: null,
          choices: [MAYA, PAUL],
          intro:
            "Your cursor is in more than one comment, so Erato does not know which one you mean.",
          coverage: null,
          lifetime: "Leaving comments out lasts for the next message only.",
          notes: [],
          showInWordPicks: false,
        },
      }),
      given,
    );
    const list = screen.getByRole("list", { name: "Comments at your cursor" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toHaveTextContent("Paul Martin");
    expect(buttons[1]).toHaveTextContent("Legal wants a cap.");

    fireEvent.click(buttons[1]);
    expect(given.runAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pick:t9x",
        announcement: "Comment by Paul Martin chosen.",
      }),
    );
    const action = vi.mocked(given.runAction).mock.calls[0][0];
    action.onSelect();
    expect(onPick).toHaveBeenCalledWith("t9x");

    fireEvent.click(screen.getByRole("button", { name: "Choose comment…" }));
    const choose = vi.mocked(given.runAction).mock.calls[1][0];
    expect(choose.announcement).toBeUndefined();
    choose.onSelect();
    expect(onOpenPicker).toHaveBeenCalledTimes(1);
  });

  it("notes a pick that is gone", () => {
    renderDetail(
      threadModel({
        variant: "gone",
        state: "error",
        detail: {
          title: "Chosen comment",
          why: null,
          thread: null,
          choices: [],
          coverage: null,
          lifetime: "A chosen comment stays…",
          showInWordPicks: false,
          notes: [
            {
              tone: "error",
              text: "The comment you chose is no longer in the document.",
            },
          ],
        },
      }),
    );
    expect(
      document.querySelector('[data-ui="word-context-detail-note"]'),
    ).toHaveTextContent("The comment you chose is no longer in the document.");
    expect(screen.queryByRole("button", { name: "Show in Word" })).toBeNull();
  });
});

describe("WordOpenCommentsDetail", () => {
  it("says why it shows, what it sends and how long leaving them out lasts", () => {
    const model: WordOpenCommentsChipModel = {
      state: "suggested",
      label: "Open comments (9)",
      restore: "include",
      actions: ["choose"],
      sendInsteadDismissesSelection: false,
      detail: {
        intro:
          "Shown while the document is off, so you can still send its comments without its text.",
        coverage: { heading: "If included", lines: ["The 9 open comments."] },
        lifetime: "Leaving them out lasts for this chat.",
        notes: [],
      },
    };
    render(<WordOpenCommentsDetail model={model} />);
    const detail = document.querySelector(
      '[data-ui="word-open-comments-detail"]',
    );
    expect(detail).toHaveTextContent("Shown while the document is off");
    expect(detail).toHaveTextContent("If included");
    expect(detail).toHaveTextContent("The 9 open comments.");
    expect(detail).toHaveTextContent("Leaving them out lasts for this chat.");
  });
});

describe("WordPassageCommentsSection", () => {
  const comments: WordPassageCommentsModel = {
    count: 1,
    checked: true,
    threads: [MAYA],
    why: "default",
    coverage: COVERAGE,
    switchTo: MAYA,
    offerChoose: true,
    readFailed: false,
    canChangeDefault: true,
  };

  it("lists the passage's threads and switches them off for one message", () => {
    const onSet = vi.fn();
    const { rerender } = render(
      <WordPassageCommentsSection
        comments={comments}
        locked={false}
        onSetPassageComments={onSet}
      />,
    );
    const section = document.querySelector<HTMLElement>(
      '[data-ui="word-context-detail-passage-comments"]',
    )!;
    expect(section).toHaveTextContent("Comments in this passage");
    expect(section).toHaveTextContent(
      "Maya Krüger · Can we commit to these dates?",
    );
    expect(section).toHaveTextContent("Your default");
    const checkbox = within(section).getByRole("checkbox", {
      name: "Send the comment in this passage",
    });
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAccessibleDescription(
      "Off lasts for this message only",
    );
    fireEvent.click(checkbox);
    expect(onSet).toHaveBeenCalledWith(false);

    rerender(
      <WordPassageCommentsSection
        comments={{ ...comments, count: 2, checked: false }}
        locked={false}
        onSetPassageComments={onSet}
      />,
    );
    const two = screen.getByRole("checkbox", {
      name: "Send the 2 comments in this passage",
    });
    expect(two).not.toBeChecked();
    fireEvent.click(two);
    expect(onSet).toHaveBeenLastCalledWith(true);
  });
});
