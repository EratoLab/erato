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

import {
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import { NO_WORD_COMMENT_LIST } from "../../hooks/useWordComments";
import { wordCommentGestureStore } from "../../hooks/wordCommentGestureStore";
import { wordSelectionStore } from "../../hooks/wordSelectionStore";
import {
  forgetWordCommentRefs,
  wordCommentRefRegistry,
} from "../../utils/wordCommentRefs";
import { resolveWordCommentSend } from "../../utils/wordCommentSend";
import { WORD_SELECTION_ARG_KEYS } from "../../utils/wordSelectionArgs";
import { WordChatInput } from "../WordChatInput";
import { WordCommentChip, wordCommentChipView } from "../WordCommentChip";
import {
  wordCommentCoverageInfo,
  wordCommentCoverageLines,
} from "../WordCommentCoverage";

import type { AddinChatInputRenderProps } from "../../../core/AddinChatCore";
import type { CommentHost } from "../../../test/mocks/word/commentHost";
import type {
  WordCommentList,
  WordCommentListThread,
} from "../../hooks/useWordComments";
import type {
  WordCommentAdvertised,
  WordCommentSendInput,
} from "../../utils/wordCommentSend";
import type { WordSelectionSnapshot } from "../../utils/wordSelectionAnchor";
import type {
  WordCommentChipProps,
  WordCommentChipView,
} from "../WordCommentChip";
import type { ReactNode } from "react";

const host = vi.hoisted(() => ({
  facets: [] as { id: string; allowed_args?: string[] }[],
  includeDocument: false,
  precedence: "selection",
  captureSelection: vi.fn(),
}));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useFacets: () => ({ data: { action_facets: host.facets } }),
    Alert: ({ children }: { children: ReactNode }) => (
      <div role="alert">{children}</div>
    ),
  });
});

vi.mock("../../../core/AddinChatInputCore", () => ({
  AddinChatInputCore: ({
    onSendMessage,
  }: {
    onSendMessage: (message: string) => void;
  }) => (
    <button
      type="button"
      data-testid="send"
      onClick={() => onSendMessage("Fix this")}
    >
      send
    </button>
  ),
}));

vi.mock("../../hooks/useWordDocumentSource", () => ({
  useWordDocumentSource: () => ({
    preview: {
      status: "included",
      coverage: null,
      changedSinceLastSend: false,
      reading: false,
    },
    capture: vi.fn(),
    captureExpectedSlow: () => false,
    previousCapture: () => null,
    markSent: () => {},
  }),
}));

vi.mock("../../hooks/useWordSelection", () => ({
  useWordSelection: () => {},
}));

vi.mock("../../utils/wordSelectionCapture", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  captureWordSelection: () => host.captureSelection(),
}));

vi.mock("../../utils/wordDocumentReadTool", () => ({
  WORD_READ_TOOL: "read_document_blocks",
  wordDocumentReadSession: { activate: vi.fn(), clear: vi.fn() },
}));

vi.mock("../../utils/wordDocumentReadRequest", () => ({
  bindWordDocumentReadRequest: () => () => {},
}));

vi.mock("../../utils/wordDocumentSubmission", () => ({
  WORD_SUBMIT_PLAN_TOOL: "submit_document_plan",
  createWordDocumentSubmissionExecutor: () => vi.fn(),
}));

vi.mock("../../wordPreferences", () => ({
  useWordIncludeDocumentByDefault: () => [host.includeDocument, () => {}],
  useWordCommentPrecedence: () => [host.precedence, () => {}],
}));

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
      expect(chip.onShowInWord).toHaveBeenCalledWith(MAYA.commentId),
    );
  });

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

describe("WordChatInput comment chips", () => {
  const IDENTITY = "https://contoso.sharepoint.com/Shared%20Documents/a.docx";
  const THREAD_FACET = {
    id: "word_comment_thread",
    allowed_args: [
      "document_name",
      "document_identity",
      "thread_json",
      "comments_json",
    ],
  };
  let word: CommentHost;
  let handedOver: Parameters<AddinChatInputRenderProps["onSendMessage"]>[];
  const openSettings = vi.fn();

  const passageOverT1 = (): WordSelectionSnapshot => ({
    role: "rewrite",
    reasonCode: null,
    shape: "inline",
    story: "main",
    origin: "user",
    selectedText: "alpha bravo",
    truncated: false,
    paragraphCount: 1,
    paragraphs: [
      {
        id: "{0000-T1P}",
        text: "T1P Thread one anchor alpha bravo charlie.",
        rangeText: "T1P Thread one anchor alpha bravo charlie.",
        index: word.ordinalOf("T1P") - 1,
        styleName: "Normal",
        tableNestingLevel: 0,
      },
    ],
    startOffset: 22,
    endOffset: 33,
    occurrence: 0,
    anchor: null,
    contextBefore: "T1P Thread one anchor ",
    contextAfter: " charlie.",
  });
  const publishSelection = (key: string, origin: "user" | "erato" = "user") =>
    act(() =>
      wordSelectionStore.publish({
        preview: {
          key,
          text: "alpha bravo",
          paragraphCount: 1,
          shape: "inline",
          story: "main",
          truncated: false,
          mayRewrite: true,
        },
        origin,
        armed: origin === "user",
        pending: false,
      }),
    );
  const selectT1 = () => {
    word = installWordCommentHost({
      selection: { tag: "T1P", offset: 22, to: { tag: "T1P", offset: 33 } },
    });
    host.captureSelection.mockResolvedValue({
      status: "ok",
      value: passageOverT1(),
    });
    publishSelection("T1P:alpha bravo");
  };
  const renderInput = () =>
    render(
      <WordChatInput
        chatInputProps={
          {
            chatId: "chat-1",
            onSendMessage: (
              ...args: Parameters<AddinChatInputRenderProps["onSendMessage"]>
            ) => handedOver.push(args),
          } as unknown as AddinChatInputRenderProps
        }
        documentIdentity={IDENTITY}
        stagePendingCapture={() => {}}
        onOpenWordSettings={openSettings}
      />,
    );
  const prepared = async () => {
    const prepare = handedOver.at(-1)?.[11];
    if (!prepare) throw new Error("the send was not prepared");
    let result = null as Awaited<ReturnType<typeof prepare.run>>;
    await act(async () => {
      result = await prepare.run(new AbortController().signal);
    });
    return result;
  };

  beforeEach(() => {
    i18n.activate("en");
    host.facets = [
      { id: "word_selection", allowed_args: [...WORD_SELECTION_ARG_KEYS] },
      THREAD_FACET,
    ];
    host.includeDocument = false;
    host.precedence = "selection";
    host.captureSelection.mockReset();
    openSettings.mockReset();
    handedOver = [];
  });

  afterEach(() => {
    cleanup();
    uninstallWordCommentHost();
    wordSelectionStore.resetForTests();
    wordCommentGestureStore.resetForTests();
    forgetWordCommentRefs();
  });

  it("sends the passage without comments from the comment chip's ×, and keeps the passage", async () => {
    selectT1();
    renderInput();
    expect(await screen.findByTestId("word-comment-chip")).toHaveTextContent(
      "1 comment in selection",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Send without comments" }),
    );
    expect(screen.getByTestId("word-selection-chip")).toBeInTheDocument();
    expect(screen.getByTestId("word-comment-chip")).toHaveTextContent(
      "This message is sent without comments.",
    );
    fireEvent.click(screen.getByTestId("send"));
    const result = await prepared();

    expect(result?.actionFacet?.id).toBe("word_selection");
    expect(result?.actionFacet?.args?.selected_text).toBe("alpha bravo");
    expect(result?.actionFacet?.args?.anchored_comments).toBe("");
  });

  it("keeps the comments when the selection's own × dismisses the passage", async () => {
    selectT1();
    renderInput();
    await screen.findByTestId("word-comment-chip");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss selection" }));
    expect(screen.queryByTestId("word-selection-chip")).toBeNull();
    expect(wordCommentGestureStore.getSnapshot().withoutComments).toBe(false);
  });

  it("opens the Word settings from Change default", async () => {
    selectT1();
    renderInput();
    await screen.findByTestId("word-comment-why");

    fireEvent.click(screen.getByRole("button", { name: "Change default" }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("switches the next message to the comment from the chip", async () => {
    selectT1();
    renderInput();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Work on Maya Krüger's comment instead",
      }),
    );
    expect(screen.getByTestId("word-selection-chip")).toHaveTextContent(
      "The comment below is sent instead of this passage.",
    );
    expect(screen.getByTestId("word-comment-chip")).toHaveTextContent(
      "Comment by Maya Krüger · 2 replies",
    );
    fireEvent.click(screen.getByTestId("send"));

    expect((await prepared())?.actionFacet?.id).toBe("word_comment_thread");
  });

  it("keeps a pick until another pick, its × or a new selection of the user's", async () => {
    selectT1();
    renderInput();
    await screen.findByTestId("word-comment-chip");
    const pick = (ref: string) =>
      act(() =>
        wordCommentGestureStore.pick({
          kind: "pick",
          ref,
          selectionKey: "T1P:alpha bravo",
        }),
      );
    const picked = () => wordCommentGestureStore.getSnapshot().pick?.ref;
    const refOf = (key: string) =>
      wordCommentRefRegistry(IDENTITY).refs.get(`id:${word.commentId(key)}`)!;
    const [t5, t8, t9] = [refOf("T5"), refOf("T8"), refOf("T9")];

    pick(t5);
    fireEvent.click(screen.getByTestId("send"));
    expect((await prepared())?.actionFacet?.id).toBe("word_comment_thread");
    expect(picked()).toBe(t5);

    publishSelection("T1P:alpha bravo", "erato");
    expect(picked()).toBe(t5);
    publishSelection("T1P:alpha bravo");
    expect(picked()).toBe(t5);

    pick(t8);
    expect(picked()).toBe(t8);
    publishSelection("T8P:kilo");
    expect(picked()).toBeUndefined();

    pick(t9);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove the chosen comment" }),
    );
    expect(picked()).toBeUndefined();
  });

  it("lets the user choose the thread a waiting send goes with", async () => {
    word = installWordCommentHost({ selection: { tag: "T6P", offset: 20 } });
    host.facets = [THREAD_FACET];
    renderInput();
    fireEvent.click(screen.getByTestId("send"));
    const prepare = handedOver.at(-1)?.[11];
    let run!: Promise<unknown>;
    act(() => {
      run = prepare!.run(new AbortController().signal);
    });

    const block = await screen.findByTestId("word-comment-block");
    fireEvent.click(
      within(block).getByRole("button", { name: "Choose comment…" }),
    );
    const t7 = wordCommentRefRegistry(IDENTITY).refs.get(
      `id:${word.commentId("T7")}`,
    );
    const row = await waitFor(() => {
      const found = screen
        .getAllByTestId("word-comment-picker-row")
        .find((r) => r.getAttribute("data-ref") === t7);
      if (!found) throw new Error("T7 is not listed yet");
      return found;
    });
    expect(row).toHaveTextContent("In your selection");
    fireEvent.click(within(row).getByText("Jonas Weber"));
    let result: unknown;
    await act(async () => {
      result = await run;
    });

    expect(result).toMatchObject({
      actionFacet: { id: "word_comment_thread" },
    });
    const args = (result as { actionFacet: { args: Record<string, string> } })
      .actionFacet.args;
    expect(JSON.parse(args.thread_json)).toMatchObject({ id: t7 });
    expect(wordCommentGestureStore.getSnapshot().pick?.ref).toBe(t7);
    expect(screen.queryByTestId("word-comment-picker")).toBeNull();
  });

  it("shows nothing about comments while nothing is advertised", async () => {
    host.facets = [
      {
        id: "word_selection",
        allowed_args: WORD_SELECTION_ARG_KEYS.filter(
          (key) => key !== "anchored_comments",
        ),
      },
    ];
    selectT1();
    renderInput();
    await screen.findByTestId("word-selection-chip");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByTestId("word-comment-chip")).toBeNull();
    expect(screen.queryByTestId("word-comment-options")).toBeNull();
    expect(word.calls()).toEqual([]);
  });
});
