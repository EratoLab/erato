import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  nextChangeRound,
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

const sayPreparedNotice = vi.fn();
vi.mock("./approvalSpeech", () => ({
  sayPreparedNotice: (...args: unknown[]) => sayPreparedNotice(...args),
}));
/** "No new card came", as loaded while the card waited. */
const prepared = { close: vi.fn() };

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
    prepared,
  });
  noteChangeSent(approvalId);
};

beforeEach(() => {
  vi.useFakeTimers();
  sayPreparedNotice.mockClear();
  prepared.close.mockClear();
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
    expect(sayPreparedNotice).not.toHaveBeenCalled();
    rerender(props());
    expect(result.current.holding).toBe(true);
    act(() => vi.advanceTimersByTime(NO_CARD_GRACE_MS));
    expect(sayPreparedNotice).toHaveBeenCalledWith(prepared);
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
    expect(sayPreparedNotice).not.toHaveBeenCalled();
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
    expect(sayPreparedNotice).not.toHaveBeenCalled();
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

  it("counts the rounds, and a corrected card stops loading the unused sentence", () => {
    for (const [from, to] of [
      ["call-1", "call-2"],
      ["call-2", "call-3"],
    ]) {
      act(() => sent(from));
      takeWithdrawnCard(from, to);
    }
    expect(prepared.close).toHaveBeenCalledTimes(2);
    expect(nextChangeRound("call-3")).toBe(3);
    act(() => sent("call-3"));
    expect(useApprovalChanges.getState().records["call-3"].round).toBe(3);
    renderHook(() => useApprovalChangeOutcome(props()));
    act(() => vi.advanceTimersByTime(NO_CARD_GRACE_MS));
    expect(sayPreparedNotice).toHaveBeenCalledWith(prepared);
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
    expect(sayPreparedNotice).not.toHaveBeenCalled();
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
    expect(sayPreparedNotice).not.toHaveBeenCalled();
    expect(result.current.holding).toBe(false);
    expect(useApprovalChanges.getState().records).toEqual({});
  });
});
