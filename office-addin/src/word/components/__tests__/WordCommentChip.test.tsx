import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_WORD_COMMENT_LIST } from "../../hooks/useWordComments";
import { resolveWordCommentSend } from "../../utils/wordCommentSend";
import { WordCommentChip, wordCommentChipView } from "../WordCommentChip";
import {
  wordCommentCoverageInfo,
  wordCommentCoverageLines,
} from "../WordCommentCoverage";

import type {
  WordCommentList,
  WordCommentListThread,
} from "../../hooks/useWordComments";
import type {
  WordCommentAdvertised,
  WordCommentSendInput,
} from "../../utils/wordCommentSend";
import type {
  WordCommentChipProps,
  WordCommentChipView,
} from "../WordCommentChip";

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock();
});

const thread = (
  overrides: Partial<WordCommentListThread> = {},
): WordCommentListThread => ({
  ref: "t7k",
  commentId: "1331001789",
  author: "Maya Krüger",
  status: "open",
  quote: "Zahlungsziel 30 Tage nach Rechnungseingang und Lieferung",
  text: "Bitte prüfen.",
  replies: 3,
  lastActivity: new Date("2026-09-04T07:00:00Z"),
  pos: 4,
  para: 9,
  inSelection: true,
  ...overrides,
});
const MAYA = thread();
const JONAS = thread({
  ref: "t2p",
  commentId: "760373734",
  author: "Jonas Weber",
  quote: "net 30 days",
  replies: 0,
  pos: 7,
});

const ALL: WordCommentAdvertised = {
  anchored: true,
  thread: true,
  map: new Set(["word_document_review"]),
};

const listOf = (
  threads: readonly WordCommentListThread[],
  selection: WordCommentList["selection"],
): WordCommentList => ({
  ...NO_WORD_COMMENT_LIST,
  status: "ready",
  threads,
  counts: {
    open: threads.filter((t) => t.status === "open").length,
    resolved: threads.filter((t) => t.status === "resolved").length,
  },
  selection,
});

/** The chip's view for a live state, through the same §8 plan Send resolves. */
function viewFor(
  list: WordCommentList,
  input: Partial<WordCommentSendInput> & { passage?: boolean },
): WordCommentChipView {
  const passage = input.passage ?? list.selection.kind === "passage";
  const plan = resolveWordCommentSend({
    advertised: ALL,
    selection: passage
      ? {
          kind: "passage",
          threads:
            list.selection.kind === "passage" ? list.selection.threads : [],
          rewritable: true,
        }
      : list.selection.kind === "caret"
        ? list.selection
        : { kind: "none" },
    precedence: "selection",
    pick: null,
    pickFound: true,
    override: null,
    documentIncluded: false,
    includeOpenComments: false,
    readFailed: false,
    ...input,
    withoutComments: false,
  });
  return wordCommentChipView({
    plan,
    list,
    passage,
    pick: input.pick ?? null,
    withoutComments: input.withoutComments ?? false,
  });
}

describe("wordCommentChipView", () => {
  const onePassage = listOf([MAYA, JONAS], {
    kind: "passage",
    threads: [MAYA.ref],
  });
  const twoPassage = listOf([MAYA, JONAS], {
    kind: "passage",
    threads: [MAYA.ref, JONAS.ref],
  });

  it("counts a passage's threads and offers the switch under the default", () => {
    expect(viewFor(onePassage, {})).toEqual({
      kind: "passage",
      threads: [MAYA],
      switchTo: MAYA,
      offerChoose: false,
      why: "default",
    });
  });

  it("never guesses between two threads: the passage goes and Choose comment is offered", () => {
    expect(viewFor(twoPassage, {})).toEqual({
      kind: "passage",
      threads: [MAYA, JONAS],
      switchTo: null,
      offerChoose: true,
      why: null,
    });
  });

  it("shows the thread under Work on the comment, with the way back to the passage", () => {
    expect(viewFor(onePassage, { precedence: "comment" })).toEqual({
      kind: "thread",
      thread: MAYA,
      why: "default",
      picked: false,
      backToPassage: true,
    });
  });

  it("says the switch was the user's", () => {
    expect(viewFor(onePassage, { override: "comment" })).toMatchObject({
      kind: "thread",
      why: "chosen",
    });
    expect(
      viewFor(onePassage, { precedence: "comment", override: "passage" }),
    ).toMatchObject({ kind: "passage", why: "chosen" });
  });

  it("names the thread at the cursor", () => {
    const caret = listOf([MAYA, JONAS], { kind: "caret", threads: [MAYA.ref] });
    expect(viewFor(caret, {})).toEqual({
      kind: "thread",
      thread: MAYA,
      why: "cursor",
      picked: false,
      backToPassage: false,
    });
  });

  it("asks for a choice with the cursor in two anchors", () => {
    const caret = listOf([MAYA, JONAS], {
      kind: "caret",
      threads: [MAYA.ref, JONAS.ref],
    });
    expect(viewFor(caret, {})).toEqual({ kind: "choose", count: 2 });
  });

  it("shows a pick as chosen by the user, and a pick that is gone", () => {
    const none = listOf([MAYA, JONAS], { kind: "none" });
    expect(viewFor(none, { pick: JONAS.ref })).toEqual({
      kind: "thread",
      thread: JONAS,
      why: "chosen",
      picked: true,
      backToPassage: false,
    });
    expect(viewFor(none, { pick: "tzz", pickFound: false })).toEqual({
      kind: "picked-gone",
    });
  });

  it("holds Send without comments only where comments would go", () => {
    expect(viewFor(onePassage, { withoutComments: true })).toEqual({
      kind: "without",
    });
    const empty = listOf([MAYA], { kind: "passage", threads: [] });
    expect(viewFor(empty, { withoutComments: true })).toEqual({
      kind: "none",
    });
  });

  it("lists the map with an included document", () => {
    const none = listOf([MAYA, JONAS], { kind: "none" });
    expect(viewFor(none, { documentIncluded: true })).toEqual({
      kind: "map",
      threads: 2,
    });
  });

  it("counts only the rows the map carries: placed threads, up to its first page", () => {
    const unplaced = {
      ...listOf([MAYA, JONAS], { kind: "none" }),
      unplaced: 3,
    };
    expect(viewFor(unplaced, { documentIncluded: true })).toEqual({
      kind: "map",
      threads: 2,
    });
    const many = listOf(
      Array.from({ length: 130 }, (_, i) =>
        thread({ ref: `t${(i + 100).toString(36)}`, pos: i + 1 }),
      ),
      { kind: "none" },
    );
    expect(viewFor(many, { documentIncluded: true })).toEqual({
      kind: "map",
      threads: 100,
    });
  });

  it("shows nothing when nothing is advertised", () => {
    expect(
      viewFor(onePassage, {
        advertised: { anchored: false, thread: false, map: new Set() },
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("WordCommentChip", () => {
  const props = (
    view: WordCommentChipView,
    overrides: Partial<WordCommentChipProps> = {},
  ): WordCommentChipProps => ({
    view,
    coverage: {
      sent: { kind: "selection", threads: 1 },
      nearby: "near",
      rest: 13,
    },
    canChangeDefault: true,
    onWithoutComments: vi.fn(),
    onWithComments: vi.fn(),
    onSwitch: vi.fn(),
    onDismissPick: vi.fn(),
    onChoose: vi.fn(),
    onChangeDefault: vi.fn(),
    onShowInWord: vi.fn(async () => "selected" as const),
    ...overrides,
  });

  beforeEach(() => i18n.activate("en"));
  afterEach(cleanup);

  it("has its own × that sends without comments", () => {
    const chip = props({
      kind: "passage",
      threads: [MAYA, JONAS],
      switchTo: null,
      offerChoose: true,
      why: null,
    });
    render(<WordCommentChip {...chip} />);

    expect(screen.getByTestId("word-comment-chip")).toHaveTextContent(
      "2 comments in selection",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Send without comments" }),
    );
    expect(chip.onWithoutComments).toHaveBeenCalledTimes(1);
    expect(chip.onDismissPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose comment…" }));
    expect(chip.onChoose).toHaveBeenCalledTimes(1);
  });

  it("switches to the comment and back", () => {
    const passage = props({
      kind: "passage",
      threads: [MAYA],
      switchTo: MAYA,
      offerChoose: false,
      why: "default",
    });
    render(<WordCommentChip {...passage} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Work on Maya Krüger's comment instead",
      }),
    );
    expect(passage.onSwitch).toHaveBeenCalledWith("comment");
    cleanup();

    const threadChip = props({
      kind: "thread",
      thread: MAYA,
      why: "chosen",
      picked: false,
      backToPassage: true,
    });
    render(<WordCommentChip {...threadChip} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Use selected passage instead" }),
    );
    expect(threadChip.onSwitch).toHaveBeenCalledWith("passage");
  });

  it("goes back to the passage from a pick by ending the pick", () => {
    const chip = props({
      kind: "thread",
      thread: MAYA,
      why: "chosen",
      picked: true,
      backToPassage: true,
    });
    render(<WordCommentChip {...chip} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Use selected passage instead" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the chosen comment" }),
    );
    expect(chip.onDismissPick).toHaveBeenCalledTimes(2);
    expect(chip.onSwitch).not.toHaveBeenCalled();
    expect(chip.onWithoutComments).not.toHaveBeenCalled();
  });

  it("reads like Word shows the thread, with Show in Word and never a paragraph number", async () => {
    const chip = props({
      kind: "thread",
      thread: { ...MAYA, pos: 12 },
      why: "chosen",
      picked: true,
      backToPassage: false,
    });
    const { container } = render(<WordCommentChip {...chip} />);

    expect(container).toHaveTextContent("Comment by Maya Krüger · 3 replies");
    expect(container).toHaveTextContent(
      "on “Zahlungsziel 30 Tage nach Rechnungseingang und …”",
    );
    expect(container.textContent).not.toMatch(/¶|\b12\b|para/i);
    fireEvent.click(screen.getByRole("button", { name: "Show in Word" }));
    await waitFor(() =>
      expect(chip.onShowInWord).toHaveBeenCalledWith(MAYA.commentId, MAYA.para),
    );
  });

  it.each(["", null])(
    "calls only a real point comment one (quote %j)",
    (quote) => {
      const { container } = render(
        <WordCommentChip
          {...props({
            kind: "thread",
            thread: { ...MAYA, quote },
            why: "chosen",
            picked: true,
            backToPassage: false,
          })}
        />,
      );

      expect(
        container.textContent.includes("on a spot without highlighted text"),
      ).toBe(quote === "");
      expect(container).not.toHaveTextContent("on “");
      expect(
        screen.getByRole("button", { name: "Show in Word" }),
      ).toBeEnabled();
    },
  );

  it.each([
    ["chosen", "Chosen by you"],
    ["cursor", "At your cursor"],
    ["default", "Your default"],
  ] as const)("tags why the thread goes: %s", (why, text) => {
    const chip = props({
      kind: "thread",
      thread: MAYA,
      why,
      picked: false,
      backToPassage: false,
    });
    render(<WordCommentChip {...chip} />);

    expect(screen.getByTestId("word-comment-why")).toHaveTextContent(text);
    fireEvent.click(screen.getByRole("button", { name: "Change default" }));
    expect(chip.onChangeDefault).toHaveBeenCalledTimes(1);
  });

  it("offers no Change default where the setting does not exist", () => {
    render(
      <WordCommentChip
        {...props(
          {
            kind: "thread",
            thread: MAYA,
            why: "default",
            picked: false,
            backToPassage: false,
          },
          { canChangeDefault: false },
        )}
      />,
    );
    expect(screen.queryByRole("button", { name: "Change default" })).toBeNull();
  });

  it("says what is sent, what Erato may read, the rest, the resolved rule and that emails never go", () => {
    render(
      <WordCommentChip
        {...props({
          kind: "passage",
          threads: [MAYA],
          switchTo: null,
          offerChoose: false,
          why: null,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "What is sent" }));

    const lines = screen.getByTestId("word-comment-coverage");
    expect(lines).toHaveTextContent(
      "The comment in your selection, with its replies.",
    );
    expect(lines).toHaveTextContent(
      "Erato may read up to 3 comments above and 3 below your selection.",
    );
    expect(lines).toHaveTextContent("13 other comments are not sent.");
    expect(lines).toHaveTextContent(
      "Resolved comments are sent only when they are in your selection or when you ask for them.",
    );
    expect(lines).toHaveTextContent(
      "Email addresses of comment authors are never sent.",
    );
    expect(lines).not.toHaveTextContent("Bitte prüfen.");
  });

  it("says for the map what it leaves out and that resolved comments are in it", () => {
    const list = {
      ...listOf([MAYA, thread({ ref: "t2p", status: "resolved" })], {
        kind: "none",
      }),
      unplaced: 3,
    };
    const plan = resolveWordCommentSend({
      advertised: ALL,
      selection: { kind: "none" },
      precedence: "selection",
      pick: null,
      pickFound: true,
      override: null,
      withoutComments: false,
      documentIncluded: true,
      includeOpenComments: false,
      readFailed: false,
    });
    const info = wordCommentCoverageInfo(plan, list, {
      document: true,
      picked: false,
      openComments: false,
    });
    expect(info).toMatchObject({ sent: { kind: "map", threads: 2 }, rest: 3 });
    const lines = wordCommentCoverageLines(info!);
    expect(lines).toContain("3 other comments are not sent.");
    expect(lines).toContain(
      "The list includes resolved comments too, each with how it starts.",
    );
    expect(lines.join(" ")).not.toContain(
      "Resolved comments are sent only when",
    );
  });

  it("can take Send without comments back", () => {
    const chip = props({ kind: "without" });
    render(<WordCommentChip {...chip} />);

    fireEvent.click(screen.getByRole("button", { name: "Include comments" }));
    expect(chip.onWithComments).toHaveBeenCalledTimes(1);
  });
});
