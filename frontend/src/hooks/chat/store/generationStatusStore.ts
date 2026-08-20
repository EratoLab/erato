import { create } from "zustand";
import { devtools } from "zustand/middleware";

import type {
  GeneratingChat,
  RecentChat,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Per-chat generation status for the sidebar indicators.
 *
 * "finished"/"error" exist only when this client observed a chat leave the
 * running set, so a page refresh clears them by design. "cleared" is a
 * tombstone left when an outcome is consumed (or a running entry goes
 * unknown): it renders nothing but remembers which generation it refers to,
 * so stale list rows and in-flight poll responses cannot resurrect it.
 *
 * `startedAt` carries the server-side start time when seeded from list rows
 * or the poll, and the client clock when seeded by this tab's own sends —
 * which is why local sends use `seedRunningLocal` instead of the compared
 * seed path.
 */
export type ChatGenerationStatus =
  | { kind: "running"; startedAt: string; localSeenAt: number }
  /**
   * Generation stopped on a tool approval awaiting the user. Server-durable
   * (the chat's generation state parks as awaiting_approval), so unlike the
   * terminal kinds it may be seeded fresh after a refresh and never ages out
   * on its own.
   */
  | { kind: "action_required"; startedAt: string; localSeenAt: number }
  | { kind: "finished"; startedAt: string | null }
  | { kind: "error"; startedAt: string | null }
  | { kind: "cleared"; startedAt: string | null };

/**
 * A freshly seeded running entry is not cleared by a poll snapshot that does
 * not contain it yet: the backend row lease is written on generation start,
 * but a poll response already in flight predates it.
 */
const SEED_GRACE_MS = 10_000;

interface GenerationStatusStore {
  statusByChatId: Partial<Record<string, ChatGenerationStatus>>;
  /**
   * Chat the user is currently viewing; terminal outcomes for it are
   * suppressed since the result is visible in the conversation itself.
   */
  currentChatId: string | null;
  seedRunning: (chatId: string, startedAt: string) => void;
  seedRunningLocal: (chatId: string, startedAt: string) => void;
  /** Seed from a durable pending-approval marker (list row, poll, or the
   * mounted approval card itself). */
  seedActionRequired: (chatId: string, pendingAt: string) => void;
  /** The user decided; tombstone the entry so stale rows and in-flight polls
   * carrying the same marker cannot resurrect it. */
  markApprovalDecided: (chatId: string) => void;
  applyPollSnapshot: (entries: GeneratingChat[]) => void;
  markTerminalLocal: (chatId: string, kind: "finished" | "error") => void;
  setCurrentChatId: (chatId: string | null) => void;
  clearStatus: (chatId: string) => void;
  reset: () => void;
}

/**
 * `localSeenAt` anchors to when this client FIRST started believing the chat
 * is running, so later confirmations cannot extend the seed grace.
 */
const runningEntry = (
  startedAt: string,
  existing: ChatGenerationStatus | undefined,
  now: number,
): ChatGenerationStatus => ({
  kind: "running",
  startedAt,
  localSeenAt: existing?.kind === "running" ? existing.localSeenAt : now,
});

/**
 * Whether a seed may (over)write the existing entry: only a strictly newer
 * generation wins, so stale list rows and in-flight poll responses that still
 * carry a finished generation's start time cannot resurrect it.
 */
const seedWins = (
  existing: ChatGenerationStatus | undefined,
  startedAt: string,
): boolean => {
  if (!existing) {
    return true;
  }
  if (existing.startedAt === null) {
    return true;
  }
  return Date.parse(startedAt) > Date.parse(existing.startedAt);
};

export const useGenerationStatusStore = create<GenerationStatusStore>()(
  devtools(
    (set) => ({
      statusByChatId: {},
      currentChatId: null,

      seedRunning: (chatId, startedAt) =>
        set(
          (prev) => {
            const existing = prev.statusByChatId[chatId];
            if (!seedWins(existing, startedAt)) {
              return prev;
            }
            return {
              statusByChatId: {
                ...prev.statusByChatId,
                [chatId]: runningEntry(startedAt, existing, Date.now()),
              },
            };
          },
          false,
          "generationStatus/seedRunning",
        ),

      // A local send is definitive evidence of a new generation, so it
      // bypasses the timestamp comparison (its client-clock `startedAt` may
      // lose against a server timestamp under skew) and gets a fresh grace.
      seedRunningLocal: (chatId, startedAt) =>
        set(
          (prev) => ({
            statusByChatId: {
              ...prev.statusByChatId,
              [chatId]: { kind: "running", startedAt, localSeenAt: Date.now() },
            },
          }),
          false,
          "generationStatus/seedRunningLocal",
        ),

      seedActionRequired: (chatId, pendingAt) =>
        set(
          (prev) => {
            const existing = prev.statusByChatId[chatId];
            // The marker is stamped when the generation parks, so it is newer
            // than that generation's start (wins) but not newer than a
            // decided tombstone carrying the same timestamp (loses).
            if (!seedWins(existing, pendingAt)) {
              return prev;
            }
            return {
              statusByChatId: {
                ...prev.statusByChatId,
                [chatId]: {
                  kind: "action_required",
                  startedAt: pendingAt,
                  localSeenAt:
                    existing?.kind === "action_required"
                      ? existing.localSeenAt
                      : Date.now(),
                },
              },
            };
          },
          false,
          "generationStatus/seedActionRequired",
        ),

      markApprovalDecided: (chatId) =>
        set(
          (prev) => {
            const existing = prev.statusByChatId[chatId];
            // The decision resolves only after the continuation's stream
            // closed, and the server persists the terminal outcome before
            // closing it — so besides the parked entry, a "running" entry a
            // poll observed for the continuation is also stale by now and
            // must not be left for grace-gated cleanup.
            if (
              existing?.kind !== "action_required" &&
              existing?.kind !== "running"
            ) {
              return prev;
            }
            return {
              statusByChatId: {
                ...prev.statusByChatId,
                [chatId]: { kind: "cleared", startedAt: existing.startedAt },
              },
            };
          },
          false,
          "generationStatus/markApprovalDecided",
        ),

      applyPollSnapshot: (entries) =>
        set(
          (prev) => {
            const now = Date.now();
            const next = { ...prev.statusByChatId };
            let changed = false;

            const snapshotChatIds = new Set<string>();
            for (const entry of entries) {
              snapshotChatIds.add(entry.chat_id);
              const existing = next[entry.chat_id];
              if (entry.state === "running") {
                if (seedWins(existing, entry.started_at)) {
                  next[entry.chat_id] = runningEntry(
                    entry.started_at,
                    existing,
                    now,
                  );
                  changed = true;
                }
                continue;
              }
              // Server-durable, so applied regardless of what this client saw
              // — this is the running → parked flip for a chat the user is
              // not looking at.
              if (entry.state === "action_required") {
                if (seedWins(existing, entry.started_at)) {
                  next[entry.chat_id] = {
                    kind: "action_required",
                    startedAt: entry.started_at,
                    localSeenAt:
                      existing?.kind === "action_required"
                        ? existing.localSeenAt
                        : now,
                  };
                  changed = true;
                }
                continue;
              }
              // Terminal outcomes only transition chats this client saw
              // running; retention rows right after a refresh stay unknown.
              if (existing?.kind !== "running") {
                continue;
              }
              // Within the seed grace the snapshot may still carry the
              // previous generation's retention row; a genuine terminal is
              // re-reported by the next poll.
              if (now - existing.localSeenAt < SEED_GRACE_MS) {
                continue;
              }
              if (entry.chat_id === prev.currentChatId) {
                next[entry.chat_id] = {
                  kind: "cleared",
                  startedAt: entry.started_at,
                };
              } else {
                next[entry.chat_id] =
                  entry.state === "completed"
                    ? { kind: "finished", startedAt: entry.started_at }
                    : { kind: "error", startedAt: entry.started_at };
              }
              changed = true;
            }

            // A running or parked chat absent from the snapshot loses its
            // indicator (for parked: the approval was decided elsewhere), but
            // a tombstone keeps stale list rows from re-seeding it.
            for (const [chatId, status] of Object.entries(
              prev.statusByChatId,
            )) {
              if (
                status?.kind !== "running" &&
                status?.kind !== "action_required"
              ) {
                continue;
              }
              if (snapshotChatIds.has(chatId)) continue;
              if (now - status.localSeenAt < SEED_GRACE_MS) continue;
              next[chatId] = { kind: "cleared", startedAt: status.startedAt };
              changed = true;
            }

            return changed ? { statusByChatId: next } : prev;
          },
          false,
          "generationStatus/applyPollSnapshot",
        ),

      markTerminalLocal: (chatId, kind) =>
        set(
          (prev) => {
            const existing = prev.statusByChatId[chatId];
            const startedAt = existing?.startedAt ?? null;
            if (chatId === prev.currentChatId) {
              if (!existing) {
                return prev;
              }
              return {
                statusByChatId: {
                  ...prev.statusByChatId,
                  [chatId]: { kind: "cleared", startedAt },
                },
              };
            }
            return {
              statusByChatId: {
                ...prev.statusByChatId,
                [chatId]: { kind, startedAt },
              },
            };
          },
          false,
          "generationStatus/markTerminalLocal",
        ),

      setCurrentChatId: (chatId) =>
        set(
          (prev) => {
            // Opening a chat consumes its terminal notification into a
            // tombstone; a still-running generation keeps its indicator, and
            // a pending approval stays until the user actually decides.
            const status = chatId ? prev.statusByChatId[chatId] : undefined;
            if (
              status &&
              status.kind !== "running" &&
              status.kind !== "action_required" &&
              status.kind !== "cleared"
            ) {
              return {
                currentChatId: chatId,
                statusByChatId: {
                  ...prev.statusByChatId,
                  [chatId as string]: {
                    kind: "cleared",
                    startedAt: status.startedAt,
                  },
                },
              };
            }
            if (prev.currentChatId === chatId) {
              return prev;
            }
            return { currentChatId: chatId };
          },
          false,
          "generationStatus/setCurrentChatId",
        ),

      clearStatus: (chatId) =>
        set(
          (prev) => {
            if (!prev.statusByChatId[chatId]) {
              return prev;
            }
            const next = { ...prev.statusByChatId };
            delete next[chatId];
            return { statusByChatId: next };
          },
          false,
          "generationStatus/clearStatus",
        ),

      reset: () =>
        set(
          { statusByChatId: {}, currentChatId: null },
          false,
          "generationStatus/reset",
        ),
    }),
    {
      name: "Generation Status Store",
      store: "generation-status-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);

/**
 * Seed the store from a chat listing's running and pending-approval markers.
 * The generating poll is gated on the store, so a surface that lists chats
 * has to push what the rows already say — otherwise the poll never starts
 * and the indicators never observe a transition. The compared seed path
 * keeps stale rows from resurrecting anything newer.
 */
export function seedGenerationStatusFromListing(
  chats: readonly Pick<
    RecentChat,
    "id" | "active_generation_started_at" | "pending_tool_approval_at"
  >[],
): void {
  const { seedRunning, seedActionRequired } =
    useGenerationStatusStore.getState();
  for (const chat of chats) {
    if (chat.active_generation_started_at) {
      seedRunning(chat.id, chat.active_generation_started_at);
    }
    if (chat.pending_tool_approval_at) {
      seedActionRequired(chat.id, chat.pending_tool_approval_at);
    }
  }
}

export const selectRunningCount = (state: GenerationStatusStore): number =>
  Object.values(state.statusByChatId).filter(
    (status) => status?.kind === "running",
  ).length;

/**
 * Chats that should keep the status poll alive: running ones (to observe
 * their outcome) and parked ones (to observe an approval decided on another
 * device or tab).
 */
export const selectPollDriverCount = (state: GenerationStatusStore): number =>
  Object.values(state.statusByChatId).filter(
    (status) =>
      status?.kind === "running" || status?.kind === "action_required",
  ).length;

/**
 * Finished + error. Store-tracked "action_required" is counted by the rail
 * badge itself, deduplicated against the confirmation registry.
 */
export const selectAttentionCount = (state: GenerationStatusStore): number =>
  Object.values(state.statusByChatId).filter(
    (status) => status?.kind === "finished" || status?.kind === "error",
  ).length;

export const useGenerationRunningCount = (): number =>
  useGenerationStatusStore(selectRunningCount);

export const useGenerationAttentionCount = (): number =>
  useGenerationStatusStore(selectAttentionCount);

export const useGenerationStatusFor = (
  chatId: string,
): Exclude<ChatGenerationStatus, { kind: "cleared" }> | undefined =>
  useGenerationStatusStore((state) => {
    const status = state.statusByChatId[chatId];
    return status?.kind === "cleared" ? undefined : status;
  });
