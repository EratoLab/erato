import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  OUTLOOK_GRAPH_THREAD_TIMEOUT_MS,
  OUTLOOK_GRAPH_THREAD_UI_BLOCK_DEADLINE_MS,
  runWithGraphTimeout,
} from "../utils/graphRequestTimeout";
import { fetchCurrentThread, type ParsedThread } from "../utils/parsedThread";

import type {
  FetchConversationMessages,
  FetchConversationOptions,
} from "../utils/fetchOutlookMessage";

export interface UseCurrentThreadResult {
  thread: ParsedThread | null;
  isLoading: boolean;
  /**
   * True when the conversation fetch failed outright (first page errored, so
   * nothing was retrieved). Consumers surface this rather than silently
   * showing "no thread" — distinct from a genuinely empty conversation, which
   * leaves `thread === null` with `error === false`.
   */
  error: boolean;
  /**
   * True while the conversation fetch is both in-flight AND within the short
   * UI-block deadline ({@link OUTLOOK_GRAPH_THREAD_UI_BLOCK_DEADLINE_MS}).
   *
   * Distinct from {@link isLoading}: `isLoading` drives loading chips for the
   * full fetch duration; `isBlockingLoad` gates the chat-input disabled state
   * and turns false after the deadline so a slow or stalled Graph request
   * does not freeze the composer for the entire 20-second fetch timeout.
   */
  isBlockingLoad: boolean;
}

/**
 * Fetches the Outlook conversation for the open mail item via the
 * environment-dispatched conversation capability (see
 * `useOutlookMessageFetcher`) and exposes it as React state.
 *
 * Behaviour:
 *   - Returns `{ thread: null, isLoading: false }` when either `itemId` or
 *     `conversationId` is missing, or when `fetchConversationMessages` is
 *     null (no mail backend available — thread synthesis quietly stays off).
 *     `itemId === null` is the read-mode gate (drafts/compose items have no
 *     backend-reachable id).
 *   - Sets `isLoading=true` only for the initial fetch. Background refetches
 *     must not disable the composer after the email chip has materialized.
 *     TanStack Query supplies cancellation on item/conversation changes; the
 *     fetch utilities consume that signal so stale network requests are
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
  fetchConversationMessages: FetchConversationMessages | null,
  options: FetchConversationOptions = {},
): UseCurrentThreadResult {
  // Stable transport reference avoids re-running the effect on every render
  // when the consumer passes an inline transport closure.
  const { transport } = options;
  const enabled =
    itemId !== null &&
    conversationId !== null &&
    fetchConversationMessages !== null;

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
      if (!conversationId || !fetchConversationMessages) return null;
      return runWithGraphTimeout(
        OUTLOOK_GRAPH_THREAD_TIMEOUT_MS,
        `Outlook conversation fetch timed out after ${OUTLOOK_GRAPH_THREAD_TIMEOUT_MS}ms`,
        signal,
        (timeoutSignal) =>
          fetchCurrentThread(conversationId, fetchConversationMessages, {
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

  // Tracks whether we're within the short UI-block window for this fetch.
  // Starts true; the effect below sets a timer to flip it false after the
  // deadline so the chat input unblocks even when the fetch is still running.
  const [isWithinBlockDeadline, setIsWithinBlockDeadline] = useState(true);

  // Reset the deadline and start the timer whenever the conversation key
  // changes (new item or new conversation). The cleanup clears any pending
  // timer so a fast success on conv-A doesn't accidentally unblock conv-B.
  useEffect(() => {
    if (!enabled) return;

    setIsWithinBlockDeadline(true);
    const timerId = globalThis.setTimeout(() => {
      setIsWithinBlockDeadline(false);
    }, OUTLOOK_GRAPH_THREAD_UI_BLOCK_DEADLINE_MS);

    return () => {
      globalThis.clearTimeout(timerId);
    };
  }, [enabled, itemId, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) {
    return { thread: null, isLoading: false, error: false, isBlockingLoad: false };
  }

  return {
    thread: query.data ?? null,
    isLoading: query.isPending,
    error: query.isError,
    isBlockingLoad: query.isPending && isWithinBlockDeadline,
  };
}
