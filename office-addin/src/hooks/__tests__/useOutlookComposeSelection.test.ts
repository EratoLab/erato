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

    // Should still show the text. The held selection already equals the new
    // draft's, so it stays put even though no fresh update is emitted.
    expect(result.current.data).toBe("draft one text");
  });

  it("drops a stale selection when switching to a different compose surface", () => {
    // Compose A (conversation A) with a live selection.
    const mailbox = installMockMailbox();
    mailbox.item = createMockMessageCompose({
      getSelectedDataAsync: vi.fn(
        (_coercionType: unknown, callback: Function) => {
          callback(
            createMockAsyncResult({
              data: "Draft A selection",
              sourceProperty: "body",
            }),
          );
        },
      ),
    });
    mockUseOutlookMailItem.mockReturnValue({
      mailItem: { subject: "", conversationId: "conv-A", isComposeMode: true },
    });

    const { result, rerender } = renderHook(() => useOutlookComposeSelection());
    expect(result.current.data).toBe("Draft A selection");

    // Switch to compose B (different conversation) whose selection poll FAILS.
    // Without the surface-change reset, A's selection would linger and stay
    // eligible for outlook_rewrite_selection against B.
    mailbox.item = createMockMessageCompose({
      getSelectedDataAsync: vi.fn(
        (_coercionType: unknown, callback: Function) => {
          callback(
            createMockAsyncResult(null, "failed", {
              message: "InvalidSelection",
              code: "5002",
            }),
          );
        },
      ),
    });
    mockUseOutlookMailItem.mockReturnValue({
      mailItem: { subject: "", conversationId: "conv-B", isComposeMode: true },
    });

    rerender();

    // Cleared on the surface switch — not carried over from A.
    expect(result.current).toEqual({ data: "", sourceProperty: "body" });
  });

  it("keeps the selection across a re-render of the same compose surface", () => {
    // Same conversation, but the provider hands back a new mailItem object (a
    // body-load re-render). The selection must NOT be wiped.
    const mailbox = installMockMailbox();
    mailbox.item = createMockMessageCompose({
      getSelectedDataAsync: vi.fn(
        (_coercionType: unknown, callback: Function) => {
          callback(
            createMockAsyncResult({ data: "Keep me", sourceProperty: "body" }),
          );
        },
      ),
    });
    mockUseOutlookMailItem.mockReturnValue({
      mailItem: { subject: "", conversationId: "conv-A", isComposeMode: true },
    });

    const { result, rerender } = renderHook(() => useOutlookComposeSelection());
    expect(result.current.data).toBe("Keep me");

    // New mailItem object, same conversation; its poll happens to fail.
    mailbox.item = createMockMessageCompose({
      getSelectedDataAsync: vi.fn(
        (_coercionType: unknown, callback: Function) => {
          callback(
            createMockAsyncResult(null, "failed", {
              message: "InvalidSelection",
              code: "5002",
            }),
          );
        },
      ),
    });
    mockUseOutlookMailItem.mockReturnValue({
      mailItem: { subject: "", conversationId: "conv-A", isComposeMode: true },
    });

    rerender();

    // Same surface → held, not cleared.
    expect(result.current.data).toBe("Keep me");
  });

  it("holds the last selection through a transient null item (no flicker)", () => {
    setComposeItem({ data: "held text", sourceProperty: "body" });

    const { result, rerender } = renderHook(() => useOutlookComposeSelection());

    expect(result.current.data).toBe("held text");

    // The mail item momentarily vanishes — the reply / inline-compose flap that
    // used to wipe the chip. The raw item and the provider mailItem both report
    // null on the same tick.
    const mailbox = installMockMailbox();
    mailbox.item = null;
    mockUseOutlookMailItem.mockReturnValue({ mailItem: null });

    rerender();

    // Selection is HELD, not wiped — the chip stays visible.
    expect(result.current.data).toBe("held text");
  });

  it("clears the held selection once the grace period elapses with no item", () => {
    setComposeItem({ data: "held text", sourceProperty: "body" });

    const { result, rerender } = renderHook(() => useOutlookComposeSelection());

    expect(result.current.data).toBe("held text");

    const mailbox = installMockMailbox();
    mailbox.item = null;
    mockUseOutlookMailItem.mockReturnValue({ mailItem: null });

    rerender();

    // Held immediately after the item drops...
    expect(result.current.data).toBe("held text");

    // ...then cleared once the grace window elapses with the item still gone.
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(result.current).toEqual({ data: "", sourceProperty: "body" });
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

  // ERMAIN-431: the item API is serialized host-side and the Text coercion
  // was observed hanging for 15s+ on Word-styled HTML selections.

  function setNeverAnsweringComposeItem() {
    const callbacks: Array<(result: unknown) => void> = [];
    const coercions: unknown[] = [];
    const mailbox = installMockMailbox();
    const composeItem = createMockMessageCompose({
      getSelectedDataAsync: vi.fn(
        (coercionType: unknown, callback: (result: unknown) => void) => {
          coercions.push(coercionType);
          callbacks.push(callback);
        },
      ),
    });
    mailbox.item = composeItem;
    mockUseOutlookMailItem.mockReturnValue({ mailItem: { subject: "" } });
    return { composeItem, callbacks, coercions };
  }

  it("does not stack calls behind a hung one (in-flight guard)", () => {
    const { composeItem } = setNeverAnsweringComposeItem();

    renderHook(() => useOutlookComposeSelection());
    act(() => {
      vi.advanceTimersByTime(2500 * 4);
    });

    // Initial poll only — every interval tick skipped while it hangs.
    expect(composeItem.getSelectedDataAsync).toHaveBeenCalledTimes(1);
  });

  it("switches to Html coercion after the Text call hangs and extracts plain text", () => {
    const { callbacks, coercions } = setNeverAnsweringComposeItem();

    const { result } = renderHook(() => useOutlookComposeSelection());
    expect(coercions[0]).toBe(Office.CoercionType.Text);

    // Watchdog (5s) flags the surface; the stuck call then answers late —
    // it was not abandoned, so its data still lands.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    act(() => {
      callbacks[0](
        createMockAsyncResult({ data: "late text", sourceProperty: "body" }),
      );
    });
    expect(result.current.data).toBe("late text");

    // The next poll goes out with Html coercion; the result is converted to
    // plain text client-side before hitting state.
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(coercions[1]).toBe(Office.CoercionType.Html);
    act(() => {
      callbacks[1](
        createMockAsyncResult({
          data: "<p>Hallo <b>Welt</b></p>",
          sourceProperty: "body",
        }),
      );
    });
    expect(result.current.sourceProperty).toBe("body");
    expect(result.current.data).toContain("Hallo");
    expect(result.current.data).not.toContain("<");
  });

  it("abandons a call stuck past the limit and drops its late callback", () => {
    const { composeItem, callbacks } = setNeverAnsweringComposeItem();

    const { result } = renderHook(() => useOutlookComposeSelection());

    // At the abandon threshold a fresh call is let through.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(composeItem.getSelectedDataAsync).toHaveBeenCalledTimes(2);

    // The abandoned call's late answer must be ignored…
    act(() => {
      callbacks[0](
        createMockAsyncResult({ data: "stale", sourceProperty: "body" }),
      );
    });
    expect(result.current.data).toBe("");

    // …while the fresh call's answer wins.
    act(() => {
      callbacks[1](
        createMockAsyncResult({ data: "fresh", sourceProperty: "body" }),
      );
    });
    expect(result.current.data).toBe("fresh");
  });

  it("keeps the Html-coercion switch across effect re-runs on the same surface", () => {
    const { callbacks, coercions } = setNeverAnsweringComposeItem();
    const { result, rerender } = renderHook(() => useOutlookComposeSelection());

    // Text call hangs → watchdog flips the surface to Html.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // The stuck call answers late; the host slot frees up.
    act(() => {
      callbacks[0](
        createMockAsyncResult({ data: "late", sourceProperty: "body" }),
      );
    });
    expect(result.current.data).toBe("late");

    // mailItem identity churn re-runs the effect (same surface anchor); the
    // re-run's immediate poll must stay on Html — not reset to Text.
    mockUseOutlookMailItem.mockReturnValue({ mailItem: { subject: "" } });
    rerender();
    expect(coercions.at(-1)).toBe(Office.CoercionType.Html);
  });

  it("does not double-issue across effect re-runs while a call is stuck", () => {
    const { composeItem } = setNeverAnsweringComposeItem();
    const { rerender } = renderHook(() => useOutlookComposeSelection());

    mockUseOutlookMailItem.mockReturnValue({ mailItem: { subject: "" } });
    rerender();

    // The re-run's immediate poll is skipped — the stuck call still owns the
    // host's serialized API slot.
    expect(composeItem.getSelectedDataAsync).toHaveBeenCalledTimes(1);
  });

  it("resets to the fast Text coercion on a genuine surface change", () => {
    const { callbacks, coercions } = setNeverAnsweringComposeItem();
    const { rerender } = renderHook(() => useOutlookComposeSelection());

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    act(() => {
      callbacks[0](
        createMockAsyncResult({ data: "late", sourceProperty: "body" }),
      );
    });

    // A DIFFERENT compose surface starts fresh on Text.
    mockUseOutlookMailItem.mockReturnValue({
      mailItem: { subject: "", conversationId: "other-conversation" },
    });
    rerender();
    expect(coercions.at(-1)).toBe(Office.CoercionType.Text);
  });
});
