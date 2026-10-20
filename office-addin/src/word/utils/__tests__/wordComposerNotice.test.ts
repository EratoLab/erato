import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { wordComposerNotice } from "../wordComposerNotice";

import type {
  WordComposerNoticeHandlers,
  WordComposerNoticeState,
} from "../wordComposerNotice";

const IDLE: WordComposerNoticeState = {
  commentBlock: null,
  threadAdvertised: true,
  chipEnabled: true,
  slowCapture: false,
  commentProgress: null,
  selectionReadFailed: false,
  captureNotice: null,
  budgetIssue: undefined,
  dismissed: new Set(),
};

const handlers = (): WordComposerNoticeHandlers => ({
  openPicker: vi.fn(),
  sendWithoutComments: vi.fn(),
  sendWithoutDocument: vi.fn(),
  dismissSelectionReadFailed: vi.fn(),
  dismiss: vi.fn(),
});

const notice = (state: Partial<WordComposerNoticeState>, given = handlers()) =>
  wordComposerNotice({ ...IDLE, ...state }, given);

beforeEach(() => {
  i18n.activate("en");
});

describe("wordComposerNotice", () => {
  it("is null while nothing waits", () => {
    expect(notice({})).toBeNull();
  });

  it("asks which comment, with the picker and the way out, never dismissible", () => {
    const given = handlers();
    const choose = notice({ commentBlock: "choose-comment" }, given);
    expect(choose).toMatchObject({
      id: "word.comments.block.choose",
      tone: "warning",
      text: "Your cursor is in more than one comment, so Erato does not know which one you mean.",
    });
    expect(choose?.onDismiss).toBeUndefined();
    expect(choose?.actions?.map((action) => action.label)).toEqual([
      "Choose comment…",
      "Send without comments",
    ]);
    choose?.actions?.[0].onSelect();
    expect(given.openPicker).toHaveBeenCalledTimes(1);
    choose?.actions?.[1].onSelect();
    expect(given.sendWithoutComments).toHaveBeenCalledTimes(1);

    expect(
      notice({
        commentBlock: "choose-comment",
        threadAdvertised: false,
      })?.actions?.map((action) => action.label),
    ).toEqual(["Send without comments"]);
  });

  it("says a pick is gone, with the same two answers", () => {
    const gone = notice({ commentBlock: "picked-gone" });
    expect(gone).toMatchObject({
      id: "word.comments.block.gone",
      tone: "warning",
      text: "The comment you chose is no longer in the document.",
    });
    expect(gone?.actions).toHaveLength(2);
  });

  it("states a failed comment read as an error with one answer", () => {
    const failed = notice({ commentBlock: "read-failed" });
    expect(failed).toMatchObject({
      id: "word.comments.block.readFailed",
      tone: "error",
      text: "Erato could not read the comments in Word.",
    });
    expect(failed?.actions?.map((action) => action.label)).toEqual([
      "Send without comments",
    ]);
    expect(failed?.onDismiss).toBeUndefined();
  });

  it("offers to send without the document while Word is slow", () => {
    const given = handlers();
    const slow = notice({ slowCapture: true }, given);
    expect(slow).toMatchObject({
      id: "word.send.slowCapture",
      tone: "info",
      busy: true,
      text: "Word is still handing over the document.",
    });
    slow?.actions?.[0].onSelect();
    expect(given.sendWithoutDocument).toHaveBeenCalledTimes(1);
    expect(notice({ slowCapture: true, chipEnabled: false })).toBeNull();
  });

  it("counts the comment reads apart from the words, which are spoken once", () => {
    expect(notice({ commentProgress: { done: 3, total: 12 } })).toMatchObject({
      id: "word.comments.progress",
      tone: "info",
      busy: true,
      text: "Reading comments…",
      progressLabel: "3 of 12",
    });
    expect(
      notice({ commentProgress: { done: 0, total: 0 } })?.progressLabel,
    ).toBeUndefined();
  });

  it("states a failed selection read as an error the user can dismiss", () => {
    const given = handlers();
    const failed = notice({ selectionReadFailed: true }, given);
    expect(failed).toMatchObject({
      id: "word.selection.readFailed",
      tone: "error",
    });
    expect(failed?.text).toMatch(/^Erato could not read your selection/);
    failed?.onDismiss?.();
    expect(given.dismissSelectionReadFailed).toHaveBeenCalledTimes(1);
  });

  it("notes the capture and budget outcomes of the last Send until dismissed", () => {
    const given = handlers();
    const previous = notice({ captureNotice: "previous-capture" }, given);
    expect(previous).toMatchObject({
      id: "word.send.previousCapture",
      tone: "warning",
    });
    previous?.onDismiss?.();
    expect(given.dismiss).toHaveBeenCalledWith("word.send.previousCapture");
    expect(
      notice({
        captureNotice: "previous-capture",
        dismissed: new Set(["word.send.previousCapture"]),
      }),
    ).toBeNull();
    expect(notice({ captureNotice: "not-included" })?.text).toBe(
      "Reading the document took too long, so this message was sent without it.",
    );
    expect(notice({ budgetIssue: "model-budget" })).toMatchObject({
      id: "word.send.budget.model-budget",
      tone: "warning",
    });
    expect(
      notice({
        budgetIssue: "model-budget",
        dismissed: new Set(["word.send.budget.model-budget"]),
      }),
    ).toBeNull();
    // Notes about the document are moot once it is off.
    expect(
      notice({
        chipEnabled: false,
        captureNotice: "not-included",
        budgetIssue: "model-budget",
      }),
    ).toBeNull();
  });

  it("shows one at a time, the waiting Send first, then the next as each clears", () => {
    const all: Partial<WordComposerNoticeState> = {
      commentBlock: "choose-comment",
      slowCapture: true,
      commentProgress: { done: 1, total: 2 },
      selectionReadFailed: true,
      captureNotice: "previous-capture",
      budgetIssue: "budget-unavailable",
    };
    const order = [
      "word.comments.block.choose",
      "word.send.slowCapture",
      "word.comments.progress",
      "word.selection.readFailed",
      "word.send.previousCapture",
      "word.send.budget.budget-unavailable",
    ];
    const clears: Partial<WordComposerNoticeState>[] = [
      { commentBlock: null },
      { slowCapture: false },
      { commentProgress: null },
      { selectionReadFailed: false },
      { captureNotice: null },
    ];
    let state = all;
    for (const [index, id] of order.entries()) {
      expect(notice(state)?.id).toBe(id);
      state = { ...state, ...clears[index] };
    }
  });
});
