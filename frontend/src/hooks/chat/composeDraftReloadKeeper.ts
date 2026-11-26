import { safeSessionStorage } from "@/utils/safeSessionStorage";

import {
  applyComposeReloadSnapshot,
  buildComposeReloadSnapshot,
  hasPendingComposeUploads,
  parseComposeReloadSnapshot,
  type ComposeReloadSnapshot,
} from "./composeReloadState";
import { useComposeSessionStore } from "./store/composeSessionStore";
import { useMessageQueueStore } from "./store/messageQueueStore";

export const COMPOSE_DRAFT_RELOAD_KEY = "erato.web.composeDraft";
/** A draft older than this is not brought back: the person has moved on. */
export const COMPOSE_DRAFT_MAX_AGE_MS = 10 * 60_000;

let storage: Storage | null = null;
let ownerId: string | null = null;
let pending: ComposeReloadSnapshot | null = null;
let discarded = false;

function remove() {
  try {
    storage?.removeItem(COMPOSE_DRAFT_RELOAD_KEY);
  } catch {
    // Storage gone: nothing to remove.
  }
}

function write(snapshot: ComposeReloadSnapshot) {
  storage?.setItem(COMPOSE_DRAFT_RELOAD_KEY, JSON.stringify(snapshot));
}

function save() {
  if (discarded || !storage) return;
  try {
    if (ownerId) {
      write(buildComposeReloadSnapshot(ownerId, Date.now()));
    } else if (pending) {
      // Reloading again before the profile loaded: pass the draft on as is.
      write(pending);
    } else {
      remove();
    }
  } catch (error) {
    console.warn("Failed to keep the unsent draft for a reload", error);
    remove();
  }
}

/**
 * Keeps the unsent text over a reload of this tab, including iOS ending a
 * page in the background (it fires no unload then, so the snapshot is taken
 * whenever the page is hidden and follows later changes). The snapshot is
 * dropped as soon as the page shows again without a reload, and is brought
 * back only for the same person, once their profile has loaded.
 */
export function installComposeDraftReloadKeeper(
  win: Window = window,
): () => void {
  storage = safeSessionStorage(win);
  if (!storage) return () => {};
  let raw: string | null = null;
  try {
    raw = storage.getItem(COMPOSE_DRAFT_RELOAD_KEY);
  } catch {
    raw = null;
  }
  remove();
  const snapshot = raw ? parseComposeReloadSnapshot(raw) : null;
  if (snapshot && Date.now() - snapshot.savedAt <= COMPOSE_DRAFT_MAX_AGE_MS) {
    pending = snapshot;
  }

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
    remove();
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

/** The signed-in person; their kept draft comes back now, anyone else's is dropped. */
export function setComposeDraftOwner(profileId: string): void {
  ownerId = profileId;
  if (!pending) return;
  const snapshot = pending;
  pending = null;
  if (snapshot.ownerId === profileId && !discarded) {
    applyComposeReloadSnapshot(snapshot);
  }
}

/**
 * Saves now, for a host that is about to reload on purpose. Throws when it
 * cannot keep the draft, so the host does not reload: while uploads still run
 * (`ComposeReloadBlockedError`), before the profile is known, or when storage
 * refuses.
 */
export function saveComposeDraftForReload(): void {
  if (hasPendingComposeUploads()) {
    const error = new Error(
      "Pending local attachments prevent composer reload",
    );
    // eslint-disable-next-line lingui/no-unlocalized-strings -- error code the host translates
    error.name = "ComposeReloadBlockedError";
    throw error;
  }
  if (!storage || !ownerId) {
    throw new Error("No signed-in person to keep the draft for");
  }
  write(buildComposeReloadSnapshot(ownerId, Date.now()));
}

/** Signing out: the next person in this tab must not get this draft. */
export function discardComposeDraftsOnUnload(): void {
  discarded = true;
  pending = null;
  remove();
}

export function resetComposeDraftReloadKeeperForTests(): void {
  storage = null;
  ownerId = null;
  pending = null;
  discarded = false;
}
