import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { useTabChatActivity } from "@/hooks/chat/useTabChatActivity";

const startedAt = new Date("2024-01-01T00:00:00.000Z").toISOString();

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

const setStreaming = (isStreaming: boolean, isFinalizing = false) => {
  useMessagingStore.setState({
    streaming: {
      isStreaming,
      isFinalizing,
      currentMessageId: null,
      content: [],
      createdAt: null,
    },
  });
};

describe("useTabChatActivity", () => {
  beforeEach(() => {
    setHidden(false);
    setStreaming(false);
    useGenerationStatusStore.setState({
      statusByChatId: {},
      currentChatId: null,
    });
  });

  it("stays idle while the tab is visible and generating", () => {
    setStreaming(true);
    setHidden(false);

    const { result } = renderHook(() => useTabChatActivity());

    expect(result.current).toBe("idle");
  });

  it("reports working once the generating tab is hidden", () => {
    setStreaming(true);
    const { result } = renderHook(() => useTabChatActivity());

    act(() => {
      setHidden(true);
    });

    expect(result.current).toBe("working");
  });

  it("keeps working through the post-stream finalizing phase", () => {
    setStreaming(true);
    const { result } = renderHook(() => useTabChatActivity());
    act(() => {
      setHidden(true);
    });

    act(() => {
      setStreaming(false, true);
    });

    expect(result.current).toBe("working");
  });

  it("latches ready when the chat finishes while hidden", () => {
    setStreaming(true);
    const { result } = renderHook(() => useTabChatActivity());
    act(() => {
      setHidden(true);
    });

    act(() => {
      setStreaming(false);
    });

    expect(result.current).toBe("ready");
  });

  it("clears ready once the tab is looked at, and does not latch again", () => {
    setStreaming(true);
    const { result } = renderHook(() => useTabChatActivity());
    act(() => {
      setHidden(true);
    });
    act(() => {
      setStreaming(false);
    });

    act(() => {
      setHidden(false);
    });
    expect(result.current).toBe("idle");

    act(() => {
      setHidden(true);
    });
    expect(result.current).toBe("idle");
  });

  it("does not latch ready for a generation that ended in view", () => {
    setStreaming(true);
    const { result } = renderHook(() => useTabChatActivity());

    act(() => {
      setStreaming(false);
    });
    act(() => {
      setHidden(true);
    });

    expect(result.current).toBe("idle");
  });

  it("outranks working with a pending tool approval on the open chat", () => {
    useGenerationStatusStore.setState({
      statusByChatId: {
        "chat-a": { kind: "action_required", startedAt, localSeenAt: 0 },
      },
      currentChatId: "chat-a",
    });
    setStreaming(true);

    const { result } = renderHook(() => useTabChatActivity());
    act(() => {
      setHidden(true);
    });

    expect(result.current).toBe("attention");
  });

  it("ignores a pending approval belonging to another chat", () => {
    useGenerationStatusStore.setState({
      statusByChatId: {
        "chat-b": { kind: "action_required", startedAt, localSeenAt: 0 },
      },
      currentChatId: "chat-a",
    });

    const { result } = renderHook(() => useTabChatActivity());
    act(() => {
      setHidden(true);
    });

    expect(result.current).toBe("idle");
  });
});
