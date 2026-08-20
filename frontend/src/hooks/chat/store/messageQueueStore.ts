import { create } from "zustand";
import { devtools } from "zustand/middleware";

import type { ComposeDraftState } from "@/hooks/chat/useComposeSession";
import type { DelegationRunMode } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * A queued draft plus the delegation run mode chosen when it was queued.
 * The mode belongs to the queued message — the user answered wait-or-background
 * for that draft specifically — so it is snapshotted here rather than read
 * live at drain time. Absent means the wire default ("wait").
 */
export type QueuedMessageState = ComposeDraftState & {
  delegationRunMode?: DelegationRunMode;
};

/**
 * The depth-1 "send when the current turn finishes" queue (ERMAIN-470), keyed
 * by the stable `composeSessionId` from useComposeSession so it survives the
 * new-chat null->real-id rename and stays isolated per chat. A reactive store
 * (rather than a ref map) so the composer chip and the drain re-render off it
 * directly — no manual invalidation token.
 */
interface MessageQueueStore {
  queuedBySessionId: Partial<Record<string, QueuedMessageState>>;
  setQueued: (sessionId: string, queued: QueuedMessageState) => void;
  clearQueued: (sessionId: string) => void;
  getQueued: (sessionId: string) => QueuedMessageState | null;
}

const readQueued = (
  queuedBySessionId: Partial<Record<string, QueuedMessageState>>,
  sessionId: string,
): QueuedMessageState | null => queuedBySessionId[sessionId] ?? null;

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
): QueuedMessageState | null =>
  useMessageQueueStore((state) =>
    readQueued(state.queuedBySessionId, sessionId),
  );
