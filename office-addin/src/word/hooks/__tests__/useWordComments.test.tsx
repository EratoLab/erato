import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generatedCommentDocument,
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import {
  forgetWordCommentRefs,
  wordCommentRefRegistry,
} from "../../utils/wordCommentRefs";
import { useWordComments, WORD_COMMENTS_DEBOUNCE_MS } from "../useWordComments";

import type {
  CommentHost,
  CommentHostOptions,
} from "../../../test/mocks/word/commentHost";
import type { UseWordCommentsOptions } from "../useWordComments";

const broker = vi.hoisted(() => ({
  subscribers: new Set<{ onSelectionChanged: () => void }>(),
}));

const changes = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  paragraphEvents: true,
}));

vi.mock("../../utils/wordDocumentChangeSignal", () => ({
  subscribeWordDocumentChanged: (listener: () => void) => {
    changes.listeners.add(listener);
    return () => changes.listeners.delete(listener);
  },
  wordParagraphEventsActive: () => changes.paragraphEvents,
}));

vi.mock("../../../hooks/officeSelectionChangedBroker", () => ({
  subscribeToOfficeSelectionChanged: (subscriber: {
    onSelectionChanged: () => void;
  }) => {
    broker.subscribers.add(subscriber);
    return () => broker.subscribers.delete(subscriber);
  },
}));

const IDENTITY = "https://contoso.sharepoint.com/Shared%20Documents/c.docx";
const PASSAGE_OVER_T1: CommentHostOptions["selection"] = {
  tag: "T1P",
  offset: 22,
  to: { tag: "T1P", offset: 33 },
};

describe("useWordComments", () => {
  let word: CommentHost;

  const install = (options: CommentHostOptions = {}) => {
    word = installWordCommentHost(options);
  };
  const reads = () =>
    word.calls().filter((call) => call === "body.getComments").length;
  const options = (
    overrides: Partial<UseWordCommentsOptions> = {},
  ): UseWordCommentsOptions => ({
    documentIdentity: IDENTITY,
    enabled: true,
    detailed: false,
    picked: null,
    ...overrides,
  });
  const mount = (overrides: Partial<UseWordCommentsOptions> = {}) =>
    renderHook((props: UseWordCommentsOptions) => useWordComments(props), {
      initialProps: options(overrides),
    });
  const ready = async (hook: ReturnType<typeof mount>) => {
    await waitFor(() => expect(hook.result.current.list.status).toBe("ready"));
    return hook.result.current.list;
  };
  const refOf = (
    list: ReturnType<typeof mount>["result"]["current"]["list"],
    key: string,
  ) => {
    const thread = list.threads.find(
      (t) => t.commentId === word.commentId(key),
    );
    if (!thread) throw new Error(`no thread ${key}`);
    return thread;
  };
  const fireSelectionChanged = () => {
    for (const subscriber of broker.subscribers)
      subscriber.onSelectionChanged();
  };

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    uninstallWordCommentHost();
    forgetWordCommentRefs();
    broker.subscribers.clear();
    changes.listeners.clear();
    changes.paragraphEvents = true;
  });

  it.each(["pc", "web"] as const)(
    "names a legacy file's threads by content from the first read on %s, so a reopen keeps them (O-17)",
    async (host) => {
      install({ host, legacy: true });
      const first = await ready(mount());
      const refs = ["T1", "T2", "T8"].map((key) => refOf(first, key).ref);
      expect(wordCommentRefRegistry(IDENTITY).legacy).toBe(true);
      cleanup();
      forgetWordCommentRefs();

      install({ host, legacy: true, open: 1 });
      const reopened = await ready(mount());
      expect(refOf(reopened, "T1").commentId).not.toBe(
        first.threads[0].commentId,
      );
      expect(["T1", "T2", "T8"].map((key) => refOf(reopened, key).ref)).toEqual(
        refs,
      );
    },
  );

  it("lists the placed threads in document order, from roots and coarse anchors only", async () => {
    install({ selection: PASSAGE_OVER_T1 });
    const list = await ready(mount());

    expect(list.threads).toHaveLength(14);
    expect(list.threads.map((t) => t.pos)).toEqual(
      [...list.threads.map((t) => t.pos)].sort((a, b) => a - b),
    );
    expect(list.counts).toEqual({ open: 13, resolved: 1 });
    expect(list.unplaced).toBe(0);
    expect(refOf(list, "T2").status).toBe("resolved");
    expect(refOf(list, "T1")).toMatchObject({
      author: "Maya Krüger",
      quote: "alpha bravo",
      text: "T1 root: please check the alpha bravo wording.",
    });
    expect(refOf(list, "T5").quote).toBe("");
    expect(
      word.calls().filter((call) => call === "paragraph.getOoxml"),
    ).toHaveLength(1);
    expect(word.calls()).not.toContain("range.getOoxml");
    expect(word.calls()).not.toContain("range.getComments");
  });

  it("learns once per document whether it is legacy, with one package on desktop", async () => {
    install({ selection: PASSAGE_OVER_T1 });
    const hook = mount();
    await ready(hook);
    expect(wordCommentRefRegistry(IDENTITY).legacy).toBe(false);
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(reads()).toBe(2));
    await ready(hook);

    expect(
      word.calls().filter((call) => call === "paragraph.getOoxml"),
    ).toHaveLength(1);
  });

  it("marks the threads in the selected passage from coordinates and lists only their replies", async () => {
    install({ selection: PASSAGE_OVER_T1 });
    const list = await ready(mount());
    const t1 = refOf(list, "T1");

    expect(list.selection).toEqual({ kind: "passage", threads: [t1.ref] });
    expect(list.threads.filter((t) => t.inSelection)).toEqual([t1]);
    expect(t1.replies).toBe(2);
    expect(t1.lastActivity).toEqual(new Date("2026-09-04T07:00:00Z"));
    expect(refOf(list, "T2").replies).toBeNull();
  });

  it("names the threads touching the caret", async () => {
    install({ selection: { tag: "T6P", offset: 20 } });
    const list = await ready(mount());

    expect(list.selection).toEqual({
      kind: "caret",
      threads: [refOf(list, "T6").ref, refOf(list, "T7").ref],
    });
  });

  it("uses the session's refs, which Send resolves the same way", async () => {
    install({ selection: PASSAGE_OVER_T1 });
    const list = await ready(mount());

    const registry = wordCommentRefRegistry(IDENTITY);
    for (const thread of list.threads)
      expect(registry.refs.get(`id:${thread.commentId}`)).toBe(thread.ref);
  });

  it("lists every thread's replies while detailed, with progress", async () => {
    install({ selection: { tag: "END", offset: 0 } });
    const hook = mount();
    await ready(hook);
    hook.rerender(options({ detailed: true }));
    act(() => hook.result.current.refresh());
    await waitFor(() =>
      expect(
        hook.result.current.list.threads.every((t) => t.replies !== null),
      ).toBe(true),
    );
    const { list } = hook.result.current;

    expect(refOf(list, "T2").replies).toBe(1);
    expect(list.progress).toBeNull();
  });

  it("lists the picked thread's replies", async () => {
    install({ selection: { tag: "END", offset: 0 } });
    const hook = mount();
    const first = await ready(hook);
    const t2 = refOf(first, "T2");
    expect(t2.replies).toBeNull();

    hook.rerender(options({ picked: t2.ref }));
    act(() => hook.result.current.refresh());
    await waitFor(() =>
      expect(refOf(hook.result.current.list, "T2").replies).toBe(1),
    );
  });

  it("reads once after a burst of selection changes", async () => {
    install({ selection: PASSAGE_OVER_T1 });
    const hook = mount();
    await ready(hook);
    install({ selection: { tag: "T6P", offset: 20 } });

    act(() => {
      fireSelectionChanged();
      fireSelectionChanged();
      fireSelectionChanged();
    });
    await waitFor(() =>
      expect(hook.result.current.list.selection.kind).toBe("caret"),
    );
    expect(reads()).toBe(1);
  });

  it("reads again on pane focus", async () => {
    install({ selection: PASSAGE_OVER_T1 });
    const hook = mount();
    await ready(hook);
    install({ selection: { tag: "T6P", offset: 20 } });

    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(hook.result.current.list.selection.kind).toBe("caret"),
    );
    expect(reads()).toBe(1);
  });

  it("never polls", async () => {
    vi.useFakeTimers();
    install({ selection: PASSAGE_OVER_T1 });
    const hook = mount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(hook.result.current.list.status).toBe("ready");
    expect(reads()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(reads()).toBe(1);

    act(() => fireSelectionChanged());
    await act(() => vi.advanceTimersByTimeAsync(WORD_COMMENTS_DEBOUNCE_MS - 1));
    expect(reads()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(reads()).toBe(2);
  });

  it("asks Word nothing while disabled", async () => {
    install({ selection: PASSAGE_OVER_T1 });
    const hook = mount({ enabled: false });
    act(() => {
      fireSelectionChanged();
      globalThis.dispatchEvent(new Event("focus"));
      hook.result.current.refresh();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(hook.result.current.list.status).toBe("idle");
    expect(word.calls()).toEqual([]);
  });

  it("says a failed read failed", async () => {
    install({ failList: true });
    const hook = mount();
    await waitFor(() => expect(hook.result.current.list.status).toBe("failed"));
  });

  it("gives no time for a web comment without dateUtc", async () => {
    install({ host: "web", selection: { tag: "END", offset: 0 } });
    const list = await ready(mount());

    expect(refOf(list, "T5").lastActivity).toBeNull();
    expect(refOf(list, "T1").lastActivity).toEqual(
      new Date("2026-09-03T08:15:30Z"),
    );
  });

  describe("a caret pause", () => {
    const bodyRead = () => word.calls().includes("paragraphs.load");
    /** Mounts on a passage over T1, then moves the caret into T6 and T7's paragraph. */
    const moveCaret = async (before?: () => void) => {
      install({ host: "web", selection: PASSAGE_OVER_T1 });
      const hook = mount();
      await ready(hook);
      install({ host: "web", selection: { tag: "T6P", offset: 20 } });
      act(() => {
        before?.();
        fireSelectionChanged();
      });
      await waitFor(() =>
        expect(hook.result.current.list.selection.kind).toBe("caret"),
      );
      return hook;
    };

    it("keeps the anchors while Word lists the same comments and no paragraph changed", async () => {
      const hook = await moveCaret();
      const kept = hook.result.current.list;

      expect(bodyRead()).toBe(false);
      // Word for the web reads no comment range: the selection's own comments relate the caret.
      expect(word.rangesRead()).toEqual([]);
      expect(word.calls()).toContain("range.getComments");
      expect(kept.selection).toEqual({
        kind: "caret",
        threads: [refOf(kept, "T6").ref, refOf(kept, "T7").ref],
      });
      expect(refOf(kept, "T6").replies).not.toBeNull();

      install({ host: "web", selection: { tag: "T6P", offset: 20 } });
      act(() => hook.result.current.refresh());
      await waitFor(() => expect(bodyRead()).toBe(true));
      await ready(hook);
      expect(hook.result.current.list).toEqual(kept);
    });

    it("reads the anchors again after a paragraph changed", async () => {
      await moveCaret(() => {
        for (const listener of changes.listeners) listener();
      });
      expect(bodyRead()).toBe(true);
    });

    it("reads the anchors again where Word sends no paragraph events", async () => {
      changes.paragraphEvents = false;
      await moveCaret();
      expect(bodyRead()).toBe(true);
    });

    it("reads the anchors again once the comments changed", async () => {
      install({ host: "web", selection: PASSAGE_OVER_T1 });
      const hook = mount();
      await ready(hook);
      install({
        host: "web",
        document: generatedCommentDocument({ paragraphs: 3 }),
        selection: { tag: "G2", offset: 3 },
      });
      act(() => fireSelectionChanged());
      await waitFor(() =>
        expect(hook.result.current.list.threads).toHaveLength(3),
      );
      expect(bodyRead()).toBe(true);
    });
  });
});
