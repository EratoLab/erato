import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  OUTLOOK_GRAPH_THREAD_TIMEOUT_MS,
  runWithGraphTimeout,
} from "../utils/graphRequestTimeout";
import { fetchCurrentThread, type ParsedThread } from "../utils/parsedThread";

import type {
  AcquireGraphToken,
  FetchConversationOptions,
} from "../utils/fetchOutlookMessageGraph";

export interface UseCurrentThreadResult {
  thread: ParsedThread | null;
  isLoading: boolean;
  /**
   * True when the conversation fetch failed outright (first page errored, so
   * nothing was retrieved). Consumers surface this rather than silently
   * showing "no thread" — distinct from a genuinely empty conversation, which
   * leaves `thread === null` with `error === false` (INV-7).
   */
  error: boolean;
}

/**
 * Fetches the Outlook conversation for the open mail item via Microsoft
 * Graph and exposes it as React state.
 *
 * Behaviour:
 *   - Returns `{ thread: null, isLoading: false }` when either `itemId` or
 *     `conversationId` is missing. `itemId === null` is the read-mode gate
 *     (drafts/compose items have no Graph-reachable id).
 *   - Sets `isLoading=true` only for the initial fetch. Background refetches
 *     must not disable the composer after the email chip has materialized.
 *     TanStack Query supplies cancellation on item/conversation changes; the
 *     Graph utilities consume that signal so stale network requests are
 *     aborted, not just ignored.
 *   - Clears the previous `thread` to `null` at the start of each new fetch
 *     so consumers see "loading" rather than stale content from a prior
 *     conversation.
 *
 * The `transport` option is forwarded to `fetchCurrentThread`; production
 * callers omit it and default to global `fetch`.
 */
export function useCurrentThread(
  itemId: string | null,
  conversationId: string | null,
  acquireGraphToken: AcquireGraphToken,
  options: FetchConversationOptions = {},
): UseCurrentThreadResult {
  // Stable transport reference avoids re-running the effect on every render
  // when the consumer passes an inline transport closure.
  const { transport } = options;
  const enabled = itemId !== null && conversationId !== null;

  const query = useQuery({
    queryKey: [
      "office-addin",
      "outlook-current-thread",
      itemId,
      conversationId,
    ],
    enabled,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => {
      if (!conversationId) return null;
      return runWithGraphTimeout(
        OUTLOOK_GRAPH_THREAD_TIMEOUT_MS,
        `Outlook conversation fetch timed out after ${OUTLOOK_GRAPH_THREAD_TIMEOUT_MS}ms`,
        signal,
        (timeoutSignal) =>
          fetchCurrentThread(conversationId, acquireGraphToken, {
            transport,
            signal: timeoutSignal,
          }),
      );
    },
  });

  useEffect(() => {
    if (query.isError) {
      console.warn(
        "[useCurrentThread] conversation fetch failed:",
        query.error,
      );
    }
  }, [query.error, query.isError]);

  if (!enabled) {
    return { thread: null, isLoading: false, error: false };
  }

  return {
    thread: query.data ?? null,
    isLoading: query.isPending,
    error: query.isError,
  };
}
