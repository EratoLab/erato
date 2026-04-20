import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MAILLISTROW_TRANSFER_TYPE } from "../../utils/outlookMailListDragParse";
import { useOutlookMailListDrag } from "../useOutlookMailListDrag";

function buildDragEvent(
  type: "dragenter" | "dragover" | "dragleave" | "drop",
  init: {
    transferTypes?: string[];
    payloadByType?: Record<string, string>;
    relatedTarget?: EventTarget | null;
  } = {},
): DragEvent {
  const { transferTypes = [], payloadByType = {}, relatedTarget = null } = init;
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  const dataTransfer = {
    types: transferTypes,
    getData: (key: string) => payloadByType[key] ?? "",
  } as unknown as DataTransfer;
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "relatedTarget", { value: relatedTarget });
  return event;
}

const validPayload = JSON.stringify({
  itemType: MAILLISTROW_TRANSFER_TYPE,
  itemIds: ["id-1"],
  subjects: ["Hello"],
  sizes: [42],
  mailboxInfos: [{ mailboxSmtpAddress: "u@x" }],
});

describe("useOutlookMailListDrag", () => {
  it("flips isDragActive when a maillistrow drag enters the window", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useOutlookMailListDrag({ onDrop }));
    expect(result.current.isDragActive).toBe(false);

    act(() => {
      window.dispatchEvent(
        buildDragEvent("dragenter", {
          transferTypes: [MAILLISTROW_TRANSFER_TYPE],
        }),
      );
    });
    expect(result.current.isDragActive).toBe(true);
  });

  it("ignores drags that do not carry a maillistrow type", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useOutlookMailListDrag({ onDrop }));

    act(() => {
      window.dispatchEvent(
        buildDragEvent("dragenter", { transferTypes: ["Files"] }),
      );
    });
    expect(result.current.isDragActive).toBe(false);
  });

  it("calls preventDefault on dragover for maillistrow to enable the subsequent drop", () => {
    const onDrop = vi.fn();
    renderHook(() => useOutlookMailListDrag({ onDrop }));

    const event = buildDragEvent("dragover", {
      transferTypes: [MAILLISTROW_TRANSFER_TYPE],
    });
    const preventDefault = vi.spyOn(event, "preventDefault");

    act(() => {
      window.dispatchEvent(event);
    });
    expect(preventDefault).toHaveBeenCalled();
  });

  it("clears isDragActive when the drag leaves the document (relatedTarget null)", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useOutlookMailListDrag({ onDrop }));

    act(() => {
      window.dispatchEvent(
        buildDragEvent("dragenter", {
          transferTypes: [MAILLISTROW_TRANSFER_TYPE],
        }),
      );
    });
    expect(result.current.isDragActive).toBe(true);

    act(() => {
      window.dispatchEvent(
        buildDragEvent("dragleave", { relatedTarget: null }),
      );
    });
    expect(result.current.isDragActive).toBe(false);
  });

  it("calls onDrop with parsed items and clears isDragActive on drop", async () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useOutlookMailListDrag({ onDrop }));

    act(() => {
      window.dispatchEvent(
        buildDragEvent("dragenter", {
          transferTypes: [MAILLISTROW_TRANSFER_TYPE],
        }),
      );
    });

    await act(async () => {
      window.dispatchEvent(
        buildDragEvent("drop", {
          transferTypes: [MAILLISTROW_TRANSFER_TYPE],
          payloadByType: { [MAILLISTROW_TRANSFER_TYPE]: validPayload },
        }),
      );
    });

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith([
      {
        itemId: "id-1",
        subject: "Hello",
        size: 42,
        mailboxSmtpAddress: "u@x",
      },
    ]);
    expect(result.current.isDragActive).toBe(false);
  });

  it("does not call onDrop when the payload fails to parse", () => {
    const onDrop = vi.fn();
    renderHook(() => useOutlookMailListDrag({ onDrop }));

    act(() => {
      window.dispatchEvent(
        buildDragEvent("drop", {
          transferTypes: [MAILLISTROW_TRANSFER_TYPE],
          payloadByType: { [MAILLISTROW_TRANSFER_TYPE]: "not-json" },
        }),
      );
    });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does not register listeners when disabled", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useOutlookMailListDrag({ onDrop, disabled: true }),
    );

    act(() => {
      window.dispatchEvent(
        buildDragEvent("dragenter", {
          transferTypes: [MAILLISTROW_TRANSFER_TYPE],
        }),
      );
      window.dispatchEvent(
        buildDragEvent("drop", {
          transferTypes: [MAILLISTROW_TRANSFER_TYPE],
          payloadByType: { [MAILLISTROW_TRANSFER_TYPE]: validPayload },
        }),
      );
    });

    expect(result.current.isDragActive).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("tears down listeners on unmount", () => {
    const onDrop = vi.fn();
    const { result, unmount } = renderHook(() =>
      useOutlookMailListDrag({ onDrop }),
    );

    unmount();
    act(() => {
      window.dispatchEvent(
        buildDragEvent("dragenter", {
          transferTypes: [MAILLISTROW_TRANSFER_TYPE],
        }),
      );
    });
    expect(result.current.isDragActive).toBe(false);
  });
});
