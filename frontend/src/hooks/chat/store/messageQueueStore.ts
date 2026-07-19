import { create } from "zustand";
import { devtools } from "zustand/middleware";

import type { ComposeDraftState } from "@/hooks/chat/useComposeSession";

/**
 * The depth-1 "send when the current turn finishes" queue (ERMAIN-470), keyed
 * by the stable `composeSessionId` from useComposeSession so it survives the
 * new-chat null->real-id rename and stays isolated per chat. A reactive store
 * (rather than a ref map) so the composer chip and the drain re-render off it
 * directly — no manual invalidation token.
 */
interface MessageQueueStore {
  queuedBySessionId: Partial<Record<string, ComposeDraftState>>;
  setQueued: (sessionId: string, queued: ComposeDraftState) => void;
  clearQueued: (sessionId: string) => void;
  getQueued: (sessionId: string) => ComposeDraftState | null;
}

const readQueued = (
  queuedBySessionId: Partial<Record<string, ComposeDraftState>>,
  sessionId: string,
): ComposeDraftState | null => queuedBySessionId[sessionId] ?? null;

export const useMessageQueueStore = create<MessageQueueStore>()(
  devtools(
    (set, get) => ({
      queuedBySessionId: {},
      setQueued: (sessionId, queued) =>
        set(
          (prev) => ({
            queuedBySessionId: {
              ...prev.queuedBySessionId,
              [sessionId]: queued,
            },
          }),
          false,
          "messageQueue/setQueued",
        ),
      clearQueued: (sessionId) =>
        set(
          (prev) => {
            if (!prev.queuedBySessionId[sessionId]) {
              return prev;
            }
            const next = { ...prev.queuedBySessionId };
            delete next[sessionId];
            return { queuedBySessionId: next };
          },
          false,
          "messageQueue/clearQueued",
        ),
      getQueued: (sessionId) => readQueued(get().queuedBySessionId, sessionId),
    }),
    {
      name: "Message Queue Store",
      store: "message-queue-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);

/** Reactive read of the message queued for `sessionId`, or null. */
export const useQueuedMessage = (
  sessionId: string,
): ComposeDraftState | null =>
  useMessageQueueStore((state) => readQueued(state.queuedBySessionId, sessionId));
