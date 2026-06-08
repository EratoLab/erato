import { useEffect, useState } from "react";

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
 * Graph and exposes it as React state. Used to be inlined inside
 * `OutlookEmailSourceProvider` — pulled into its own hook so it can be
 * unit-tested with `renderHook` against an injected transport instead of
 * a global `fetch` stub.
 *
 * Behaviour:
 *   - Returns `{ thread: null, isLoading: false }` when either `itemId` or
 *     `conversationId` is missing. `itemId === null` is the read-mode gate
 *     (drafts/compose items have no Graph-reachable id).
 *   - Sets `isLoading=true` while a fetch is in flight; cancellation flag
 *     prevents state updates after `itemId`/`conversationId` change or
 *     after the consumer unmounts.
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
  const [thread, setThread] = useState<ParsedThread | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  // Stable transport reference avoids re-running the effect on every render
  // when the consumer passes an inline transport closure.
  const { transport } = options;

  useEffect(() => {
    if (!itemId || !conversationId) {
      setThread(null);
      setIsLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setThread(null);
    setError(false);

    void fetchCurrentThread(conversationId, acquireGraphToken, { transport })
      .then((result) => {
        if (cancelled) return;
        setThread(result);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        // Total fetch failure (ThreadFetchError) — surface it loudly instead
        // of degrading to a silent empty thread.
        console.warn("[useCurrentThread] conversation fetch failed:", fetchError);
        setThread(null);
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [acquireGraphToken, conversationId, itemId, transport]);

  return { thread, isLoading, error };
}
