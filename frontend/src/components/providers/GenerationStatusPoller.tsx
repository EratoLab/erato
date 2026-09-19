import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import {
  selectPollDriverCount,
  useGenerationStatusStore,
  type ChatGenerationStatus,
} from "@/hooks/chat/store/generationStatusStore";
import {
  isPaginated,
  type RecentChatsCacheEntry,
} from "@/hooks/chat/useChatHistory";
import {
  chatMessagesQuery,
  recentChatsQuery,
  useGeneratingChats,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  GeneratingChat,
  RecentChatsResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** Generations younger than this poll faster, so a typical turn's terminal
 * transition shows up promptly. */
const YOUNG_GENERATION_MS = 2 * 60 * 1000;
const FAST_POLL_INTERVAL_MS = 3_000;
const SLOW_POLL_INTERVAL_MS = 10_000;
/**
 * Backstop cadence for refreshing the chat listings while a delivery is
 * outstanding. The edge is what normally fires the refresh; this only bounds
 * how long a missed edge can hide an arrived result.
 */
const DELIVERY_LISTING_REFRESH_MS = 60_000;

/**
 * Exported for unit testing: `refetchInterval` is a second gate on the same
 * query as `enabled`, and it has to know about the same drivers or teaching
 * only the selector fires exactly one request and then stops.
 */
export const pollInterval = (): number | false => {
  const { statusByChatId, awaitingDeliveryChatIds } =
    useGenerationStatusStore.getState();
  const statuses = Object.values(statusByChatId);
  const running = statuses.filter(
    (status): status is Extract<ChatGenerationStatus, { kind: "running" }> =>
      status?.kind === "running",
  );
  if (running.length === 0) {
    // A parked approval can sit for a long time, and an outstanding delivery
    // can land at any moment; poll slowly to observe either.
    const parked = statuses.some(
      (status) => status?.kind === "action_required",
    );
    const awaiting = Object.keys(awaitingDeliveryChatIds).length > 0;
    return parked || awaiting ? SLOW_POLL_INTERVAL_MS : false;
  }
  const now = Date.now();
  const hasYoungRun = running.some(
    (status) => now - Date.parse(status.startedAt) < YOUNG_GENERATION_MS,
  );
  return hasYoungRun ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
};

/**
 * Patches terminal chats into the cached recent-chats lists: the generated
 * title lands in the same commit as the Finished badge, and the running
 * marker is removed so a remount cannot re-seed a finished generation.
 * Prefix-targeted, because the list is cached under one key per filter/pinned
 * variant and a chat may sit in several of them — including the plain
 * single-page caches (e.g. an origin-filtered delegated-runs listing), whose
 * rows would otherwise keep a stale running marker.
 */
export const patchTerminalChats = (
  queryClient: ReturnType<typeof useQueryClient>,
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
  const patchPage = (page: RecentChatsResponse): RecentChatsResponse => {
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
  };
  queryClient.setQueriesData<RecentChatsCacheEntry>(
    { queryKey: recentChatsQuery({}).queryKey },
    (current) => {
      if (!current) return current;
      if (!isPaginated(current)) return patchPage(current);
      const pages = current.pages.map(patchPage);
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
 *
 * `seedOnMount` buys one request out of that idleness. The store is
 * in-memory, and the listings that seed it hide delegated runs, so a surface
 * that reloads often would otherwise come back knowing nothing about a
 * background run it launched itself — and never start polling, because the
 * poll is driven by what the store already knows. `/me/generating` is the
 * only listing that carries those runs, so surfaces with that lifecycle (the
 * add-in pane) ask it once on mount; the poll then either continues from
 * what came back, or falls straight back to idle.
 */
export function GenerationStatusPoller({
  seedOnMount = false,
}: {
  seedOnMount?: boolean;
} = {}) {
  const pollDriverCount = useGenerationStatusStore(selectPollDriverCount);
  const queryClient = useQueryClient();
  /** Chat ids that were running or parked in the PREVIOUS snapshot. */
  const liveChatIdsRef = useRef<Set<string>>(new Set());
  /** When the listing backstop last fired, as `Date.now()`. */
  const lastListingRefreshRef = useRef(0);
  /** `chatId:startedAt` of the task-result turn already reacted to. */
  const reactedRef = useRef<string | null>(null);

  const { data, dataUpdatedAt } = useGeneratingChats(
    {},
    {
      enabled: seedOnMount || pollDriverCount > 0,
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
    patchTerminalChats(queryClient, data.chats);

    // Read once per snapshot rather than subscribing: this reacts to polled
    // data arriving, not to every store change.
    const { awaitingDeliveryChatIds, currentChatId } =
      useGenerationStatusStore.getState();

    // --- BRANCH A: the in-flight -> not-in-flight edge. ------------------
    // A delegated child leaving the live set is the moment its result may
    // have been recorded, and the listing is where `delegated_runs_in_flight`
    // (and the origin's new answer) is read from. Refresh it on that edge,
    // with a slow backstop for the edges this client never observed — never
    // on every tick, which would refetch every cached listing variant every
    // three seconds for the length of the task.
    const previouslyLive = liveChatIdsRef.current;
    const live = new Set<string>();
    for (const entry of data.chats) {
      if (entry.state === "running" || entry.state === "action_required") {
        live.add(entry.chat_id);
      }
    }
    liveChatIdsRef.current = live;
    if (Object.keys(awaitingDeliveryChatIds).length > 0) {
      const aRunEnded = [...previouslyLive].some((id) => !live.has(id));
      const backstopDue =
        Date.now() - lastListingRefreshRef.current >=
        DELIVERY_LISTING_REFRESH_MS;
      if (aRunEnded || backstopDue) {
        lastListingRefreshRef.current = Date.now();
        void queryClient.invalidateQueries({
          queryKey: recentChatsQuery({}).queryKey,
        });
      }
    }

    // --- BRANCH B: a task-result turn landing in the open chat. ----------
    // The delivery reaction is server-initiated, so the client is told about
    // it only by this poll. Refetch the open conversation once per such turn
    // — keyed on the generation, so a snapshot repeated every tick for the
    // rest of the retention window does not refetch again.
    if (currentChatId) {
      const reaction = data.chats.find(
        (entry) =>
          entry.chat_id === currentChatId &&
          entry.initiator === "task_result" &&
          entry.state !== "running" &&
          entry.state !== "action_required",
      );
      if (reaction) {
        const reactionKey = `${reaction.chat_id}:${reaction.started_at}`;
        if (reactedRef.current !== reactionKey) {
          reactedRef.current = reactionKey;
          const messagesKey = chatMessagesQuery({
            pathParams: { chatId: currentChatId },
          }).queryKey;
          void queryClient.invalidateQueries({ queryKey: messagesKey });
        }
      }
    }
  }, [data, dataUpdatedAt, queryClient]);

  return null;
}
