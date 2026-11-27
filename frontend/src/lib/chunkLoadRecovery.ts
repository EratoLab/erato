import {
  connectivity,
  type ConnectivityMonitor,
} from "@/lib/connectivity/connectivity";
import { safeSessionStorage } from "@/utils/safeSessionStorage";

/**
 * After a server update, a page still running the old build asks for code
 * files that are gone. When a code file fails to load, this checks whether
 * the server now runs another build, and only then reloads the page once at
 * the same address. A file that fails for another reason (a blocked request,
 * a flaky network) leaves the reload alone and the failing part shows its
 * own fallback.
 */

const RELOAD_MARKER_KEY = "erato.updateReload";

export type ChunkLoadRecovery = "reloading" | "update-waiting" | "no-update";

// Chrome, Firefox, Safari, and Vite's own preload failure.
const CHUNK_LOAD_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

const MODULE_SCRIPT_RE = /<script\b[^>]*\btype=["']module["'][^>]*>/gi;
const SRC_RE = /\bsrc=["']([^"']+)["']/i;

const workChecks = new Set<() => boolean>();
let checking: Promise<ChunkLoadRecovery> | null = null;
let onUpdateWaiting: (() => void) | null = null;

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return false;
  }
  const { message } = error;
  return typeof message === "string" && CHUNK_LOAD_ERROR_RE.test(message);
}

/**
 * Registers work a reload would lose (an answer streaming in, a running
 * upload, the microphone); while any is in progress an update only shows a
 * notice.
 */
export function registerWorkInProgress(check: () => boolean): () => void {
  workChecks.add(check);
  return () => workChecks.delete(check);
}

function entryScripts(html: string, base: string): string[] {
  return [...html.matchAll(MODULE_SCRIPT_RE)]
    .map((tag) => SRC_RE.exec(tag[0])?.[1])
    .filter((src): src is string => Boolean(src))
    .map((src) => new URL(src, base).pathname)
    .sort();
}

/** The deployed build's entry scripts, when they differ from the running page's. */
export async function findNewerBuild(
  win: Window = window,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<string | null> {
  const base = win.location.href;
  const running = entryScripts(win.document.documentElement.outerHTML, base);
  if (running.length === 0) return null;
  let html: string;
  try {
    const response = await fetchImpl(win.location.pathname, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("html")) return null;
    html = await response.text();
  } catch {
    return null;
  }
  const deployed = entryScripts(html, base);
  if (deployed.length === 0) return null;
  const same =
    deployed.length === running.length &&
    deployed.every((path, index) => path === running[index]);
  return same ? null : deployed.join(" ");
}

/** Records the reload into `build`; false when this tab already reloaded into it, so it cannot loop. */
export function claimReloadInto(
  storage: Storage | null,
  build: string,
): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(RELOAD_MARKER_KEY) === build) return false;
    storage.setItem(RELOAD_MARKER_KEY, build);
    return true;
  } catch {
    return false;
  }
}

/**
 * What to do about a code file that failed to load: reload into a newer
 * build, say a newer build waits while work is in progress, or nothing. One
 * check at a time; a later failure checks again.
 */
export function recoverFromChunkLoadFailure(
  win: Window = window,
  monitor: ConnectivityMonitor = connectivity,
  fetchImpl?: typeof fetch,
): Promise<ChunkLoadRecovery> {
  checking ??= (async (): Promise<ChunkLoadRecovery> => {
    await monitor.waitUntilOnline();
    const build = await findNewerBuild(win, fetchImpl);
    if (!build) return "no-update";
    if ([...workChecks].some((check) => check())) {
      onUpdateWaiting?.();
      return "update-waiting";
    }
    if (!claimReloadInto(safeSessionStorage(win), build)) return "no-update";
    win.location.reload();
    return "reloading";
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/**
 * Vite fires `vite:preloadError` when a code file of the build fails to load.
 * It is not cancelled: the part that asked for the file gets the error and
 * shows its own fallback while the check runs.
 */
export function installChunkLoadRecovery({
  win = window,
  monitor = connectivity,
  updateWaiting,
}: {
  win?: Window;
  monitor?: ConnectivityMonitor;
  /** Says a newer version waits, with a way to reload. */
  updateWaiting?: () => void;
} = {}): () => void {
  onUpdateWaiting = updateWaiting ?? null;
  const onPreloadError = () => {
    void recoverFromChunkLoadFailure(win, monitor);
  };
  win.addEventListener("vite:preloadError", onPreloadError);
  return () => {
    win.removeEventListener("vite:preloadError", onPreloadError);
    if (onUpdateWaiting === updateWaiting) onUpdateWaiting = null;
  };
}
