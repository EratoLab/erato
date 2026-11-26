import {
  connectivity,
  type ConnectivityMonitor,
} from "@/lib/connectivity/connectivity";
import { safeSessionStorage } from "@/utils/safeSessionStorage";

/**
 * After a server update, a page still running the old build asks for code
 * files that are gone. Reload once at the same address so it picks up the new
 * build. A second failure at the same address within the guard window is left
 * to the error screen, so a file that is really missing cannot loop the page.
 */

const RELOAD_MARKER_KEY = "erato.chunkLoadReload";
export const CHUNK_RELOAD_GUARD_MS = 5 * 60_000;

// Chrome, Firefox, Safari, and Vite's own preload failure.
const CHUNK_LOAD_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

let reloadPending = false;

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return false;
  }
  const { message } = error;
  return typeof message === "string" && CHUNK_LOAD_ERROR_RE.test(message);
}

/** True once this page has started a reload to fetch a newer build. */
export function isChunkReloadPending(): boolean {
  return reloadPending;
}

/** Decides and records the reload; false when storage is unusable, so it cannot loop. */
export function claimChunkReload(
  storage: Storage | null,
  address: string,
  now: number,
): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(RELOAD_MARKER_KEY);
    if (raw) {
      const last = JSON.parse(raw) as { address?: unknown; at?: unknown };
      if (
        last.address === address &&
        typeof last.at === "number" &&
        now - last.at < CHUNK_RELOAD_GUARD_MS
      ) {
        return false;
      }
    }
    storage.setItem(RELOAD_MARKER_KEY, JSON.stringify({ address, at: now }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reloads the page once per address and guard window. True when a reload is
 * under way. A file can also fail because the network dropped; reloading then
 * would land on the browser's offline page, so the reload waits until the
 * server answers again.
 */
export function reloadOnceForChunkError(
  win: Window = window,
  monitor: ConnectivityMonitor = connectivity,
): boolean {
  if (reloadPending) return true;
  const address = `${win.location.pathname}${win.location.search}`;
  if (!claimChunkReload(safeSessionStorage(win), address, Date.now())) {
    return false;
  }
  reloadPending = true;
  monitor.reportNetworkFailure();
  void monitor.waitUntilOnline().then(() => win.location.reload());
  return true;
}

/**
 * Vite fires `vite:preloadError` when a code file of the build fails to load.
 * Unhandled, it rethrows into whatever asked for the file (a lazy page).
 */
export function installChunkLoadRecovery(
  win: Window = window,
  monitor: ConnectivityMonitor = connectivity,
): () => void {
  const onPreloadError = (event: Event) => {
    if (reloadOnceForChunkError(win, monitor)) {
      event.preventDefault();
    }
  };
  win.addEventListener("vite:preloadError", onPreloadError);
  return () => win.removeEventListener("vite:preloadError", onPreloadError);
}

export function resetChunkLoadRecoveryForTests(): void {
  reloadPending = false;
}
