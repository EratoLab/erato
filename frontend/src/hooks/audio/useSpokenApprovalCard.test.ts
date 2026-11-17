import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { quietSpokenTurn, useSpeechPlayback } from "./speechPlayback";
import { useSpokenApprovalCard } from "./useSpokenApprovalCard";

import type { SpokenApproval } from "@/lib/toolCallGist/spokenCard";

const speakApprovalCard = vi.fn();
const offerApprovalCard = vi.fn();
const forgetApprovalCards = vi.fn();
const started = new Set<string>();

vi.mock("./approvalSpeech", () => ({
  approvalSpoken: (key: string) => started.has(key),
  speakApprovalCard: (card: { key: string }) => {
    started.add(card.key);
    speakApprovalCard(card);
  },
  offerApprovalCard: (card: { key: string }) => {
    started.add(card.key);
    offerApprovalCard(card);
  },
  forgetApprovalCards: (keys: readonly string[]) => forgetApprovalCards(keys),
}));

const POINTER: SpokenApproval = { type: "pointer" };

const props = (
  overrides: Partial<Parameters<typeof useSpokenApprovalCard>[0]> = {},
) => ({
  chatId: "chat-1",
  messageId: `message-${Math.random()}`,
  approvals: [POINTER],
  keys: ["stop-1:approval-a"],
  index: 0,
  active: true,
  responding: false,
  ...overrides,
});

const spokenKeys = () =>
  speakApprovalCard.mock.calls.map(([card]) => (card as { key: string }).key);

beforeEach(() => {
  speakApprovalCard.mockClear();
  offerApprovalCard.mockClear();
  forgetApprovalCards.mockClear();
  started.clear();
  useSpeechPlayback.setState({
    conversational: true,
    enabled: true,
    playing: false,
    spokenTurn: "chat-1",
    quietTurn: undefined,
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
    const card = speakApprovalCard.mock.calls[0][0] as {
      pieces: unknown;
      fallback: unknown;
    };
    expect(card.pieces).toEqual([
      {
        id: "pointer",
        role: "pointer",
        text: "A decision is waiting on screen.",
        mustSay: false,
        values: [],
      },
    ]);
    expect(card.fallback).toEqual(card.pieces);
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

  it("1.1: speaks the next stop of the same message, after a decision", () => {
    const messageId = "message-1";
    const first = props({ messageId, keys: ["10:00:approval-a"] });
    const { rerender } = renderHook((p) => useSpokenApprovalCard(p), {
      initialProps: first,
    });
    // The decision: the first stop goes, the turn stops again in the same
    // message on the next call.
    rerender({ ...first, active: false });
    rerender({ ...first, keys: ["10:01:approval-b"] });
    expect(spokenKeys()).toEqual([
      "message-1:10:00:approval-a",
      "message-1:10:01:approval-b",
    ]);
  });

  it("speaks the next approval of a queue after a decision, then forgets the card", () => {
    const queue = props({
      approvals: [POINTER, POINTER, POINTER],
      keys: ["t:a", "t:b", "t:c"],
    });
    const { rerender } = renderHook((p) => useSpokenApprovalCard(p), {
      initialProps: queue,
    });
    rerender({ ...queue, index: 1 });
    expect(spokenKeys()).toEqual([
      `${queue.messageId}:t:a`,
      `${queue.messageId}:t:b`,
    ]);
    rerender({ ...queue, index: 1, active: false });
    expect(forgetApprovalCards).toHaveBeenCalledWith([
      `${queue.messageId}:t:a`,
      `${queue.messageId}:t:b`,
      `${queue.messageId}:t:c`,
    ]);
  });

  it("1.9: after Stop during the turn's words the card waits to be asked for", () => {
    useSpeechPlayback.setState({ playing: true });
    act(() => quietSpokenTurn());
    expect(useSpeechPlayback.getState().playing).toBe(false);
    renderHook(() => useSpokenApprovalCard(props()));
    expect(speakApprovalCard).not.toHaveBeenCalled();
    expect(offerApprovalCard).toHaveBeenCalledTimes(1);
  });
});
