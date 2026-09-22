import { useEffect, useRef, useState } from "react";

import { FreshCompletionTracker } from "../../core/clientActions/freshCompletionTracker";
import { resolveEditWordCapture } from "../utils/wordDocumentCapture";

import type {
  AddinChatController,
  AddinChatHostCallbacks,
} from "../../core/AddinChatCore";
import type { WordDocumentCapture } from "../utils/wordDocumentCapture";

export interface WordDocumentCaptures {
  /**
   * Written by the composer immediately before it calls `onSendMessage`. The
   * capture cannot ride `beforeSend`, whose only argument is the bare
   * `hostContextIdentity` string.
   */
  stagePendingCapture: (capture: WordDocumentCapture | null) => void;
  /** Assign to `controller.hostCallbacksRef.current` at render. */
  hostCallbacks: AddinChatHostCallbacks;
  /** ERMAIN-822's input: completed assistant message id → its send-time capture. */
  capturesByAssistantMessageId: ReadonlyMap<string, WordDocumentCapture>;
}

/**
 * Pair a staged send-time capture with its completed assistant message.
 * The message ID is unavailable at send time. Promote only when this session
 * observes exactly one completion; ambiguous completions receive no capture
 * and cannot enable writes against an unknown source.
 */
export function useWordDocumentCaptures(
  controller: AddinChatController,
): WordDocumentCaptures {
  const pendingCaptureRef = useRef<WordDocumentCapture | null>(null);
  const freshTrackerRef = useRef(new FreshCompletionTracker());
  const capturesRef = useRef(new Map<string, WordDocumentCapture>());
  const freshTrackerChatIdRef = useRef(controller.currentChatId);
  const [capturesByAssistantMessageId, setCaptures] = useState<
    ReadonlyMap<string, WordDocumentCapture>
  >(() => new Map());

  const { currentChatId, messageOrder, messages } = controller;
  useEffect(() => {
    if (freshTrackerChatIdRef.current !== currentChatId) {
      // A brand-new chat receiving its id on first send is the SAME
      // conversation continuing, not a chat switch: discarding the tracker
      // there would drop the capture for the very first exchange.
      const isNewChatGettingItsId =
        freshTrackerChatIdRef.current == null && currentChatId != null;
      freshTrackerChatIdRef.current = currentChatId;
      if (!isNewChatGettingItsId) {
        freshTrackerRef.current = new FreshCompletionTracker();
        pendingCaptureRef.current = null;
      }
    }
    const newlyFresh = freshTrackerRef.current.observe(messages, messageOrder);
    if (newlyFresh.length === 0) return;
    const capture = newlyFresh.length === 1 ? pendingCaptureRef.current : null;
    pendingCaptureRef.current = null;
    if (!capture) return;
    const completedId = newlyFresh[0];
    capturesRef.current.set(completedId, capture);
    setCaptures(new Map(capturesRef.current));
  }, [currentChatId, messageOrder, messages]);

  return {
    stagePendingCapture: (capture) => {
      pendingCaptureRef.current = capture;
    },
    hostCallbacks: {
      beforeSend: (hostContextIdentity) => {
        // The composer stages the capture just before it sends, so this only
        // has to clear it: a send that carries no document identity (chip off,
        // or an unreadable document) must never promote a stale capture from
        // an earlier turn.
        if (hostContextIdentity == null) {
          pendingCaptureRef.current = null;
        }
      },
      beforeEdit: (messageId) => {
        pendingCaptureRef.current = resolveEditWordCapture(
          controller.messages,
          controller.messageOrder,
          messageId,
          capturesRef.current,
        );
      },
      beforeRegenerate: (assistantMessageId) => {
        pendingCaptureRef.current =
          capturesRef.current.get(assistantMessageId) ?? null;
      },
    },
    capturesByAssistantMessageId,
  };
}
