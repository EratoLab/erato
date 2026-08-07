import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  selectPollDriverCount,
  useGenerationStatusStore,
  type ChatGenerationStatus,
} from "@/hooks/chat/store/generationStatusStore";
import { buildInfiniteChatsQueryKey } from "@/hooks/chat/useChatHistory";
import { useGeneratingChats } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  GeneratingChat,
  RecentChatsResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** Generations younger than this poll faster, so a typical turn's terminal
 * transition shows up promptly. */
const YOUNG_GENERATION_MS = 2 * 60 * 1000;
const FAST_POLL_INTERVAL_MS = 3_000;
const SLOW_POLL_INTERVAL_MS = 10_000;

const pollInterval = (): number | false => {
  const { statusByChatId } = useGenerationStatusStore.getState();
  const statuses = Object.values(statusByChatId);
  const running = statuses.filter(
    (status): status is Extract<ChatGenerationStatus, { kind: "running" }> =>
      status?.kind === "running",
  );
  if (running.length === 0) {
    // A parked approval can sit for a long time; poll slowly just to observe
    // a decision made on another device or tab.
    return statuses.some((status) => status?.kind === "action_required")
      ? SLOW_POLL_INTERVAL_MS
      : false;
  }
  const now = Date.now();
  const hasYoungRun = running.some(
    (status) => now - Date.parse(status.startedAt) < YOUNG_GENERATION_MS,
  );
  return hasYoungRun ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
};

/**
 * Patches terminal chats into the cached recent-chats list: the generated
 * title lands in the same commit as the Finished badge, and the running
 * marker is removed so a remount cannot re-seed a finished generation.
 */
const patchTerminalChats = (
  setQueryData: ReturnType<typeof useQueryClient>["setQueryData"],
  entries: GeneratingChat[],
) => {
  const terminal = new Map<string, GeneratingChat>();
  for (const entry of entries) {
    // "action_required" is a durable wait, not a terminal outcome.
    if (entry.state !== "running" && entry.state !== "action_required") {
      terminal.set(entry.chat_id, entry);
    }
  }
  if (terminal.size === 0) {
    return;
  }
  setQueryData<InfiniteData<RecentChatsResponse>>(
    buildInfiniteChatsQueryKey(),
    (current) => {
      if (!current) return current;
      const pages = current.pages.map((page) => {
        const chats = page.chats.map((chat) => {
          const entry = terminal.get(chat.id);
          if (!entry) return chat;
          const title = entry.title ?? chat.title_resolved;
          if (
            chat.title_resolved === title &&
            chat.active_generation_started_at === undefined &&
            chat.pending_tool_approval_at === undefined
          ) {
            return chat;
          }
          // Clearing the pending marker keeps a stale row from re-seeding an
          // approval that was already decided.
          return {
            ...chat,
            title_resolved: title,
            active_generation_started_at: undefined,
            pending_tool_approval_at: undefined,
          };
        });
        return chats.every((chat, index) => chat === page.chats[index])
          ? page
          : { ...page, chats };
      });
      return pages.every((page, index) => page === current.pages[index])
        ? current
        : { ...current, pages };
    },
  );
};

/**
 * Polls `GET /me/generating` while any chat is known to be running or parked
 * on a tool approval, and feeds each snapshot into the generation-status
 * store. Renders nothing; otherwise the query is fully disabled (zero idle
 * requests). Parked chats keep the poll alive so a decision made on another
 * device or tab clears the indicator here.
 */
export function GenerationStatusPoller() {
  const pollDriverCount = useGenerationStatusStore(selectPollDriverCount);
  const queryClient = useQueryClient();

  const { data, dataUpdatedAt } = useGeneratingChats(
    {},
    {
      enabled: pollDriverCount > 0,
      staleTime: 0,
      refetchOnWindowFocus: false,
      refetchInterval: pollInterval,
      // Keep polling while the tab is hidden, so a chat that finishes and
      // leaves the retention window before the user returns is still observed.
      refetchIntervalInBackground: true,
    },
  );

  // Keyed on dataUpdatedAt: structural sharing keeps `data` referentially
  // stable across identical responses, but every snapshot must be applied.
  useEffect(() => {
    if (!data) {
      return;
    }
    useGenerationStatusStore.getState().applyPollSnapshot(data.chats);
    patchTerminalChats(queryClient.setQueryData.bind(queryClient), data.chats);
  }, [data, dataUpdatedAt, queryClient]);

  return null;
}
