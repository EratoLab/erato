import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetOfficeSelectionChangedBrokerForTests,
  subscribeToOfficeSelectionChanged,
} from "../officeSelectionChangedBroker";

type AsyncCallback = (result: Office.AsyncResult<void>) => void;

interface DocumentMock {
  addHandlerAsync: ReturnType<typeof vi.fn>;
  removeHandlerAsync: ReturnType<typeof vi.fn>;
  fire: () => void;
  completeRegistration: (succeeded?: boolean) => void;
}

function installDocument(
  options: { deferRegistration?: boolean; throwOnAdd?: boolean } = {},
): DocumentMock {
  let handler: (() => void) | null = null;
  let pending: AsyncCallback | null = null;
  const complete = (callback: AsyncCallback, succeeded: boolean) =>
    callback({
      status: succeeded
        ? Office.AsyncResultStatus.Succeeded
        : Office.AsyncResultStatus.Failed,
      error: succeeded ? undefined : { message: "Not supported" },
    } as Office.AsyncResult<void>);
  const mock: DocumentMock = {
    addHandlerAsync: vi.fn(
      (_type: string, next: () => void, callback: AsyncCallback) => {
        if (options.throwOnAdd) throw new Error("Not implemented");
        handler = next;
        if (options.deferRegistration) pending = callback;
        else complete(callback, true);
      },
    ),
    removeHandlerAsync: vi.fn(
      (
        _type: string,
        removal: { handler?: () => void },
        callback?: AsyncCallback,
      ) => {
        if (removal.handler === handler) handler = null;
        callback?.({
          status: Office.AsyncResultStatus.Succeeded,
        } as Office.AsyncResult<void>);
      },
    ),
    fire: () => {
      if (!handler) throw new Error("no handler registered");
      handler();
    },
    completeRegistration: (succeeded = true) => {
      if (!pending) throw new Error("no registration pending");
      complete(pending, succeeded);
      pending = null;
    },
  };
  (Office.context as unknown as Record<string, unknown>).document = mock;
  return mock;
}

/** Lets the broker observe callOfficeAsync settling. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("officeSelectionChangedBroker", () => {
  beforeEach(() => {
    __resetOfficeSelectionChangedBrokerForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (Office.context as unknown as Record<string, unknown>).document;
  });

  it("registers one handler for every subscriber and fans each event out", async () => {
    const host = installDocument();
    const a = vi.fn();
    const b = vi.fn();
    subscribeToOfficeSelectionChanged({ onSelectionChanged: a });
    subscribeToOfficeSelectionChanged({ onSelectionChanged: b });
    await settle();

    host.fire();

    expect(host.addHandlerAsync).toHaveBeenCalledTimes(1);
    expect(host.addHandlerAsync.mock.calls[0][0]).toBe(
      Office.EventType.DocumentSelectionChanged,
    );
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("keeps a single registration through a StrictMode double mount", async () => {
    const host = installDocument();
    const first = vi.fn();
    const second = vi.fn();

    const unmount = subscribeToOfficeSelectionChanged({
      onSelectionChanged: first,
    });
    unmount();
    subscribeToOfficeSelectionChanged({ onSelectionChanged: second });
    await settle();
    host.fire();

    expect(host.addHandlerAsync).toHaveBeenCalledTimes(1);
    expect(host.removeHandlerAsync).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes its own handler only when the last subscriber leaves", async () => {
    const host = installDocument();
    const unsubA = subscribeToOfficeSelectionChanged({
      onSelectionChanged: vi.fn(),
    });
    const unsubB = subscribeToOfficeSelectionChanged({
      onSelectionChanged: vi.fn(),
    });
    await settle();

    unsubA();
    unsubA();
    expect(host.removeHandlerAsync).not.toHaveBeenCalled();
    unsubB();
    expect(host.removeHandlerAsync).toHaveBeenCalledTimes(1);
    expect(host.removeHandlerAsync.mock.calls[0][1]).toEqual({
      handler: host.addHandlerAsync.mock.calls[0][1],
    });

    subscribeToOfficeSelectionChanged({ onSelectionChanged: vi.fn() });
    await settle();
    expect(host.addHandlerAsync).toHaveBeenCalledTimes(2);
  });

  it("tears down a registration that completes after every subscriber left", async () => {
    const host = installDocument({ deferRegistration: true });
    const unsubscribe = subscribeToOfficeSelectionChanged({
      onSelectionChanged: vi.fn(),
    });
    unsubscribe();

    host.completeRegistration();
    await settle();

    expect(host.removeHandlerAsync).toHaveBeenCalledTimes(1);
  });

  it("does not register twice while a registration is pending", async () => {
    const host = installDocument({ deferRegistration: true });
    const onSelectionChanged = vi.fn();
    subscribeToOfficeSelectionChanged({ onSelectionChanged: vi.fn() })();
    subscribeToOfficeSelectionChanged({ onSelectionChanged });

    host.completeRegistration();
    await settle();
    host.fire();

    expect(host.addHandlerAsync).toHaveBeenCalledTimes(1);
    expect(host.removeHandlerAsync).not.toHaveBeenCalled();
    expect(onSelectionChanged).toHaveBeenCalledTimes(1);
  });

  it("reports a failed registration to subscribers without throwing", async () => {
    const host = installDocument({ deferRegistration: true });
    const onUnavailable = vi.fn();
    expect(() =>
      subscribeToOfficeSelectionChanged({
        onSelectionChanged: vi.fn(),
        onUnavailable,
      }),
    ).not.toThrow();

    host.completeRegistration(false);
    await settle();
    expect(onUnavailable).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    subscribeToOfficeSelectionChanged({
      onSelectionChanged: vi.fn(),
      onUnavailable: late,
    });
    expect(late).toHaveBeenCalledTimes(1);
    expect(host.addHandlerAsync).toHaveBeenCalledTimes(1);
  });

  it("survives a host that throws on registration or offers no document events", async () => {
    installDocument({ throwOnAdd: true });
    const onUnavailable = vi.fn();
    expect(() =>
      subscribeToOfficeSelectionChanged({
        onSelectionChanged: vi.fn(),
        onUnavailable,
      }),
    ).not.toThrow();
    await settle();
    expect(onUnavailable).toHaveBeenCalledTimes(1);

    __resetOfficeSelectionChangedBrokerForTests();
    delete (Office.context as unknown as Record<string, unknown>).document;
    const noEvents = vi.fn();
    subscribeToOfficeSelectionChanged({
      onSelectionChanged: vi.fn(),
      onUnavailable: noEvents,
    });
    expect(noEvents).toHaveBeenCalledTimes(1);
  });

  it("gives up on a registration the host never answers", async () => {
    vi.useFakeTimers();
    try {
      const host = installDocument({ deferRegistration: true });
      const onUnavailable = vi.fn();
      subscribeToOfficeSelectionChanged({
        onSelectionChanged: vi.fn(),
        onUnavailable,
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(onUnavailable).toHaveBeenCalledTimes(1);
      expect(host.addHandlerAsync).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes a handler the host registers after the timeout and passes none of its events on", async () => {
    vi.useFakeTimers();
    try {
      const host = installDocument({ deferRegistration: true });
      const onSelectionChanged = vi.fn();
      const onUnavailable = vi.fn();
      const unsubscribe = subscribeToOfficeSelectionChanged({
        onSelectionChanged,
        onUnavailable,
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(onUnavailable).toHaveBeenCalledTimes(1);

      const handler = host.addHandlerAsync.mock.calls[0][1] as () => void;
      host.completeRegistration();
      await vi.advanceTimersByTimeAsync(0);
      expect(host.removeHandlerAsync).toHaveBeenCalledTimes(1);
      expect(host.removeHandlerAsync.mock.calls[0][1]).toEqual({ handler });
      handler();
      expect(onSelectionChanged).not.toHaveBeenCalled();

      const late = vi.fn();
      subscribeToOfficeSelectionChanged({
        onSelectionChanged: late,
        onUnavailable: vi.fn(),
      });
      handler();
      expect(late).not.toHaveBeenCalled();
      unsubscribe();
      expect(host.addHandlerAsync).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("isolates a throwing subscriber and logs no error text", async () => {
    const host = installDocument();
    const after = vi.fn();
    subscribeToOfficeSelectionChanged({
      onSelectionChanged: () => {
        throw new Error("SENTINEL selected words");
      },
    });
    subscribeToOfficeSelectionChanged({ onSelectionChanged: after });
    await settle();

    expect(() => host.fire()).not.toThrow();

    expect(after).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "SENTINEL",
    );
  });
});
