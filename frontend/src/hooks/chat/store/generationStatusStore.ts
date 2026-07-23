import { create } from "zustand";
import { devtools } from "zustand/middleware";

import type { GeneratingChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Per-chat generation status for the sidebar indicators.
 *
 * "running" is backend-persisted truth (seeded from list rows, the
 * `/me/generating` poll, and this tab's own streams). "finished"/"error" are
 * session-derived: they exist only when this client observed a chat leave the
 * running set, so a page refresh clears them by design. "cleared" is a
 * tombstone left when an outcome is consumed (or a running entry goes
 * unknown): it renders nothing but remembers which generation it refers to,
 * so stale list rows and in-flight poll responses cannot resurrect a
 * notification the user already saw. A chat with no entry renders no
 * indicator.
 *
 * `startedAt` is always the server-side generation start time; comparing it
 * against other `startedAt` values stays within the server clock domain, so
 * client/server clock skew cannot corrupt transitions.
 */
export type ChatGenerationStatus =
  | { kind: "running"; startedAt: string; localSeenAt: number }
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
   * Mirror of the chat the user is currently viewing. Terminal outcomes for
   * that chat are suppressed: the result is visible in the conversation
   * itself, so the sidebar has nothing to notify about.
   */
  currentChatId: string | null;
  seedRunning: (chatId: string, startedAt: string) => void;
  applyPollSnapshot: (entries: GeneratingChat[]) => void;
  markTerminalLocal: (chatId: string, kind: "finished" | "error") => void;
  setCurrentChatId: (chatId: string | null) => void;
  clearStatus: (chatId: string) => void;
  reset: () => void;
}

/**
 * `localSeenAt` anchors to when this client FIRST started believing the chat
 * is running: an update of an already-running entry (e.g. the poll confirming
 * with the server's start time) keeps the original anchor, so the seed grace
 * below cannot be extended by confirmations.
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
 * Whether a seed may (over)write the existing entry. An existing running
 * entry is only replaced by a newer generation, so repeated seeds from list
 * renders keep the original `localSeenAt` and the seed grace can expire. A
 * terminal or cleared entry is only upgraded back to running by a generation
 * that started strictly after the one whose outcome it records — stale list
 * rows and in-flight poll responses still carry the finished generation's
 * start time, and both sides of the comparison are server timestamps.
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
              // Terminal outcomes only transition chats this client saw
              // running; anything else (e.g. retention rows right after a
              // refresh) stays unknown by design.
              if (existing?.kind !== "running") {
                continue;
              }
              // A snapshot can race a just-started generation and still carry
              // the PREVIOUS generation's terminal row (kept for the retention
              // window). Within the seed grace the local running seed is the
              // newer information — a genuine terminal is re-reported by the
              // next poll once the grace has passed.
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

            // A running chat absent from the snapshot is unknown, not stale:
            // stop showing an indicator nothing backs, but leave a tombstone
            // so a stale list row cannot re-seed the same generation.
            for (const [chatId, status] of Object.entries(
              prev.statusByChatId,
            )) {
              if (status?.kind !== "running") continue;
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
            // Anchor the outcome to the generation it belongs to, so the
            // comparison in `seedWins` never mixes clock domains.
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
            // Opening a chat consumes its terminal notification; a still
            // running generation keeps its indicator. A tombstone (not a
            // delete) remembers the consumed generation, so a stale cached
            // list row cannot re-seed it as running after a layout switch.
            const status = chatId ? prev.statusByChatId[chatId] : undefined;
            if (
              status &&
              status.kind !== "running" &&
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

export const selectRunningCount = (state: GenerationStatusStore): number =>
  Object.values(state.statusByChatId).filter(
    (status) => status?.kind === "running",
  ).length;

/** Finished + error; "action required" lives in the confirmation registry. */
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
