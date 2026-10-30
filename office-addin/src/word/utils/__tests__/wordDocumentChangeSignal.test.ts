import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetWordChangeJournalForTests,
  wordChangePosition,
  wordChangesSince,
} from "../wordChangeJournal";
import {
  markWordDocumentChanged,
  readWordChangeTrackingMode,
  resetWordDocumentChangeSignalForTests,
  wordParagraphEventsActive,
  wordParagraphEventsPending,
  subscribeWordDocumentChanged,
} from "../wordDocumentChangeSignal";

type Handler = (event?: {
  type: string;
  source: string;
  uniqueLocalIds: string[];
}) => Promise<void>;

function installWord(supportsEvents: boolean) {
  const handlers: Record<string, Handler[]> = {
    added: [],
    changed: [],
    deleted: [],
  };
  const event = (name: string) => ({
    add: (handler: Handler) => handlers[name].push(handler),
  });
  vi.stubGlobal("Word", {
    run: vi.fn(async (callback: (context: unknown) => Promise<void>) =>
      callback({
        document: {
          onParagraphAdded: event("added"),
          onParagraphChanged: event("changed"),
          onParagraphDeleted: event("deleted"),
          load: () => {},
          changeTrackingMode: "TrackAll",
        },
        sync: async () => {},
      }),
    ),
  });
  vi.stubGlobal("Office", {
    context: {
      requirements: {
        isSetSupported: (name: string, version: string) =>
          supportsEvents && name === "WordApi" && version === "1.6",
      },
    },
  });
  return handlers;
}

describe("wordDocumentChangeSignal", () => {
  beforeEach(() => {
    resetWordDocumentChangeSignalForTests();
    resetWordChangeJournalForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("tells every subscriber about a change until it unsubscribes", () => {
    installWord(false);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = subscribeWordDocumentChanged(first);
    subscribeWordDocumentChanged(second);

    markWordDocumentChanged();
    unsubscribe();
    markWordDocumentChanged();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("keeps notifying when one subscriber throws", () => {
    installWord(false);
    const after = vi.fn();
    subscribeWordDocumentChanged(() => {
      throw new Error("boom");
    });
    subscribeWordDocumentChanged(after);

    markWordDocumentChanged();

    expect(after).toHaveBeenCalledOnce();
  });

  it("counts paragraph edits, including co-authors', when Word offers the events", async () => {
    const handlers = installWord(true);
    const listener = vi.fn();
    subscribeWordDocumentChanged(listener);
    await vi.waitFor(() => expect(handlers.deleted).toHaveLength(1));

    await handlers.added[0]();
    await handlers.changed[0]();
    await handlers.deleted[0]();

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("passes each event's type, source and paragraph ids to the change journal", async () => {
    const handlers = installWord(true);
    const listener = vi.fn();
    subscribeWordDocumentChanged(listener);
    await vi.waitFor(() => expect(wordParagraphEventsActive()).toBe(true));
    const start = wordChangePosition();

    await handlers.changed[0]({
      type: "ParagraphChanged",
      source: "Remote",
      uniqueLocalIds: ["p1"],
    });
    await handlers.deleted[0]({
      type: "ParagraphDeleted",
      source: "Local",
      uniqueLocalIds: ["p2"],
    });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(wordChangesSince(start)).toMatchObject({
      ok: true,
      entries: [
        { kind: "changed", source: "remote", ids: ["p1"] },
        { kind: "deleted", source: "local", ids: ["p2"] },
      ],
    });
  });

  it("registers no paragraph events below WordApi 1.6", async () => {
    installWord(false);
    subscribeWordDocumentChanged(vi.fn());
    await Promise.resolve();

    expect(vi.mocked(globalThis.Word.run)).not.toHaveBeenCalled();
  });

  it("reports paragraph events as active once Word accepted them, and pending until then", async () => {
    installWord(true);
    expect(wordParagraphEventsActive()).toBe(false);
    expect(wordParagraphEventsPending()).toBeUndefined();

    subscribeWordDocumentChanged(vi.fn());
    const pending = wordParagraphEventsPending();
    expect(pending).toBeInstanceOf(Promise);
    await pending;

    expect(wordParagraphEventsActive()).toBe(true);
    expect(wordChangePosition().events).toBe(true);
    await vi.waitFor(() =>
      expect(wordParagraphEventsPending()).toBeUndefined(),
    );
  });

  it("reports paragraph events as inactive when Word refuses them", async () => {
    installWord(true);
    vi.mocked(globalThis.Word.run).mockRejectedValueOnce(new Error("refused"));

    subscribeWordDocumentChanged(vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(wordParagraphEventsActive()).toBe(false);
  });

  it("reads the Track Changes mode without a document read", async () => {
    installWord(false);

    await expect(readWordChangeTrackingMode()).resolves.toBe("TrackAll");
  });

  it("gives up on a Track Changes read Word never answers", async () => {
    vi.useFakeTimers();
    try {
      installWord(false);
      vi.mocked(globalThis.Word.run).mockReturnValueOnce(new Promise(() => {}));

      const mode = readWordChangeTrackingMode();
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(mode).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
