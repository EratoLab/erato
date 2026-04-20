import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import { __resetOfficeDragAndDropBrokerForTests } from "../officeDragAndDropBroker";
import { useOfficeDragAndDrop } from "../useOfficeDragAndDrop";

type MailboxMock = ReturnType<typeof installMockMailbox>;

let requirementsSupported = true;
let capturedHandler: ((event: Office.DragAndDropEventArgs) => void) | null =
  null;

function setupOffice(): MailboxMock {
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
      callback?.({ status: Office.AsyncResultStatus.Succeeded });
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

describe("useOfficeDragAndDrop", () => {
  beforeEach(() => {
    requirementsSupported = true;
    capturedHandler = null;
    __resetOfficeDragAndDropBrokerForTests();
    setupOffice();
  });

  afterEach(() => {
    uninstallMockMailbox();
    delete (Office.EventType as unknown as Record<string, string>)
      .DragAndDropEvent;
    delete (Office.context as unknown as Record<string, unknown>).requirements;
  });

  it("flips isDragActive true on dragover and false on drop", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useOfficeDragAndDrop({ onDrop }));

    expect(result.current.isDragActive).toBe(false);

    act(() => fireDragover());
    expect(result.current.isDragActive).toBe(true);

    act(() =>
      fireDrop([
        {
          name: "item.eml",
          type: "message/rfc822",
          fileContent: new Blob(["x"]),
        },
      ]),
    );
    expect(result.current.isDragActive).toBe(false);
  });

  it("delivers dropped items to onDrop as File objects with name and type preserved", async () => {
    const onDrop = vi.fn();
    renderHook(() => useOfficeDragAndDrop({ onDrop }));

    const emlBlob = new Blob(["rfc822 content"], { type: "message/rfc822" });
    const pdfBlob = new Blob(["pdf bytes"], { type: "application/pdf" });

    await act(async () => {
      fireDrop([
        {
          name: "Hey how are you.eml",
          type: "message/rfc822",
          fileContent: emlBlob,
        },
        { name: "doc.pdf", type: "application/pdf", fileContent: pdfBlob },
      ]);
    });

    expect(onDrop).toHaveBeenCalledTimes(1);
    const files = onDrop.mock.calls[0][0] as File[];
    expect(files).toHaveLength(2);
    expect(files[0].name).toBe("Hey how are you.eml");
    expect(files[0].type).toBe("message/rfc822");
    expect(await files[0].text()).toBe("rfc822 content");
    expect(files[1].name).toBe("doc.pdf");
    expect(files[1].type).toBe("application/pdf");
  });

  it("does not fire onDrop when the drop event has no files", () => {
    const onDrop = vi.fn();
    renderHook(() => useOfficeDragAndDrop({ onDrop }));

    act(() => fireDrop([]));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does not subscribe when disabled", () => {
    const mailbox = Office.context.mailbox as unknown as MailboxMock;
    const onDrop = vi.fn();

    renderHook(() => useOfficeDragAndDrop({ onDrop, disabled: true }));

    expect(mailbox.addHandlerAsync).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const mailbox = Office.context.mailbox as unknown as MailboxMock;
    const onDrop = vi.fn();

    const { unmount } = renderHook(() => useOfficeDragAndDrop({ onDrop }));
    unmount();

    expect(mailbox.removeHandlerAsync).toHaveBeenCalledTimes(1);
  });

  it("fires onDrop exactly once per drop when two instances of the hook are mounted", async () => {
    const onDropA = vi.fn();
    const onDropB = vi.fn();
    renderHook(() => useOfficeDragAndDrop({ onDrop: onDropA }));
    renderHook(() => useOfficeDragAndDrop({ onDrop: onDropB }));

    await act(async () => {
      fireDrop([
        {
          name: "m.eml",
          type: "message/rfc822",
          fileContent: new Blob(["body"]),
        },
      ]);
    });

    // Each hook invokes its own onDrop once — no duplication.
    expect(onDropA).toHaveBeenCalledTimes(1);
    expect(onDropB).toHaveBeenCalledTimes(1);
  });

  it("stays inert (no registration, no drop) when Mailbox 1.5 is unsupported", () => {
    requirementsSupported = false;
    const mailbox = Office.context.mailbox as unknown as MailboxMock;
    const onDrop = vi.fn();

    renderHook(() => useOfficeDragAndDrop({ onDrop }));

    expect(mailbox.addHandlerAsync).not.toHaveBeenCalled();
  });
});
