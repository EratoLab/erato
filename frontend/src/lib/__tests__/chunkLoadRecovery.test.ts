import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConnectivityMonitor,
  type ConnectivityMonitor,
} from "@/lib/connectivity/connectivity";

import {
  claimReloadInto,
  findNewerBuild,
  installChunkLoadRecovery,
  isChunkLoadError,
  recoverFromChunkLoadFailure,
  registerWorkInProgress,
} from "../chunkLoadRecovery";

const RUNNING = `<html><head><script type="module" crossorigin src="/assets/app-old.js"></script></head><body></body></html>`;
const NEWER = `<!doctype html><html><head><script type="module" crossorigin src="/assets/app-new.js"></script></head></html>`;

function fakeWindow(running = RUNNING) {
  const reload = vi.fn();
  const target = new EventTarget();
  const doc = new DOMParser().parseFromString(running, "text/html");
  const win = Object.assign(target, {
    location: {
      href: "https://erato.example/chat/abc?code=secret",
      pathname: "/chat/abc",
      reload,
    },
    document: doc,
    sessionStorage,
  }) as unknown as Window;
  return { win, reload };
}

function servesPage(html: string) {
  return vi.fn().mockResolvedValue(
    new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
}

function reachable(): ConnectivityMonitor {
  return createConnectivityMonitor({
    fetchImpl: vi.fn().mockResolvedValue(new Response(null)),
  });
}

const unregister: (() => void)[] = [];

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  unregister.splice(0).forEach((stop) => stop());
});

describe("update recovery after a code file failed to load", () => {
  it("reloads once at the same address when the server runs a newer build", async () => {
    const { win, reload } = fakeWindow();

    await expect(
      recoverFromChunkLoadFailure(win, reachable(), servesPage(NEWER)),
    ).resolves.toBe("reloading");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("erato.updateReload")).not.toContain(
      "secret",
    );
  });

  it("leaves the page alone when the server still runs the same build", async () => {
    const { win, reload } = fakeWindow();

    await expect(
      recoverFromChunkLoadFailure(win, reachable(), servesPage(RUNNING)),
    ).resolves.toBe("no-update");
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves the page alone when it cannot tell (sign-in page, no answer)", async () => {
    const { win, reload } = fakeWindow();
    const signIn = vi.fn().mockResolvedValue(
      new Response("<html>sign in</html>", {
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(findNewerBuild(win, signIn)).resolves.toBeNull();
    await expect(
      findNewerBuild(
        win,
        vi.fn().mockRejectedValue(new TypeError("Load failed")),
      ),
    ).resolves.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("only says a newer version waits while work is in progress", async () => {
    const { win, reload } = fakeWindow();
    const updateWaiting = vi.fn();
    unregister.push(installChunkLoadRecovery({ win, updateWaiting }));
    unregister.push(registerWorkInProgress(() => true));

    await expect(
      recoverFromChunkLoadFailure(win, reachable(), servesPage(NEWER)),
    ).resolves.toBe("update-waiting");
    expect(reload).not.toHaveBeenCalled();
    expect(updateWaiting).toHaveBeenCalledTimes(1);
  });

  it("reloads into a build only once per tab, so a file that never loads cannot loop", () => {
    expect(claimReloadInto(sessionStorage, "/assets/app-new.js")).toBe(true);
    expect(claimReloadInto(sessionStorage, "/assets/app-new.js")).toBe(false);
    expect(claimReloadInto(sessionStorage, "/assets/app-newer.js")).toBe(true);
    expect(claimReloadInto(null, "/assets/app-new.js")).toBe(false);
  });

  it("checks only once the server answers again", async () => {
    let online = false;
    const monitor = createConnectivityMonitor({
      fetchImpl: vi.fn(() =>
        online
          ? Promise.resolve(new Response(null))
          : Promise.reject(new TypeError("Load failed")),
      ),
    });
    monitor.reportNetworkFailure();
    await vi.waitFor(() => expect(monitor.getStatus()).toBe("offline"));
    const { win, reload } = fakeWindow();
    const page = servesPage(NEWER);

    const recovery = recoverFromChunkLoadFailure(win, monitor, page);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(page).not.toHaveBeenCalled();

    online = true;
    monitor.reportNetworkSuccess();
    await expect(recovery).resolves.toBe("reloading");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not cancel Vite's error, so the part shows its own fallback", () => {
    const { win } = fakeWindow();
    unregister.push(installChunkLoadRecovery({ win, monitor: reachable() }));
    const event = new Event("vite:preloadError", { cancelable: true });

    win.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
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
