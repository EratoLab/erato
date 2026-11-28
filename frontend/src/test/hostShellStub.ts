import { vi } from "vitest";

/**
 * Puts a host app's `window.ERATO_SHELL` with `capabilities` in place;
 * `request` answers its calls. Remove it with `removeHostShell`.
 */
export function installHostShell(
  capabilities: Record<string, number>,
  request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(() =>
    Promise.resolve({ completed: true }),
  ),
) {
  listeners.clear();
  window.ERATO_SHELL = {
    contract: 1,
    capabilities,
    request,
    on: (event: string, listener: (payload: unknown) => void) => {
      const forEvent = listeners.get(event) ?? new Set();
      forEvent.add(listener);
      listeners.set(event, forEvent);
      return () => forEvent.delete(listener);
    },
  };
  return request;
}

const listeners = new Map<string, Set<(payload: unknown) => void>>();

/** Sends `event` to the page's listeners, as the host app would. */
export function emitHostShellEvent(event: string, payload: unknown) {
  for (const listener of listeners.get(event) ?? []) listener(payload);
}

export function removeHostShell() {
  listeners.clear();
  delete window.ERATO_SHELL;
}

/**
 * A `fetch` that answers every request with `body`. jsdom's FileReader takes
 * only its own Blob, not the one a real Response gives.
 */
export function fileFetch(
  body: string,
  type: string,
  headers: Record<string, string> = {},
) {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(headers),
      blob: () => Promise.resolve(new Blob([body], { type })),
    } as Response),
  );
}
