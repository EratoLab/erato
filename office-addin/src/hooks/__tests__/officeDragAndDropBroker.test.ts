import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import {
  __resetOfficeDragAndDropBrokerForTests,
  subscribeToOfficeDragAndDrop,
} from "../officeDragAndDropBroker";

type MailboxMock = ReturnType<typeof installMockMailbox>;

let requirementsSupported = true;
let capturedHandler: ((event: Office.DragAndDropEventArgs) => void) | null =
  null;
let deferredRegistration: (() => void) | null = null;

function setupOffice(options: { deferRegistration?: boolean } = {}): MailboxMock {
  const mailbox = installMockMailbox();
  (Office.EventType as unknown as Record<string, string>).DragAndDropEvent =
    "olkDragAndDropEvent";
  (Office.context as unknown as Record<string, unknown>).requirements = {
    isSetSupported: () => requirementsSupported,
  };

  (mailbox.addHandlerAsync as unknown as ReturnType<typeof vi.fn>) = vi.fn(
    (
      _eventType: unknown,
      handler: (event: Office.DragAndDropEventArgs) => void,
      callback?: (result: unknown) => void,
    ) => {
      capturedHandler = handler;
      const resolve = () =>
        callback?.({ status: Office.AsyncResultStatus.Succeeded });
      if (options.deferRegistration) {
        deferredRegistration = resolve;
      } else {
        resolve();
      }
    },
  );
  (mailbox.removeHandlerAsync as unknown as ReturnType<typeof vi.fn>) = vi.fn(
    (_eventType: unknown, callback?: (result: unknown) => void) => {
      capturedHandler = null;
      callback?.({ status: Office.AsyncResultStatus.Succeeded });
    },
  );
  return mailbox;
}

function fireDragover(): void {
  if (!capturedHandler) throw new Error("no handler registered");
  capturedHandler({
    type: "olkDragAndDropEvent",
    dragAndDropEventData: {
      type: "dragover",
      pageX: 0,
      pageY: 0,
      taskPaneX: 0,
      taskPaneY: 0,
    },
  });
}

function fireDrop(
  files: { name: string; type: string; fileContent: Blob }[],
): void {
  if (!capturedHandler) throw new Error("no handler registered");
  capturedHandler({
    type: "olkDragAndDropEvent",
    dragAndDropEventData: {
      type: "drop",
      pageX: 0,
      pageY: 0,
      taskPaneX: 0,
      taskPaneY: 0,
      dataTransfer: { files },
    },
  });
}

describe("officeDragAndDropBroker", () => {
  beforeEach(() => {
    requirementsSupported = true;
    capturedHandler = null;
    deferredRegistration = null;
    __resetOfficeDragAndDropBrokerForTests();
  });

  afterEach(() => {
    uninstallMockMailbox();
    delete (Office.EventType as unknown as Record<string, string>)
      .DragAndDropEvent;
    delete (Office.context as unknown as Record<string, unknown>).requirements;
  });

  it("installs the Office.js handler on the first subscribe", () => {
    const mailbox = setupOffice();
    const onDrop = vi.fn();

    subscribeToOfficeDragAndDrop({ onDragover: vi.fn(), onDrop });

    expect(mailbox.addHandlerAsync).toHaveBeenCalledTimes(1);
  });

  it("does not re-install when a second subscriber joins", () => {
    const mailbox = setupOffice();

    subscribeToOfficeDragAndDrop({ onDragover: vi.fn(), onDrop: vi.fn() });
    subscribeToOfficeDragAndDrop({ onDragover: vi.fn(), onDrop: vi.fn() });

    expect(mailbox.addHandlerAsync).toHaveBeenCalledTimes(1);
  });

  it("tears down only when the last subscriber leaves", () => {
    const mailbox = setupOffice();

    const unsubA = subscribeToOfficeDragAndDrop({
      onDragover: vi.fn(),
      onDrop: vi.fn(),
    });
    const unsubB = subscribeToOfficeDragAndDrop({
      onDragover: vi.fn(),
      onDrop: vi.fn(),
    });

    unsubA();
    expect(mailbox.removeHandlerAsync).not.toHaveBeenCalled();

    unsubB();
    expect(mailbox.removeHandlerAsync).toHaveBeenCalledTimes(1);
  });

  it("fans a single drop event out to every active subscriber exactly once", async () => {
    setupOffice();
    const dropA = vi.fn();
    const dropB = vi.fn();

    subscribeToOfficeDragAndDrop({ onDragover: vi.fn(), onDrop: dropA });
    subscribeToOfficeDragAndDrop({ onDragover: vi.fn(), onDrop: dropB });

    const blob = new Blob(["body"], { type: "message/rfc822" });
    fireDrop([{ name: "m.eml", type: "message/rfc822", fileContent: blob }]);

    expect(dropA).toHaveBeenCalledTimes(1);
    expect(dropB).toHaveBeenCalledTimes(1);
    const aFiles = dropA.mock.calls[0][0] as File[];
    expect(aFiles[0].name).toBe("m.eml");
    expect(await aFiles[0].text()).toBe("body");
  });

  it("skips notifying an unsubscribed listener", () => {
    setupOffice();
    const dropA = vi.fn();
    const dropB = vi.fn();

    const unsubA = subscribeToOfficeDragAndDrop({
      onDragover: vi.fn(),
      onDrop: dropA,
    });
    subscribeToOfficeDragAndDrop({ onDragover: vi.fn(), onDrop: dropB });
    unsubA();

    fireDrop([
      { name: "x.eml", type: "message/rfc822", fileContent: new Blob(["x"]) },
    ]);

    expect(dropA).not.toHaveBeenCalled();
    expect(dropB).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing subscriber so sibling subscribers still fire", () => {
    setupOffice();
    const dropA = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    const dropB = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    subscribeToOfficeDragAndDrop({ onDragover: vi.fn(), onDrop: dropA });
    subscribeToOfficeDragAndDrop({ onDragover: vi.fn(), onDrop: dropB });

    fireDrop([
      { name: "x.eml", type: "message/rfc822", fileContent: new Blob(["x"]) },
    ]);

    expect(dropA).toHaveBeenCalledTimes(1);
    expect(dropB).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it("fans dragover events out to every subscriber", () => {
    setupOffice();
    const dragA = vi.fn();
    const dragB = vi.fn();

    subscribeToOfficeDragAndDrop({ onDragover: dragA, onDrop: vi.fn() });
    subscribeToOfficeDragAndDrop({ onDragover: dragB, onDrop: vi.fn() });

    fireDragover();

    expect(dragA).toHaveBeenCalledTimes(1);
    expect(dragB).toHaveBeenCalledTimes(1);
  });

  it("does not install when Mailbox 1.5 requirement set is unsupported", () => {
    requirementsSupported = false;
    const mailbox = setupOffice();

    subscribeToOfficeDragAndDrop({ onDragover: vi.fn(), onDrop: vi.fn() });

    expect(mailbox.addHandlerAsync).not.toHaveBeenCalled();
  });

  it("handles StrictMode-style subscribe/unsubscribe/subscribe with one Office.js install", () => {
    const mailbox = setupOffice();

    // First mount
    const unsubA = subscribeToOfficeDragAndDrop({
      onDragover: vi.fn(),
      onDrop: vi.fn(),
    });
    expect(mailbox.addHandlerAsync).toHaveBeenCalledTimes(1);
    // Cleanup
    unsubA();
    // Second mount
    subscribeToOfficeDragAndDrop({ onDragover: vi.fn(), onDrop: vi.fn() });

    // Idle path: unsubA tore down, second subscribe re-installs. So two
    // addHandlerAsync calls but one installed handler at any time.
    expect(mailbox.addHandlerAsync).toHaveBeenCalledTimes(2);
    expect(mailbox.removeHandlerAsync).toHaveBeenCalledTimes(1);
  });

  it("does not leak a handler when subscribe is torn down before addHandlerAsync completes", () => {
    const mailbox = setupOffice({ deferRegistration: true });

    const unsub = subscribeToOfficeDragAndDrop({
      onDragover: vi.fn(),
      onDrop: vi.fn(),
    });
    // Unsubscribe while registration is still pending.
    unsub();

    // Now resolve the deferred addHandlerAsync callback.
    deferredRegistration?.();

    // Broker should detect subscribers.size === 0 and tear down immediately.
    expect(mailbox.removeHandlerAsync).toHaveBeenCalledTimes(1);
  });
});
