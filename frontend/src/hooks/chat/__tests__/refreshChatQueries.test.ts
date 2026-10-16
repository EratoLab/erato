import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  chatDetailQuery,
  chatMessagesQuery,
  recentChatsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { refreshChatQueries } from "../refreshChatQueries";

describe("refreshChatQueries", () => {
  it("refreshes mounted sidebar variants and active chat detail together", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const keys = [
      [...recentChatsQuery({}).queryKey, { pinned: false }, "infinite"],
      recentChatsQuery({ queryParams: { pinned: true } }).queryKey,
      chatDetailQuery({ pathParams: { chatId: "outside-sidebar-page" } })
        .queryKey,
      chatMessagesQuery({ pathParams: { chatId: "outside-sidebar-page" } })
        .queryKey,
    ];
    const fetches = keys.map(() => vi.fn().mockResolvedValue({ fresh: true }));
    const unsubscribes = keys.map((queryKey, index) => {
      client.setQueryData(queryKey, { fresh: false });
      return new QueryObserver(client, {
        queryKey,
        queryFn: fetches[index],
        staleTime: Infinity,
      }).subscribe(() => {});
    });
    await refreshChatQueries(client);
    fetches
      .slice(0, 3)
      .forEach((fetch) => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetches[3]).not.toHaveBeenCalled();
    keys
      .slice(0, 3)
      .forEach((key) =>
        expect(client.getQueryData(key)).toEqual({ fresh: true }),
      );
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    client.clear();
  });
});
