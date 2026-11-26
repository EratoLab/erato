import { safeSessionStorage } from "@/utils/safeSessionStorage";

import {
  restoreComposeReloadState,
  saveComposeReloadState,
} from "./composeReloadState";
import { useComposeSessionStore } from "./store/composeSessionStore";
import { useMessageQueueStore } from "./store/messageQueueStore";

export const COMPOSE_DRAFT_RELOAD_KEY = "erato.web.composeDraft";

let discarded = false;

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
  const storage = safeSessionStorage(win);
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
  // A queued message can still send while the page is hidden; the snapshot
  // follows, so a later reload does not bring back text already sent.
  let stopFollowing: (() => void) | null = null;
  const followWhileHidden = () => {
    if (stopFollowing) return;
    const unsubscribeDrafts = useComposeSessionStore.subscribe(save);
    const unsubscribeQueue = useMessageQueueStore.subscribe(save);
    stopFollowing = () => {
      unsubscribeDrafts();
      unsubscribeQueue();
      stopFollowing = null;
    };
  };
  const drop = () => {
    stopFollowing?.();
    remove(storage);
  };
  const onVisibilityChange = () => {
    if (win.document.visibilityState === "hidden") {
      save();
      followWhileHidden();
    } else {
      drop();
    }
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
    stopFollowing?.();
  };
}

/** Signing out: the next person in this tab must not get this draft. */
export function discardComposeDraftsOnUnload(win: Window = window): void {
  discarded = true;
  const storage = safeSessionStorage(win);
  if (storage) remove(storage);
}

export function resetComposeDraftReloadKeeperForTests(): void {
  discarded = false;
}
