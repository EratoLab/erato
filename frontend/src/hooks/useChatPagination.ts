import * as reactQuery from "@tanstack/react-query";
import { useState, useEffect } from "react";

import { fetchChatMessages } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { ChatMessagesResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const MESSAGE_PAGE_SIZE = 20; // Number of messages to fetch per page

/**
 * Hook to manage message pagination
 */
export function useChatPagination(
  sessionId: string | null,
  setLoading: (isLoading: boolean) => void,
) {
  const [lastLoadedCount, setLastLoadedCount] = useState(0);
  const [apiMessagesResponse, setApiMessagesResponse] = useState<
    ChatMessagesResponse | undefined
  >();

  // Enhanced infinite query for messages using React Query's useInfiniteQuery
  const {
    data: paginatedMessages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingInfiniteMessages,
    refetch: refetchMessages,
  } = reactQuery.useInfiniteQuery({
    queryKey: ["chatMessages", sessionId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!sessionId || sessionId.startsWith("temp-")) {
        // Return empty response for temporary sessions
        return {
          messages: [],
          stats: {
            has_more: false,
            total_count: 0,
            returned_count: 0,
            current_offset: 0,
          },
        } as ChatMessagesResponse;
      }

      // Use the generated API functions
      return fetchChatMessages({
        pathParams: {
          chatId: sessionId,
        },
        queryParams: {
          limit: MESSAGE_PAGE_SIZE,
          offset: pageParam,
        },
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      // If has_more is true, return the next offset for pagination
      if (lastPage.stats.has_more) {
        return lastPage.stats.current_offset + lastPage.stats.returned_count;
      }
      // Return undefined to signal we've reached the end
      return undefined;
    },
    enabled: !!sessionId && !sessionId.startsWith("temp-"),
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

  // Update loading state based on React Query's loading states
  useEffect(() => {
    setLoading(isLoadingInfiniteMessages || isFetchingNextPage);
  }, [isLoadingInfiniteMessages, isFetchingNextPage, setLoading]);

  // Function to load older messages - using React Query's fetchNextPage
  const loadOlderMessages = () => {
    const isPending = isLoadingInfiniteMessages || isFetchingNextPage;

    if (!hasNextPage || isPending) {
      console.log(
        hasNextPage ? "Already loading messages" : "No more messages to load",
      );
      return;
    }

    console.log("Loading older messages with fetchNextPage");

    // Set loading state first for better UI feedback
    setLoading(true);

    // Use fetchNextPage from useInfiniteQuery to load the next page of messages
    void fetchNextPage();
  };

  // Calculate if we have older messages inline
  const hasOlderMessages = apiMessagesResponse?.stats.has_more ?? false;

  return {
    paginatedMessages,
    loadOlderMessages,
    hasOlderMessages,
    lastLoadedCount,
    setLastLoadedCount,
    apiMessagesResponse,
    setApiMessagesResponse,
    refetchMessages,
  };
}
