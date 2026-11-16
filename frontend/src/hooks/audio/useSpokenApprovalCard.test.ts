import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSpeechPlayback } from "./speechPlayback";
import { useSpokenApprovalCard } from "./useSpokenApprovalCard";

import type { SpokenApproval } from "@/lib/toolCallGist/spokenCard";

const speakApprovalCard = vi.fn();
const stopApprovalSpeech = vi.fn();
let speakingKey: string | null = null;

vi.mock("./approvalSpeech", () => ({
  speakApprovalCard: (...args: unknown[]) => {
    speakingKey = args[0] as string;
    speakApprovalCard(...args);
  },
  stopApprovalSpeech: () => stopApprovalSpeech(),
  useApprovalSpeech: { getState: () => ({ key: speakingKey }) },
}));

const POINTER: SpokenApproval = { type: "pointer" };

const props = (
  overrides: Partial<Parameters<typeof useSpokenApprovalCard>[0]> = {},
) => ({
  chatId: "chat-1",
  messageId: `message-${Math.random()}`,
  approvals: [POINTER],
  index: 0,
  active: true,
  responding: false,
  ...overrides,
});

beforeEach(() => {
  speakApprovalCard.mockClear();
  stopApprovalSpeech.mockClear();
  speakingKey = null;
  useSpeechPlayback.setState({
    conversational: true,
    enabled: true,
    playing: false,
    spokenTurn: "chat-1",
  });
});

describe("useSpokenApprovalCard", () => {
  it("speaks a card a spoken turn stopped on, once its words have played", () => {
    useSpeechPlayback.setState({ playing: true });
    const first = props({ responding: true });
    const { rerender } = renderHook((p) => useSpokenApprovalCard(p), {
      initialProps: first,
    });
    expect(speakApprovalCard).not.toHaveBeenCalled();
    rerender({ ...first, responding: false });
    expect(speakApprovalCard).not.toHaveBeenCalled();
    act(() => useSpeechPlayback.setState({ playing: false }));
    expect(speakApprovalCard).toHaveBeenCalledTimes(1);
    expect(speakApprovalCard.mock.calls[0][2]).toEqual([
      {
        role: "pointer",
        text: "A decision is waiting on screen.",
        mustSay: false,
      },
    ]);
    // Not again on a later render or a remount.
    rerender({ ...first, responding: false });
    renderHook(() => useSpokenApprovalCard({ ...first, responding: false }));
    expect(speakApprovalCard).toHaveBeenCalledTimes(1);
  });

  it("stays silent in a typed chat, without read-back, and for an old card", () => {
    useSpeechPlayback.setState({ spokenTurn: undefined });
    renderHook(() => useSpokenApprovalCard(props()));
    useSpeechPlayback.setState({ spokenTurn: "chat-1", enabled: false });
    renderHook(() => useSpokenApprovalCard(props()));
    useSpeechPlayback.setState({ enabled: true, conversational: false });
    renderHook(() => useSpokenApprovalCard(props()));
    useSpeechPlayback.setState({ conversational: true, spokenTurn: "chat-2" });
    renderHook(() => useSpokenApprovalCard(props()));
    expect(speakApprovalCard).not.toHaveBeenCalled();
  });

  it("speaks the next approval of a queue after a decision, then stops when decided", () => {
    const queue = props({ approvals: [POINTER, POINTER, POINTER] });
    const { rerender } = renderHook((p) => useSpokenApprovalCard(p), {
      initialProps: queue,
    });
    expect(speakApprovalCard).toHaveBeenCalledTimes(1);
    expect(speakApprovalCard.mock.calls[0][0]).toBe(`${queue.messageId}:0`);
    rerender({ ...queue, index: 1 });
    expect(speakApprovalCard).toHaveBeenCalledTimes(2);
    expect(speakApprovalCard.mock.calls[1][0]).toBe(`${queue.messageId}:1`);

    rerender({ ...queue, index: 1, active: false });
    expect(stopApprovalSpeech).toHaveBeenCalled();
  });
});
