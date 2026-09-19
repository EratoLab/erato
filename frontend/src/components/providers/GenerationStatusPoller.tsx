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
    // The gate is the store's view of `delegated_runs_in_flight`, which goes
    // false once the delivery reaches `delivered` — i.e. for exactly the case
    // below. It survives because the store is only re-seeded by the NEXT
    // listing fetch, the one this branch is about to ask for; read here, it
    // still carries the `claimed` state the delivery ran under.
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
        // 779-B: the same edge is when a delivered `task_result` row may have
        // appeared in the OPEN chat. `deliver_task_result` holds the origin's
        // own lease for the whole delivery, so the origin is what leaves the
        // live set here — and it wrote the row before releasing. A delivery
        // whose reaction failed leaves no further signal at all, so the react
        // predicate has to be re-evaluated against these rows or the missing
        // answer stays invisible until the chat is remounted.
        //
        // This is the FAST path only, and it can fire a beat early: the gate
        // above is `delegated_runs_in_flight`, which goes false in the same
        // transaction that appends the row, so on the last delivery this edge
        // can be observed before the row exists and the gate is then disarmed
        // for good. The delivery-settled effect below is the guarantee; this
        // one still earns its keep while OTHER runs are in flight, where the
        // gate never falls and that effect never fires.
        //
        // BRANCH B is the wrong seam for either: it matches a task-result turn
        // that has already RUN, by which point the reaction's assistant row is
        // the tip and the predicate is false.
        if (currentChatId) {
          void queryClient.invalidateQueries({
            queryKey: chatMessagesQuery({
              pathParams: { chatId: currentChatId },
            }).queryKey,
          });
        }
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

  /**
   * The open chat's delivery flag falling is the one signal that says the row
   * is on disk NOW.
   *
   * `delegated_runs_in_flight` is true while a child runs and while its
   * delivery is `pending`/`claimed`; `deliver_task_result` appends the task
   * result row and writes `delivered` in the same transaction, so the flag
   * goes false exactly when — and never before — the row the react predicate
   * needs exists. Everything the poll snapshot can see is earlier than that:
   * the reaction runs after the commit, under a lease that can open and close
   * between two ticks, and once the flag is false the poll driver it fed is
   * gone and BRANCH A above cannot fire again.
   *
   * Driven by the store rather than by a snapshot, because the fetch that
   * observes the fall is usually somebody else's — the sidebar listing, or the
   * refetch BRANCH A just asked for — and by then this poll may already be
   * disabled.
   */
  const awaitingDeliveryChatIds = useGenerationStatusStore(
    (state) => state.awaitingDeliveryChatIds,
  );
  const previousAwaitingRef = useRef(awaitingDeliveryChatIds);

  useEffect(() => {
    const previous = previousAwaitingRef.current;
    previousAwaitingRef.current = awaitingDeliveryChatIds;
    // Read, not subscribed: this reacts to the flag falling for the chat the
    // user is looking at, not to the user opening a different chat.
    const { currentChatId } = useGenerationStatusStore.getState();
    if (
      !currentChatId ||
      previous[currentChatId] !== true ||
      awaitingDeliveryChatIds[currentChatId] === true
    ) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: chatMessagesQuery({ pathParams: { chatId: currentChatId } })
        .queryKey,
    });
  }, [awaitingDeliveryChatIds, queryClient]);

  return null;
}
