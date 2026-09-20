/**
 * Finding one listed chat across every cached recent-chats query.
 *
 * A delegated run is listed under whichever recent-chats keys happen to be
 * cached — the sidebar's unfiltered listing, an origin-filtered delegated-runs
 * listing, or both — and a caller asking about one run cannot know which. So
 * the lookup walks them all and takes the first match.
 *
 * Lifted out of `useDelegatedRunLiveStatus`, which walked exactly this shape
 * to answer "which row is this run?", because the retry affordance walks it to
 * answer a different question — "which row replaced this run?" — off the same
 * caches. One traversal, two predicates: a second copy would be a second thing
 * to keep in step with the cache's paginated/flat duality.
 *
 * Deliberately not under `src/components/`: the shared-kit registry re-exports
 * every module reachable from its roots that lives there, so a component-tree
 * home would grow the add-in's contract for an internal helper.
 */
import { recentChatsQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { isPaginated, type RecentChatsCacheEntry } from "./useChatHistory";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { QueryClient } from "@tanstack/react-query";

/**
 * The first listed chat matching `predicate`, across every cached
 * recent-chats query, or `undefined` when no cached listing holds one.
 *
 * `undefined` means "not in any cache this client holds" — never "does not
 * exist". A caller that needs server truth invalidates the listing and reads
 * again; this only ever answers from what has already arrived.
 */
export function findListedChat(
  queryClient: QueryClient,
  predicate: (chat: RecentChat) => boolean,
): RecentChat | undefined {
  const entries = queryClient.getQueriesData<RecentChatsCacheEntry>({
    queryKey: recentChatsQuery({}).queryKey,
  });
  for (const [, entry] of entries) {
    if (!entry) continue;
    const pages = isPaginated(entry) ? entry.pages : [entry];
    for (const page of pages) {
      const row = page.chats.find(predicate);
      if (row) return row;
    }
  }
  return undefined;
}
