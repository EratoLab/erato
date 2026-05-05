import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../providers/OutlookMailItemProvider", () => ({
  useOutlookMailItem: vi.fn(() => ({ mailItem: null })),
}));

import { useOutlookMailItem } from "../../providers/OutlookMailItemProvider";
import { createMockAsyncResult } from "../../test/helpers/asyncResult";
import { createMockMessageCompose } from "../../test/mocks/outlook/composeMail";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import { createMockMessageRead } from "../../test/mocks/outlook/readMail";
import { useOutlookComposeSelection } from "../useOutlookComposeSelection";

const mockUseOutlookMailItem = useOutlookMailItem as ReturnType<typeof vi.fn>;

function setComposeItem(
  selectedData: { data: string; sourceProperty: string } = {
    data: "",
    sourceProperty: "body",
  },
) {
  const mailbox = installMockMailbox();
  const composeItem = createMockMessageCompose({
    getSelectedDataAsync: vi.fn(
      (_coercionType: unknown, callback: Function) => {
        callback(createMockAsyncResult({ ...selectedData }));
      },
    ),
  });
  mailbox.item = composeItem;
  mockUseOutlookMailItem.mockReturnValue({ mailItem: { subject: "" } });
  return composeItem;
}

describe("useOutlookComposeSelection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    uninstallMockMailbox();
  });

  it("returns empty selection when not in compose mode", () => {
    installMockMailbox();
    mockUseOutlookMailItem.mockReturnValue({ mailItem: null });

    const { result } = renderHook(() => useOutlookComposeSelection());

    expect(result.current).toEqual({ data: "", sourceProperty: "body" });
  });

  it("returns selected text from compose item", () => {
    setComposeItem({ data: "Hello world", sourceProperty: "body" });

    const { result } = renderHook(() => useOutlookComposeSelection());

    expect(result.current).toEqual({
      data: "Hello world",
      sourceProperty: "body",
    });
  });

  it("skips state update when data and sourceProperty unchanged", () => {
    const composeItem = setComposeItem({
      data: "same text",
      sourceProperty: "body",
    });

    renderHook(() => useOutlookComposeSelection());

    // Initial poll already fired. Advance to trigger second poll.
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    // Called twice (initial + interval), but selection didn't change.
    expect(composeItem.getSelectedDataAsync).toHaveBeenCalledTimes(2);
  });

  it("updates when sourceProperty changes but data is same", () => {
    const composeItem = setComposeItem({
      data: "same text",
      sourceProperty: "body",
    });

    const { result } = renderHook(() => useOutlookComposeSelection());

    expect(result.current.sourceProperty).toBe("body");

    // Change sourceProperty for next poll.
    composeItem.getSelectedDataAsync.mockImplementation(
      (_coercionType: unknown, callback: Function) => {
        callback(
          createMockAsyncResult({
            data: "same text",
            sourceProperty: "subject",
          }),
        );
      },
    );

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(result.current).toEqual({
      data: "same text",
      sourceProperty: "subject",
    });
  });

  it("resets selection when mail item changes to read mode", () => {
    setComposeItem({ data: "selected text", sourceProperty: "body" });

    const { result, rerender } = renderHook(() => useOutlookComposeSelection());

    expect(result.current.data).toBe("selected text");

    // Switch to read mode.
    const mailbox = installMockMailbox();
    mailbox.item = createMockMessageRead();
    mockUseOutlookMailItem.mockReturnValue({
      mailItem: { subject: "Read Subject" },
    });

    rerender();

    expect(result.current).toEqual({ data: "", sourceProperty: "body" });
  });

  it("resets dedup refs on mail item change so new draft propagates", () => {
    setComposeItem({ data: "draft one text", sourceProperty: "body" });

    const { result, rerender } = renderHook(() => useOutlookComposeSelection());

    expect(result.current.data).toBe("draft one text");

    // Switch to a new compose item with the same selection text.
    setComposeItem({ data: "draft one text", sourceProperty: "body" });

    rerender();

    // Should still show the text — dedup refs were reset on item change,
    // so the first poll of the new draft propagated even though text matches.
    expect(result.current.data).toBe("draft one text");
  });

  it("clears interval and ignores callbacks after unmount", () => {
    const composeItem = setComposeItem({
      data: "text",
      sourceProperty: "body",
    });

    const { unmount } = renderHook(() => useOutlookComposeSelection());

    const callsBeforeUnmount =
      composeItem.getSelectedDataAsync.mock.calls.length;
    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(composeItem.getSelectedDataAsync).toHaveBeenCalledTimes(
      callsBeforeUnmount,
    );
  });

  it("preserves last selection when getSelectedDataAsync fails", () => {
    const composeItem = setComposeItem({
      data: "keep this",
      sourceProperty: "body",
    });

    const { result } = renderHook(() => useOutlookComposeSelection());

    expect(result.current.data).toBe("keep this");

    // Next poll fails.
    composeItem.getSelectedDataAsync.mockImplementation(
      (_coercionType: unknown, callback: Function) => {
        callback(
          createMockAsyncResult(null, "failed", {
            message: "InvalidSelection",
            code: "5002",
          }),
        );
      },
    );

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    // Selection unchanged — error was silently ignored.
    expect(result.current).toEqual({
      data: "keep this",
      sourceProperty: "body",
    });
  });
});
