import { useEffect, useRef, useState } from "react";

import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { useChatsInOpenReview } from "@/lib/desktopSidecar/sidecarReviewLinks";

export type TabChatActivity = "idle" | "working" | "ready" | "attention";

// Framed (the Teams tab), the favicon belongs to the host page and nothing this
// hook drives is ever visible.
const isFramed = (): boolean => window.self !== window.top;

const useDocumentHidden = (): boolean => {
  const [hidden, setHidden] = useState(() => document.hidden);

  useEffect(() => {
    const sync = () => {
      setHidden(document.hidden);
    };
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return hidden;
};

/**
 * Tab-strip state for the chat this tab has open, and nothing else — a
 * session-wide signal would blink every tab whenever any chat was running.
 * Only a hidden tab carries a marker; a visible one is always "idle".
 */
export const useTabChatActivity = (): TabChatActivity => {
  const hidden = useDocumentHidden();
  const working = useMessagingStore(
    (state) => state.streaming.isStreaming || state.streaming.isFinalizing,
  );
  const inReview = useChatsInOpenReview();
  // A chat that only waits for an app or for its tasks asks for nothing,
  // unless it waits for a review open in this browser.
  const awaitingApproval = useGenerationStatusStore((state) => {
    const chatId = state.currentChatId;
    if (chatId === null) return false;
    const status = state.statusByChatId[chatId];
    return (
      status?.kind === "action_required" &&
      (status.waitingOnly !== true || inReview.has(chatId))
    );
  });

  // The store tombstones a viewed chat's completion, so "ready" for the chat the
  // user sent from exists nowhere else: latch the falling edge while hidden.
  const [ready, setReady] = useState(false);
  const wasWorking = useRef(working);

  useEffect(() => {
    if (wasWorking.current && !working && document.hidden) {
      setReady(true);
    }
    wasWorking.current = working;
  }, [working]);

  useEffect(() => {
    if (!hidden) {
      setReady(false);
    }
  }, [hidden]);

  if (!hidden || isFramed()) {
    return "idle";
  }
  if (awaitingApproval) {
    return "attention";
  }
  if (working) {
    return "working";
  }
  return ready ? "ready" : "idle";
};
