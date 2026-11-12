import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { useTabChatActivity } from "@/hooks/chat/useTabChatActivity";
import {
  markReviewEnded,
  markTaskReviewEnded,
  rememberReview,
  reviewLinkKey,
  useSidecarReviewLinks,
} from "@/lib/desktopSidecar/sidecarReviewLinks";

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

  describe("an open chat that only waits", () => {
    beforeEach(() => {
      localStorage.clear();
      useSidecarReviewLinks.setState({ links: {} });
      useConfirmationRegistryStore.setState({
        pendingIdsByChatId: {},
        waitingOnlyIds: {},
      });
      useGenerationStatusStore.setState({
        statusByChatId: {
          "chat-a": {
            kind: "action_required",
            startedAt,
            localSeenAt: 0,
            waitingOnly: true,
          },
        },
        currentChatId: "chat-a",
      });
    });

    it("carries no marker", () => {
      const { result } = renderHook(() => useTabChatActivity());
      act(() => {
        setHidden(true);
      });

      expect(result.current).toBe("idle");
    });

    it("asks for attention while it waits for a review in this browser", () => {
      rememberReview(reviewLinkKey("message-1", "call-1"), "handle-1", [
        "chat-a",
      ]);
      const { result } = renderHook(() => useTabChatActivity());
      act(() => {
        setHidden(true);
      });

      expect(result.current).toBe("attention");
    });

    it("keeps asking for attention once that review has ended", () => {
      const key = reviewLinkKey("message-1", "call-1");
      rememberReview(key, "handle-1", ["chat-a"]);
      markReviewEnded(key);
      const { result } = renderHook(() => useTabChatActivity());
      act(() => {
        setHidden(true);
      });

      expect(result.current).toBe("attention");
    });

    it("asks for attention while one of its tasks waits for a review, and stops once that task's review ran out", () => {
      const key = reviewLinkKey("task-message", "task-call");
      rememberReview(key, "handle-1", ["task-chat", "chat-a"]);
      const { result } = renderHook(() => useTabChatActivity());
      act(() => {
        setHidden(true);
      });
      expect(result.current).toBe("attention");

      // The task's call ended with its review: nothing is asked any more.
      act(() => {
        markTaskReviewEnded(key);
      });
      expect(result.current).toBe("idle");
    });

    it("carries no marker for a card that only waits", () => {
      useConfirmationRegistryStore
        .getState()
        .registerConfirmation("chat-a", "card-1", { waitingOnly: true });
      const { result } = renderHook(() => useTabChatActivity());
      act(() => {
        setHidden(true);
      });

      expect(result.current).toBe("idle");
    });

    it("keeps asking through the poll while a prompt is open", () => {
      const statusStore = useGenerationStatusStore.getState();
      const confirmations = useConfirmationRegistryStore.getState();
      statusStore.seedActionRequired("chat-a", new Date().toISOString());
      confirmations.registerConfirmation("chat-a", "prompt-1");
      const { result } = renderHook(() => useTabChatActivity());
      act(() => {
        setHidden(true);
      });
      expect(result.current).toBe("attention");

      // The server cannot see the prompt, so it reports the park as a wait.
      act(() => {
        statusStore.applyPollSnapshot([
          {
            chat_id: "chat-a",
            state: "action_required",
            started_at: startedAt,
            waiting_only: true,
          },
        ]);
      });
      expect(
        useGenerationStatusStore.getState().statusByChatId["chat-a"],
      ).toMatchObject({ kind: "action_required", waitingOnly: true });
      expect(result.current).toBe("attention");

      act(() => {
        confirmations.unregisterConfirmation("chat-a", "prompt-1");
      });
      expect(result.current).toBe("idle");
    });
  });

  it("stays idle inside an iframe, where the favicon is the host page's", () => {
    const top = window.top;
    Object.defineProperty(window, "top", { configurable: true, value: {} });
    setStreaming(true);

    const { result } = renderHook(() => useTabChatActivity());
    act(() => {
      setHidden(true);
    });

    expect(result.current).toBe("idle");
    Object.defineProperty(window, "top", { configurable: true, value: top });
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
