import { afterEach, describe, expect, it } from "vitest";

import { wordCommentGestureStore as store } from "../wordCommentGestureStore";

afterEach(() => store.resetForTests());

describe("one-message gestures a Send spent", () => {
  it("come back when the send never reached the server", () => {
    store.set({ withoutComments: true, override: "comment" });
    const spent = store.sent();
    expect(store.getSnapshot()).toMatchObject({
      withoutComments: false,
      override: null,
    });

    store.unspend(spent);
    expect(store.getSnapshot()).toMatchObject({
      withoutComments: true,
      override: "comment",
    });
    store.unspend(spent);
    expect(store.sent()).toEqual({
      withoutComments: true,
      override: "comment",
    });
  });

  it("stay spent once the user said something newer", () => {
    store.set({ withoutComments: true });
    const spent = store.sent();
    store.set({ override: "passage" });

    store.unspend(spent);
    expect(store.getSnapshot()).toMatchObject({
      withoutComments: false,
      override: "passage",
    });
  });

  it("stay spent after another Send, chat or document", () => {
    store.set({ withoutComments: true });
    const first = store.sent();
    store.sent();
    store.unspend(first);
    expect(store.getSnapshot().withoutComments).toBe(false);

    store.set({ withoutComments: true });
    const spent = store.sent();
    store.leave("chat");
    store.unspend(spent);
    expect(store.getSnapshot().withoutComments).toBe(false);
  });

  it("leave the pick and Include open comments as they are", () => {
    store.set({ includeOpenComments: true });
    store.pick({ kind: "pick", ref: "t1k", selectionKey: null });
    const spent = store.sent();
    expect(store.getSnapshot().pick).toEqual({
      ref: "t1k",
      selectionKey: null,
    });
    store.pick({ kind: "dismiss" });

    store.unspend(spent);
    expect(store.getSnapshot()).toMatchObject({
      pick: null,
      includeOpenComments: true,
    });
  });
});

describe("leaving the chat or the document", () => {
  it.each(["chat", "document"] as const)(
    "drops the pick on another %s",
    (scope) => {
      store.set({ includeOpenComments: true });
      store.pick({ kind: "pick", ref: "t1k", selectionKey: null });

      store.leave(scope);
      expect(store.getSnapshot()).toMatchObject({
        pick: null,
        includeOpenComments: scope === "document",
      });
    },
  );
});

describe("open comments the chip's (x) turned off", () => {
  it("stays with includeOpenComments: through a Send and a document switch, not a chat switch", () => {
    store.set({ includeOpenComments: true });
    store.set({ includeOpenComments: false, openCommentsDismissed: true });
    expect(store.getSnapshot()).toMatchObject({
      includeOpenComments: false,
      openCommentsDismissed: true,
    });

    const spent = store.sent();
    expect(store.getSnapshot().openCommentsDismissed).toBe(true);
    store.unspend(spent);
    expect(store.getSnapshot().openCommentsDismissed).toBe(true);

    store.leave("document");
    expect(store.getSnapshot().openCommentsDismissed).toBe(true);
    store.leave("chat");
    expect(store.getSnapshot().openCommentsDismissed).toBe(false);
  });

  it("clears when + includes them again", () => {
    store.set({ includeOpenComments: false, openCommentsDismissed: true });
    store.set({ includeOpenComments: true, openCommentsDismissed: false });
    expect(store.getSnapshot()).toMatchObject({
      includeOpenComments: true,
      openCommentsDismissed: false,
    });
  });
});
