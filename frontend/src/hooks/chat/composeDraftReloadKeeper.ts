import {
  restoreComposeReloadState,
  saveComposeReloadState,
} from "./composeReloadState";

export const COMPOSE_DRAFT_RELOAD_KEY = "erato.web.composeDraft";

let discarded = false;

function sessionStorageOf(win: Window): Storage | null {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

function remove(storage: Storage) {
  try {
    storage.removeItem(COMPOSE_DRAFT_RELOAD_KEY);
  } catch {
    // Storage gone: nothing to remove.
  }
}

/**
 * Keeps the unsent text over a reload of this tab, including iOS ending a
 * page in the background (it fires no unload then, so the snapshot is taken
 * whenever the page is hidden). The snapshot lives in this tab's session
 * storage and is dropped as soon as the page shows again without a reload,
 * so a later reload never brings back text that was sent meanwhile.
 */
export function installComposeDraftReloadKeeper(
  win: Window = window,
): () => void {
  const storage = sessionStorageOf(win);
  if (!storage) return () => {};
  try {
    restoreComposeReloadState(storage, COMPOSE_DRAFT_RELOAD_KEY);
  } catch (error) {
    console.warn("Failed to restore the unsent draft after a reload", error);
    remove(storage);
  }

  const save = () => {
    if (discarded) return;
    try {
      saveComposeReloadState(storage, COMPOSE_DRAFT_RELOAD_KEY, {
        allowPendingUploads: true,
      });
    } catch (error) {
      console.warn("Failed to keep the unsent draft for a reload", error);
      remove(storage);
    }
  };
  const drop = () => remove(storage);
  const onVisibilityChange = () => {
    if (win.document.visibilityState === "hidden") save();
    else drop();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    // Back from the back/forward cache: the page and its draft never left.
    if (event.persisted) drop();
  };

  win.addEventListener("pagehide", save);
  win.addEventListener("pageshow", onPageShow);
  win.document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    win.removeEventListener("pagehide", save);
    win.removeEventListener("pageshow", onPageShow);
    win.document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/** Signing out: the next person in this tab must not get this draft. */
export function discardComposeDraftsOnUnload(win: Window = window): void {
  discarded = true;
  const storage = sessionStorageOf(win);
  if (storage) remove(storage);
}

export function resetComposeDraftReloadKeeperForTests(): void {
  discarded = false;
}
