import { useEffect, useRef, useState } from "react";

import { FreshCompletionTracker } from "../../core/clientActions/freshCompletionTracker";
import { resolveEditWordCapture } from "../utils/wordDocumentCapture";

import type {
  AddinChatController,
  AddinChatHostCallbacks,
} from "../../core/AddinChatCore";
import type { WordDocumentCapture } from "../utils/wordDocumentCapture";

export interface WordDocumentCaptures {
  /** Stage separately: beforeSend receives only hostContextIdentity. */
  stagePendingCapture: (capture: WordDocumentCapture | null) => void;
  hostCallbacks: AddinChatHostCallbacks;
  capturesByAssistantMessageId: ReadonlyMap<string, WordDocumentCapture>;
}

/** The reply ID is unknown at send time; bind only an unambiguous fresh completion. */
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
      // A new chat receiving its server ID must retain its pending capture.
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
        // A send without document context must not inherit an earlier pending capture.
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
