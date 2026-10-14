import { afterEach, describe, expect, it } from "vitest";

import {
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import { showWordComment } from "../wordCommentShow";
import {
  consumeProgrammaticSelectionEvent,
  onProgrammaticWordSelection,
  resetProgrammaticWordSelectionForTests,
} from "../wordProgrammaticSelection";

import type { CommentHostFlavour } from "../../../test/mocks/word/commentHost";

describe("showWordComment", () => {
  afterEach(() => {
    uninstallWordCommentHost();
    resetProgrammaticWordSelectionForTests();
  });

  it.each<CommentHostFlavour>(["pc", "mac"])(
    "selects a multi-paragraph anchor whole on %s",
    async (host) => {
      const word = installWordCommentHost({ host });

      expect(await showWordComment(word.commentId("T3"))).toBe("selected");
      expect(word.selected()).toEqual(word.anchorOf("T3"));
    },
  );

  /** A whole paragraph as the host reports a select of its Content range. */
  const paragraph = (tag: string) =>
    expect.objectContaining({ first: tag, last: tag, from: 0 });

  it("never selects across paragraphs on the web: the first paragraph stands in", async () => {
    const word = installWordCommentHost({ host: "web" });

    expect(await showWordComment(word.commentId("T3"))).toBe("selected");
    expect(word.selected()).toEqual(paragraph("T3A"));
    expect(word.calls()).not.toContain("range.expandTo");
  });

  it("selects the paragraph an anchor is in on the web, never the comment's range", async () => {
    const word = installWordCommentHost({ host: "web" });

    expect(await showWordComment(word.commentId("T1"))).toBe("selected");
    expect(word.selected()).toEqual(paragraph("T1P"));
    expect(word.calls()).toContain("paragraph.getComments");
    expect(word.rangesRead()).toEqual([]);
  });

  it("marks the select as Erato's, so the selection is not taken for the user's", async () => {
    const word = installWordCommentHost({ host: "pc" });
    let marks = 0;
    const stop = onProgrammaticWordSelection(() => {
      marks += 1;
    });

    await showWordComment(word.commentId("T1"));
    stop();

    expect(marks).toBe(1);
    expect(consumeProgrammaticSelectionEvent()).toBe(true);
    expect(consumeProgrammaticSelectionEvent()).toBe(false);
  });

  it("finds the comment by String(Comment.id), which the web returns as a number", async () => {
    const word = installWordCommentHost({ host: "web" });
    expect(typeof word.listedIds()[0]).toBe("number");

    expect(await showWordComment(word.commentId("T8"))).toBe("selected");
    expect(word.selected()).toEqual(paragraph("T8P"));
  });

  it("shows T10's paragraph on the web and leaves its hidden text hidden (gate F1)", async () => {
    const word = installWordCommentHost({ host: "web" });

    expect(await showWordComment(word.commentId("T10"))).toBe("selected");
    expect(word.selected()).toEqual(paragraph("T10P"));
    expect(word.rangesRead()).toEqual([]);
    expect(word.unhidden()).toEqual([]);
  });

  it("selects nothing on the web for a comment no paragraph lists", async () => {
    const word = installWordCommentHost({
      host: "web",
      unlistedByParagraphs: ["T1"],
    });

    expect(await showWordComment(word.commentId("T1"))).toBe("changed");
    expect(word.selected()).toBeNull();
  });

  it("shows T10 on desktop, where reading its range changes nothing", async () => {
    const word = installWordCommentHost({ host: "pc" });

    expect(await showWordComment(word.commentId("T10"))).toBe("selected");
    expect(word.selected()).toEqual(word.anchorOf("T10"));
  });

  it("selects nothing for a comment Word no longer lists", async () => {
    const word = installWordCommentHost();

    expect(await showWordComment("123")).toBe("changed");
    expect(word.selected()).toBeNull();
  });

  it("is unavailable without Word", async () => {
    expect(await showWordComment("123")).toBe("unavailable");
  });
});
