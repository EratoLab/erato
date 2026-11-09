import { useEffect, useRef, useState } from "react";

import {
  hasDecisionIn,
  useConfirmationRegistryStore,
} from "@/hooks/chat/store/confirmationRegistryStore";
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
  const chatId = useGenerationStatusStore((state) => state.currentChatId);
  const hasDecision = useConfirmationRegistryStore((state) =>
    hasDecisionIn(state, chatId),
  );
  const inReview = useChatsInOpenReview();
  // A chat that only waits for an app or for its tasks asks for nothing, unless
  // this browser holds an open prompt or review for it. The server sees
  // neither, so the status it reports cannot rule them out.
  const awaitingApproval = useGenerationStatusStore((state) => {
    if (chatId === null) return false;
    const status = state.statusByChatId[chatId];
    return (
      status?.kind === "action_required" &&
      (status.waitingOnly !== true || hasDecision || inReview.has(chatId))
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
