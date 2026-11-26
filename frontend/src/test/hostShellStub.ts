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
  window.ERATO_SHELL = {
    contract: 1,
    capabilities,
    request,
    on: () => () => {},
  };
  return request;
}

export function removeHostShell() {
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
