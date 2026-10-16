import {
  chatDetailQuery,
  recentChatsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { QueryClient } from "@tanstack/react-query";

/** Refresh sidebar variants and mounted chat details at the same boundary. */
export async function refreshChatQueries(queryClient: QueryClient) {
  const detailKey = chatDetailQuery({ pathParams: { chatId: "" } }).queryKey;
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: recentChatsQuery({}).queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: detailKey.slice(0, -1),
      // Message history shares the path prefix but has its own refresh cycle.
      predicate: (query) => query.queryKey.length === detailKey.length,
    }),
  ]);
}
