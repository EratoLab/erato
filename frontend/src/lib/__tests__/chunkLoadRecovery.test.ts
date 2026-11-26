import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConnectivityMonitor,
  type ConnectivityMonitor,
} from "@/lib/connectivity/connectivity";

import {
  CHUNK_RELOAD_GUARD_MS,
  claimChunkReload,
  installChunkLoadRecovery,
  isChunkLoadError,
  isChunkReloadPending,
  resetChunkLoadRecoveryForTests,
} from "../chunkLoadRecovery";

function fakeWindow(path = "/chat/abc") {
  const target = new EventTarget();
  const reload = vi.fn();
  const win = Object.assign(target, {
    location: { pathname: path, search: "?x=1", reload },
    sessionStorage,
  }) as unknown as Window;
  return { win, reload };
}

function reachableMonitor(): ConnectivityMonitor {
  return createConnectivityMonitor({
    fetchImpl: vi.fn().mockResolvedValue(new Response(null)),
  });
}

function firePreloadError(win: Window) {
  const event = new Event("vite:preloadError", { cancelable: true });
  win.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  sessionStorage.clear();
  resetChunkLoadRecoveryForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("chunk load recovery", () => {
  it("reloads once at the same address and keeps the error from the page", async () => {
    const { win, reload } = fakeWindow();
    const uninstall = installChunkLoadRecovery(win, reachableMonitor());

    const event = firePreloadError(win);

    expect(event.defaultPrevented).toBe(true);
    expect(isChunkReloadPending()).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    uninstall();
  });

  it("waits for the network before reloading, so the page does not land on the offline page", async () => {
    let online = false;
    const monitor = createConnectivityMonitor({
      fetchImpl: vi.fn(() =>
        online
          ? Promise.resolve(new Response(null))
          : Promise.reject(new TypeError("Load failed")),
      ),
    });
    const { win, reload } = fakeWindow();
    const uninstall = installChunkLoadRecovery(win, monitor);

    firePreloadError(win);
    await vi.waitFor(() => expect(monitor.getStatus()).toBe("offline"));
    expect(reload).not.toHaveBeenCalled();

    online = true;
    monitor.reportNetworkSuccess();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    uninstall();
  });

  it("lets the error through when the same address already reloaded a moment ago", async () => {
    const { win, reload } = fakeWindow();
    const uninstall = installChunkLoadRecovery(win, reachableMonitor());
    firePreloadError(win);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // The reloaded page is a fresh module instance.
    resetChunkLoadRecoveryForTests();

    const second = firePreloadError(win);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
    uninstall();
  });

  it("allows another reload at another address or after the guard window", () => {
    expect(claimChunkReload(sessionStorage, "/a", 1_000)).toBe(true);
    expect(claimChunkReload(sessionStorage, "/a", 2_000)).toBe(false);
    expect(claimChunkReload(sessionStorage, "/b", 3_000)).toBe(true);
    expect(
      claimChunkReload(sessionStorage, "/b", 3_000 + CHUNK_RELOAD_GUARD_MS),
    ).toBe(true);
  });

  it("never reloads without storage, so a broken file cannot loop the page", () => {
    expect(claimChunkReload(null, "/a", 1_000)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(claimChunkReload(throwing, "/a", 1_000)).toBe(false);
  });

  it("recognises the browsers' failed-import messages", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://x/assets/a.js",
      "error loading dynamically imported module: https://x/assets/a.js",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/a.css",
    ]) {
      expect(isChunkLoadError(new TypeError(message))).toBe(true);
    }
    expect(isChunkLoadError(new Error("Chat exploded"))).toBe(false);
    expect(isChunkLoadError("Importing a module script failed.")).toBe(false);
  });
});
