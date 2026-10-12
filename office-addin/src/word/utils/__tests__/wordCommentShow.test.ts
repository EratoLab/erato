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

  it("never selects across paragraphs on the web: the first paragraph stands in", async () => {
    const word = installWordCommentHost({ host: "web" });

    expect(await showWordComment(word.commentId("T3"))).toBe("selected");
    const selected = word.selected();
    expect(selected?.first).toBe("T3A");
    expect(selected?.last).toBe("T3A");
    expect(word.calls()).not.toContain("range.expandTo");
  });

  it("selects a single-paragraph anchor itself on the web", async () => {
    const word = installWordCommentHost({ host: "web" });

    expect(await showWordComment(word.commentId("T1"))).toBe("selected");
    expect(word.selected()).toEqual(word.anchorOf("T1"));
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
    expect(word.selected()).toEqual(word.anchorOf("T8"));
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
