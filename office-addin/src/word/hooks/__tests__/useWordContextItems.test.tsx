import { i18n } from "@lingui/core";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useWordContextItems,
  WORD_COMMENT_CHIP_ID,
  WORD_DOCUMENT_CHIP_ID,
  WORD_OPEN_COMMENTS_CHIP_ID,
  WORD_SELECTION_CHIP_ID,
} from "../useWordContextItems";

import type {
  WordCommentChipModel,
  WordOpenCommentsChipModel,
} from "../../utils/wordCommentChips";
import type {
  WordDocumentChipModel,
  WordSelectionChipModel,
} from "../../utils/wordContextChips";
import type {
  WordContextHandlers,
  WordContextItemsInput,
} from "../useWordContextItems";

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock();
});

const handlers = (): WordContextHandlers => ({
  dismissSelection: vi.fn(),
  rearmSelection: vi.fn(),
  armSelection: vi.fn(),
  excludeDocument: vi.fn(),
  includeDocument: vi.fn(),
  retryDocument: vi.fn(),
  sendDocumentInstead: vi.fn(),
  withoutComments: vi.fn(),
  restoreComments: vi.fn(),
  endPick: vi.fn(),
  sendPassageInstead: vi.fn(),
  sendCommentInstead: vi.fn(),
  sendInsteadOfComment: vi.fn(),
  pickComment: vi.fn(),
  openPicker: vi.fn(),
  changeDefault: vi.fn(),
  includeOpenComments: vi.fn(),
  excludeOpenComments: vi.fn(),
  setPassageComments: vi.fn(),
  showComment: vi.fn(async () => "selected" as const),
});

const selection: WordSelectionChipModel = {
  state: "superseded",
  meta: "Replaced by comment",
  removeLabel: "Dismiss selection",
  restore: "rearm",
  title: "Selected passage",
  text: "Payment is due within 30 days.",
  cut: false,
  paragraphs: "1 paragraph",
  notes: [],
  lifetime: "Leaving it out lasts until the selection changes.",
  comments: null,
  actions: ["send-instead"],
};

const document: WordDocumentChipModel = {
  state: "superseded",
  meta: "Replaced by comment",
  removeLabel: "Don't include this document",
  restore: "include",
  actions: ["send-instead-of-comment", "choose"],
  notes: [],
  coverage: null,
  comments: [],
  lifetime: "Leaving it out lasts for this chat.",
};

const comment: WordCommentChipModel = {
  variant: "thread",
  origin: "ambient",
  state: "included",
  label: "Comment by Maya Krüger",
  spokenLabel: "Comments",
  meta: "Your default",
  removeLabel: "Send without comments",
  removeAction: "without",
  removedAnnouncement:
    "Comments removed for this message. Include again with +",
  detail: {
    title: "Comment by Maya Krüger",
    why: "default",
    thread: null,
    choices: [],
    coverage: null,
    lifetime: "Leaving comments out lasts for the next message only.",
    notes: [],
    showInWordPicks: true,
  },
  actions: ["choose", "passage-instead", "change-default"],
};

const openComments: WordOpenCommentsChipModel = {
  state: "superseded",
  label: "Open comments (9)",
  meta: "Replaced by comment",
  removeLabel: "Don't include open comments",
  restore: "include",
  actions: ["choose", "send-instead"],
  sendInsteadDismissesSelection: false,
  detail: {
    intro: "Shown while the document is off.",
    coverage: null,
    lifetime: "Leaving them out lasts for this chat.",
    notes: [],
  },
};

const input = (
  over: Partial<WordContextItemsInput> = {},
): WordContextItemsInput => ({
  selection,
  document,
  comment,
  openComments,
  documentName: "Supply agreement.docx",
  locked: false,
  reportOptions: { chatId: "chat-1" },
  handlers: handlers(),
  ...over,
});

beforeEach(() => {
  i18n.activate("en");
});

describe("useWordContextItems", () => {
  it("orders the chips selection, document, comment, open comments", () => {
    const { result } = renderHook(() => useWordContextItems(input()));
    expect(result.current.map((item) => item.id)).toEqual([
      WORD_SELECTION_CHIP_ID,
      WORD_DOCUMENT_CHIP_ID,
      WORD_COMMENT_CHIP_ID,
      WORD_OPEN_COMMENTS_CHIP_ID,
    ]);
    expect(result.current.map((item) => item.kind)).toEqual([
      "word.selection",
      "word.document",
      "word.comment",
      "word.openComments",
    ]);
  });

  it("keeps the same array for the same models and handlers", () => {
    const given = input();
    const { result, rerender } = renderHook(
      (props: WordContextItemsInput) => useWordContextItems(props),
      { initialProps: given },
    );
    const first = result.current;
    rerender({
      ...given,
      comment: { ...comment, detail: { ...comment.detail } },
    });
    expect(result.current).toBe(first);
    rerender({ ...given, comment: { ...comment, meta: "Chosen by you" } });
    expect(result.current).not.toBe(first);
  });

  it("gives the comment chip one id across origins, and names its controls as the (x) does", () => {
    const given = input();
    const { result, rerender } = renderHook(
      (props: WordContextItemsInput) => useWordContextItems(props),
      { initialProps: given },
    );
    const ambient = result.current.find(
      (item) => item.id === WORD_COMMENT_CHIP_ID,
    )!;
    expect(ambient).toMatchObject({
      origin: "ambient",
      dismissScope: "message",
      icon: "comment",
      removeLabel: "Send without comments",
      removeActionLabel: "Send without comments",
      announcements: {
        removed: "Comments removed for this message. Include again with +",
      },
    });
    ambient.onRemove?.();
    expect(given.handlers.withoutComments).toHaveBeenCalledTimes(1);
    expect(ambient.detail?.actions?.map((action) => action.label)).toEqual([
      "Choose comment…",
      "Use selected passage instead",
      "Change default",
    ]);
    expect(ambient.detail?.actions?.[1].announcement).toBe(
      "Selection included. The comment is not sent with this message.",
    );

    rerender({
      ...given,
      comment: {
        ...comment,
        origin: "user",
        removeAction: "end-pick",
        removeLabel: "Remove the chosen comment",
        removedAnnouncement: undefined,
      },
    });
    const user = result.current.find(
      (item) => item.id === WORD_COMMENT_CHIP_ID,
    )!;
    expect(user.origin).toBe("user");
    expect(user).not.toHaveProperty("dismissScope");
    // A choice keeps the chip before the open comments in the lane.
    expect(ambient.placement).toBe("ambient");
    expect(user.placement).toBe("ambient");
    user.onRemove?.();
    expect(given.handlers.endPick).toHaveBeenCalledTimes(1);

    rerender({
      ...given,
      comment: {
        ...comment,
        variant: "choose",
        state: "suggested",
        restoreLabel: "Include comments",
      },
    });
    const suggested = result.current.find(
      (item) => item.id === WORD_COMMENT_CHIP_ID,
    )!;
    expect(suggested).toMatchObject({
      icon: "comments",
      restoreLabel: "Include comments",
    });
    suggested.onRestore?.();
    expect(given.handlers.restoreComments).toHaveBeenCalledTimes(1);
  });

  it("lets Show in Word pick the thread only where the model says so", async () => {
    const given = input();
    const { result, rerender } = renderHook(
      (props: WordContextItemsInput) => useWordContextItems(props),
      { initialProps: given },
    );
    const thread = {
      ref: "t1",
      commentId: "1",
      author: "Maya Krüger",
      status: "open" as const,
      quote: "delivery dates",
      text: "Can we commit?",
      replies: null,
      lastActivity: null,
      pos: 1,
      para: 9,
      inSelection: false,
    };
    const showFrom = (items: typeof result.current) => {
      const item = items.find((entry) => entry.id === WORD_COMMENT_CHIP_ID)!;
      const body = item.detail!.render({ locked: false, runAction: vi.fn() });
      return (
        body as { props: { onShowInWord: (t: typeof thread) => unknown } }
      ).props.onShowInWord;
    };
    await showFrom(result.current)(thread);
    expect(given.handlers.showComment).toHaveBeenLastCalledWith(thread, true);
    rerender({
      ...given,
      comment: {
        ...comment,
        state: "suggested",
        restoreLabel: "Include comments",
        detail: { ...comment.detail, showInWordPicks: false },
      },
    });
    await showFrom(result.current)(thread);
    expect(given.handlers.showComment).toHaveBeenLastCalledWith(thread, false);
  });

  it("draws no + on an open-comments chip that only leads to the picker", () => {
    const { result } = renderHook(() =>
      useWordContextItems(
        input({
          openComments: {
            ...openComments,
            state: "suggested",
            meta: "None open",
            removeLabel: undefined,
            restore: null,
            actions: ["choose"],
          },
        }),
      ),
    );
    const open = result.current.find(
      (item) => item.id === WORD_OPEN_COMMENTS_CHIP_ID,
    )!;
    expect(open.state).toBe("suggested");
    expect(open.onRestore).toBeUndefined();
    expect(open.onRemove).toBeUndefined();
    expect(open.detail?.actions?.map((action) => action.id)).toEqual([
      "choose",
    ]);
  });

  it("sends the superseded item instead, with what it means", () => {
    const given = input();
    const { result } = renderHook(() => useWordContextItems(given));
    const [sel, doc, , open] = result.current;
    const action = (item: (typeof result.current)[number]) =>
      item.detail?.actions?.find((entry) => entry.id === "send-instead");

    expect(action(sel)?.announcement).toBe(
      "Selection included. The comment is not sent with this message.",
    );
    action(sel)?.onSelect();
    expect(given.handlers.sendPassageInstead).toHaveBeenCalledTimes(1);
    // The selection is replaced too, so it is turned off as the document goes.
    expect(action(doc)?.announcement).toBe(
      "Document included. Your selection is off until it changes.",
    );
    action(doc)?.onSelect();
    expect(given.handlers.sendInsteadOfComment).toHaveBeenCalledTimes(1);
    expect(action(open)?.announcement).toBe(
      "Open comments included. The comment is not sent with this message.",
    );

    const { result: alone } = renderHook(() =>
      useWordContextItems({ ...input(), selection: null }),
    );
    expect(action(alone.current[0])?.announcement).toBe(
      "Document included. The comment is not sent with this message.",
    );
  });

  it("locks the open comments with the chat, as the document is", () => {
    const { result } = renderHook(() =>
      useWordContextItems(input({ locked: true })),
    );
    const open = result.current.find(
      (item) => item.id === WORD_OPEN_COMMENTS_CHIP_ID,
    )!;
    expect(open).toMatchObject({
      locked: true,
      lockReason:
        "Can't change this while the chat is archived or a task is running",
      removeLabel: "Don't include open comments",
    });
    expect(open.detail?.actions?.map((action) => action.id)).toEqual([
      "choose",
    ]);
    const doc = result.current.find(
      (item) => item.id === WORD_DOCUMENT_CHIP_ID,
    )!;
    expect(doc.detail?.actions?.map((action) => action.id)).toEqual(["choose"]);
    // The comment gestures are for the next message only, so they stay open.
    expect(
      result.current.find((item) => item.id === WORD_COMMENT_CHIP_ID)?.locked,
    ).toBeUndefined();
  });
});
