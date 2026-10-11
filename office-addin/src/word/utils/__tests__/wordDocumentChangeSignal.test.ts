import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeToOfficeSelectionChanged } from "../../../hooks/officeSelectionChangedBroker";
import {
  markWordDocumentChanged,
  resetWordDocumentChangeSignalForTests,
  subscribeWordDocumentChanged,
} from "../wordDocumentChangeSignal";

vi.mock("../../../hooks/officeSelectionChangedBroker", () => ({
  subscribeToOfficeSelectionChanged: vi.fn(() => () => {}),
}));

type Handler = () => Promise<void>;

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

  it("registers no paragraph events below WordApi 1.6", async () => {
    installWord(false);
    subscribeWordDocumentChanged(vi.fn());
    await Promise.resolve();

    expect(vi.mocked(globalThis.Word.run)).not.toHaveBeenCalled();
  });

  it("treats a selection change as a possible change, installing once", () => {
    installWord(false);
    const listener = vi.fn();
    subscribeWordDocumentChanged(listener);
    subscribeWordDocumentChanged(vi.fn());

    expect(subscribeToOfficeSelectionChanged).toHaveBeenCalledOnce();
    vi.mocked(
      subscribeToOfficeSelectionChanged,
    ).mock.calls[0][0].onSelectionChanged();
    expect(listener).toHaveBeenCalledOnce();
  });
});
