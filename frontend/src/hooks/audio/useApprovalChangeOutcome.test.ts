import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  noteChangeSending,
  noteChangeSent,
  takeWithdrawnCard,
  useApprovalChanges,
} from "./approvalChanges";
import { useSpeechPlayback } from "./speechPlayback";
import {
  NO_CARD_GRACE_MS,
  useApprovalChangeOutcome,
} from "./useApprovalChangeOutcome";

const announceApprovalNotice = vi.fn();
vi.mock("./approvalSpeech", () => ({
  announceApprovalNotice: (...args: unknown[]) =>
    announceApprovalNotice(...args),
}));

const props = (
  overrides: Partial<Parameters<typeof useApprovalChangeOutcome>[0]> = {},
) => ({
  enabled: true,
  responding: false,
  decisionWaiting: false,
  voicePlaying: false,
  ...overrides,
});

const sent = (approvalId = "call-1") => {
  noteChangeSending({
    messageId: "message-1",
    approvalId,
    language: "de",
    approval: { type: "pointer" },
    heard: [],
    words: "nimm den 22.",
  });
  noteChangeSent(approvalId);
};

beforeEach(() => {
  vi.useFakeTimers();
  announceApprovalNotice.mockClear();
  useApprovalChanges.setState({ records: {} });
  useSpeechPlayback.setState({ conversational: true, enabled: true });
});
afterEach(() => vi.useRealTimers());

describe("what came of a change request", () => {
  it("holds the microphone while the answer comes, then says no card came", () => {
    act(() => sent());
    const { result, rerender } = renderHook(
      (p) => useApprovalChangeOutcome(p),
      { initialProps: props({ responding: true }) },
    );
    expect(result.current.holding).toBe(true);
    // The model's words are read first.
    rerender(props({ voicePlaying: true }));
    act(() => vi.advanceTimersByTime(NO_CARD_GRACE_MS * 2));
    expect(announceApprovalNotice).not.toHaveBeenCalled();
    rerender(props());
    expect(result.current.holding).toBe(true);
    act(() => vi.advanceTimersByTime(NO_CARD_GRACE_MS));
    expect(announceApprovalNotice).toHaveBeenCalledWith(
      "message-1",
      { kind: "change_no_card", several: false },
      "de",
    );
    expect(result.current.holding).toBe(false);
  });

  it("says nothing when a card came", () => {
    act(() => sent());
    const { result, rerender } = renderHook(
      (p) => useApprovalChangeOutcome(p),
      { initialProps: props({ responding: true }) },
    );
    rerender(props({ decisionWaiting: true }));
    act(() => vi.advanceTimersByTime(NO_CARD_GRACE_MS * 2));
    expect(announceApprovalNotice).not.toHaveBeenCalled();
    expect(result.current.holding).toBe(false);
    // The corrected card can still be compared with the withdrawn one.
    expect(takeWithdrawnCard("call-1", "call-2")).toBeDefined();
  });

  it("a card still waiting before the answer began is the withdrawn one", () => {
    act(() => sent());
    const { result, rerender } = renderHook(
      (p) => useApprovalChangeOutcome(p),
      { initialProps: props({ decisionWaiting: true }) },
    );
    expect(result.current.holding).toBe(true);
    rerender(props({ responding: true }));
    rerender(props({ decisionWaiting: true }));
    expect(result.current.holding).toBe(false);
    expect(announceApprovalNotice).not.toHaveBeenCalled();
  });

  it("says nothing when the corrected card took the withdrawn one", () => {
    act(() => sent());
    const { result } = renderHook(() =>
      useApprovalChangeOutcome(props({ responding: true })),
    );
    act(() => {
      takeWithdrawnCard("call-1", "call-2");
    });
    expect(result.current.holding).toBe(false);
  });

  it("after several rounds, says so", () => {
    for (const [from, to] of [
      ["call-1", "call-2"],
      ["call-2", "call-3"],
    ]) {
      act(() => sent(from));
      takeWithdrawnCard(from, to);
    }
    act(() => sent("call-3"));
    expect(useApprovalChanges.getState().records["call-3"].round).toBe(3);
    renderHook(() => useApprovalChangeOutcome(props()));
    act(() => vi.advanceTimersByTime(NO_CARD_GRACE_MS));
    expect(announceApprovalNotice).toHaveBeenCalledWith(
      "message-1",
      { kind: "change_no_card", several: true },
      "de",
    );
  });

  it("a request still on its way says nothing yet", () => {
    act(() =>
      noteChangeSending({
        messageId: "message-1",
        approvalId: "call-1",
        approval: { type: "pointer" },
        heard: [],
        words: "x",
      }),
    );
    const { result } = renderHook(() => useApprovalChangeOutcome(props()));
    act(() => vi.advanceTimersByTime(NO_CARD_GRACE_MS * 2));
    expect(announceApprovalNotice).not.toHaveBeenCalled();
    expect(result.current.holding).toBe(true);
  });

  it("leaving audio mode while the answer is on its way forgets the change", () => {
    act(() => sent());
    const { result, rerender } = renderHook(
      (p) => useApprovalChangeOutcome(p),
      { initialProps: props({ responding: true }) },
    );
    act(() => useSpeechPlayback.setState({ conversational: false }));
    rerender(props({ enabled: false }));
    act(() => vi.advanceTimersByTime(NO_CARD_GRACE_MS * 2));
    expect(announceApprovalNotice).not.toHaveBeenCalled();
    expect(result.current.holding).toBe(false);
    expect(useApprovalChanges.getState().records).toEqual({});
  });
});
