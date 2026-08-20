/**
 * Live status of a delegated background run, resolved by its chat id.
 *
 * A backgrounded dispatch freezes its tool part at launch, so the transcript
 * alone can never say how the run went. This client often knows regardless:
 * the generation-status store tracks running and parked generations, and the
 * recent-chats caches (most relevantly the origin-filtered delegated-runs
 * listing, refetched whenever the origin chat mounts) carry the durable
 * `delegated_run_outcome`. This hook overlays those sources through the same
 * resolver the delegated-runs rows use, so the trace and the runs list can
 * never disagree about one run.
 *
 * Returns `null` when nothing is known — a foreign surface with no listing
 * cached, or a row that aged out — which is the caller's cue to fall back to
 * the frozen, state-neutral copy.
 */
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import { recentChatsQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  resolveDelegatedRunStatus,
  type ChatAttentionStatus,
} from "@/utils/chatHistoryGrouping";

import { useGenerationStatusStore } from "./store/generationStatusStore";
import { isPaginated, type RecentChatsCacheEntry } from "./useChatHistory";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * A run with no listed row has only the store to speak for it; the resolver's
 * no-signal fallback ("running") assumes a listed row, so the caller guards
 * the row-less, store-less case before using this.
 */
const NO_LISTED_ROW: Pick<
  RecentChat,
  | "delegated_run_outcome"
  | "active_generation_started_at"
  | "pending_tool_approval_at"
> = {};

function findListedRun(
  queryClient: QueryClient,
  chatId: string,
): RecentChat | undefined {
  const entries = queryClient.getQueriesData<RecentChatsCacheEntry>({
    queryKey: recentChatsQuery({}).queryKey,
  });
  for (const [, entry] of entries) {
    if (!entry) continue;
    const pages = isPaginated(entry) ? entry.pages : [entry];
    for (const page of pages) {
      const row = page.chats.find((chat) => chat.id === chatId);
      if (row) return row;
    }
  }
  return undefined;
}

export function useDelegatedRunLiveStatus(
  chatId: string | undefined,
): ChatAttentionStatus | null {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      queryClient.getQueryCache().subscribe(onStoreChange),
    [queryClient],
  );
  // React Query's structural sharing keeps an unchanged row referentially
  // stable across refetches, so this snapshot only changes when the run's
  // listing data actually did.
  const row = useSyncExternalStore(subscribe, () =>
    chatId ? findListedRun(queryClient, chatId) : undefined,
  );
  const storeStatus = useGenerationStatusStore((state) =>
    chatId ? state.statusByChatId[chatId] : undefined,
  );
  if (!chatId || (!row && !storeStatus)) {
    return null;
  }
  return resolveDelegatedRunStatus(row ?? NO_LISTED_ROW, storeStatus);
}
