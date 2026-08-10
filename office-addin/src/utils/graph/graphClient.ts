/**
 * Host-neutral Microsoft Graph plumbing: the base URL, the token source that
 * caches one token per operation, the 401-retrying fetch wrapper, and the
 * throttle helpers every Graph caller needs.
 *
 * Lives in the shared ring so both host compositions (Outlook mail/calendar,
 * Teams chats) issue Graph requests through the same 401-replay, Retry-After
 * clamp, and bounded-concurrency semantics instead of drifting copies.
 */

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Upper bound on an honored `Retry-After`, so a bad header can't hang us. */
export const MAX_RETRY_AFTER_SECONDS = 10;

export type AcquireGraphToken = (options?: {
  forceRefresh?: boolean;
}) => Promise<string>;

export interface GraphRequestOptions {
  signal?: AbortSignal;
}

/**
 * Optional transport — defaults to global `fetch`. Tests inject a stub so
 * they don't have to `vi.stubGlobal` and assert on call ordering.
 */
export type GraphTransport = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Caches one Graph token across all requests of a single operation (so a
 * multi-request fetch still acquires only once) while allowing a forced refresh
 * when a request comes back 401.
 */
export interface GraphTokenSource {
  get(): Promise<string>;
  refresh(): Promise<string>;
}

export function makeGraphTokenSource(
  acquireToken: AcquireGraphToken,
): GraphTokenSource {
  // The current in-flight/resolved token promise, and the in-flight FORCED
  // acquire (if any). A forced acquire is tracked separately so a burst of
  // concurrent 401-driven refresh() calls (e.g. the bounded itemAttachment
  // enrichment fan-out) coalesces onto ONE force-refresh instead of firing N.
  let cached: Promise<string> | null = null;
  let pendingForce: Promise<string> | null = null;

  const run = (force: boolean): Promise<string> => {
    const promise = acquireToken(force ? { forceRefresh: true } : undefined);
    cached = promise;
    if (force) {
      pendingForce = promise;
    }
    void promise.then(
      () => {
        if (pendingForce === promise) pendingForce = null;
      },
      () => {
        // Never cache a rejected promise — clear so the next caller re-attempts
        // instead of being served the poisoned failure forever.
        if (cached === promise) cached = null;
        if (pendingForce === promise) pendingForce = null;
      },
    );
    return promise;
  };

  return {
    get() {
      return cached ?? run(false);
    },
    refresh() {
      return pendingForce ?? run(true);
    },
  };
}

/**
 * Issues a Graph request with the operation's cached token and, on a 401 (token
 * revoked / CAE-invalidated even though MSAL returned it from cache),
 * force-refreshes the token and retries exactly once. The add-in-side analogue
 * of the session `recoverAuth`, scoped to the Graph token — a separate cache
 * from the proxy-session bootstrap token, hence handled here rather than via the
 * shared recovery handler. `init` opts a non-GET request (method/body/extra
 * headers) into the same retry semantics; Authorization/Accept stay owned here.
 */
export async function graphFetch(
  url: string,
  tokenSource: GraphTokenSource,
  accept: string,
  signal: AbortSignal | undefined,
  transport: GraphTransport = globalThis.fetch.bind(globalThis),
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const request = (token: string) =>
    transport(url, {
      ...init,
      signal,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
        Accept: accept,
      },
    });
  const response = await request(await tokenSource.get());
  if (response.status !== 401) {
    return response;
  }
  // Don't waste a force-refresh + replay if the caller already aborted in the
  // window between the 401 and the retry (matches the abort checks elsewhere).
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  return request(await tokenSource.refresh());
}

/** Run thunks with at most `limit` in flight at once. Each thunk is expected to
 * swallow its own errors, so the pool never rejects. */
export async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (cursor < tasks.length) {
        const index = cursor;
        cursor += 1;
        await tasks[index]();
      }
    },
  );
  await Promise.all(workers);
}

/** Parse a `Retry-After` (delta-seconds) header into a clamped ms delay, or
 * null when absent/unparseable. Clamped so a hostile header can't stall us. */
export function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get?.("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS) * 1000;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", handleAbort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}
