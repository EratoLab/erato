import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMPOSE_DRAFT_MAX_AGE_MS,
  COMPOSE_DRAFT_RELOAD_KEY,
  discardComposeDraftsOnUnload,
  installComposeDraftReloadKeeper,
  resetComposeDraftReloadKeeperForTests,
  saveComposeDraftForReload,
  setComposeDraftOwner,
} from "../composeDraftReloadKeeper";
import { holdComposeReload } from "../composeReloadState";
import { useComposeSessionStore } from "../store/composeSessionStore";
import { useMessageQueueStore } from "../store/messageQueueStore";

let visibility: DocumentVisibilityState = "visible";
const uninstalls: (() => void)[] = [];

/** A page load: the keeper reads what the last page kept. */
function load() {
  uninstalls.push(installComposeDraftReloadKeeper(window));
}

/** The page goes away; its in-memory state is gone. */
function pageDies() {
  uninstalls.splice(0).forEach((uninstall) => uninstall());
  resetComposeDraftReloadKeeperForTests();
  useComposeSessionStore.setState({
    sessionIdByChatKey: {},
    draftsBySessionId: {},
    restoreEpoch: 0,
  });
  useMessageQueueStore.setState({ queuedBySessionId: {} });
}

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

function typeDraft(chatKey: string, message: string) {
  const store = useComposeSessionStore.getState();
  store.saveDraft(store.resolveSessionId(chatKey), {
    message,
    attachedFiles: [],
    mentionedAssistants: [],
  });
}

function draftFor(chatKey: string) {
  const store = useComposeSessionStore.getState();
  const sessionId = store.sessionIdByChatKey[chatKey];
  return sessionId ? store.getDraft(sessionId).message : undefined;
}

/** Signed in as `person`, typed `message`, then reloaded. */
function typeAndReload(person: string, message: string) {
  load();
  setComposeDraftOwner(person);
  typeDraft("chat-1", message);
  window.dispatchEvent(new Event("pagehide"));
  pageDies();
  load();
}

beforeEach(() => {
  sessionStorage.clear();
  pageDies();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  visibility = "visible";
});
afterEach(() => {
  pageDies();
  vi.useRealTimers();
});

describe("unsent draft over a reload", () => {
  it("brings the text back once the same person's profile has loaded", () => {
    typeAndReload("person-1", "Half a question");

    expect(draftFor("chat-1")).toBeUndefined();
    setComposeDraftOwner("person-1");

    expect(draftFor("chat-1")).toBe("Half a question");
    expect(sessionStorage.getItem(COMPOSE_DRAFT_RELOAD_KEY)).toBeNull();
  });

  it("never gives it to another person signing in on the same tab", () => {
    typeAndReload("person-1", "Private");

    setComposeDraftOwner("person-2");

    expect(draftFor("chat-1")).toBeUndefined();
  });

  it("drops a draft older than ten minutes", () => {
    vi.useFakeTimers();
    load();
    setComposeDraftOwner("person-1");
    typeDraft("chat-1", "Long ago");
    window.dispatchEvent(new Event("pagehide"));
    pageDies();
    vi.advanceTimersByTime(COMPOSE_DRAFT_MAX_AGE_MS + 1);
    load();

    setComposeDraftOwner("person-1");

    expect(draftFor("chat-1")).toBeUndefined();
  });

  it("passes the draft on when the page reloads again before the profile loaded", () => {
    typeAndReload("person-1", "Through a sign-in");
    window.dispatchEvent(new Event("pagehide"));
    pageDies();
    load();

    setComposeDraftOwner("person-1");

    expect(draftFor("chat-1")).toBe("Through a sign-in");
  });

  it("keeps the text when iOS ends the page in the background", () => {
    load();
    setComposeDraftOwner("person-1");
    typeDraft("__new-chat__", "Typed before locking the phone");
    setVisibility("hidden");
    pageDies();
    load();

    setComposeDraftOwner("person-1");

    expect(draftFor("__new-chat__")).toBe("Typed before locking the phone");
  });

  it("drops the snapshot when the page comes back without a reload", () => {
    load();
    setComposeDraftOwner("person-1");
    typeDraft("chat-1", "Sent later");
    setVisibility("hidden");
    setVisibility("visible");

    expect(sessionStorage.getItem(COMPOSE_DRAFT_RELOAD_KEY)).toBeNull();
  });

  it("still keeps the text while an upload is running", () => {
    load();
    setComposeDraftOwner("person-1");
    const release = holdComposeReload();
    typeDraft("chat-1", "With a file on its way");
    window.dispatchEvent(new Event("pagehide"));
    release();
    pageDies();
    load();

    setComposeDraftOwner("person-1");

    expect(draftFor("chat-1")).toBe("With a file on its way");
  });

  it("keeps nothing for the next person after signing out", () => {
    load();
    setComposeDraftOwner("person-1");
    typeDraft("chat-1", "Private");
    discardComposeDraftsOnUnload();
    window.dispatchEvent(new Event("pagehide"));
    pageDies();
    load();

    setComposeDraftOwner("person-1");

    expect(draftFor("chat-1")).toBeUndefined();
  });

  it("does not bring back a queued message that sent while the page was hidden", () => {
    load();
    setComposeDraftOwner("person-1");
    const sessionId = useComposeSessionStore
      .getState()
      .resolveSessionId("chat-1");
    useMessageQueueStore.getState().setQueued(sessionId, {
      message: "Queued while answering",
      attachedFiles: [],
      mentionedAssistants: [],
    });
    setVisibility("hidden");
    useMessageQueueStore.setState({ queuedBySessionId: {} });
    pageDies();
    load();

    setComposeDraftOwner("person-1");

    expect(draftFor("chat-1") ?? "").toBe("");
  });

  it("keeps nothing rather than a broken snapshot when storage refuses", () => {
    load();
    setComposeDraftOwner("person-1");
    typeDraft("chat-1", "Too big");
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
    window.dispatchEvent(new Event("pagehide"));
    setItem.mockRestore();

    expect(sessionStorage.getItem(COMPOSE_DRAFT_RELOAD_KEY)).toBeNull();
  });

  it("ignores a corrupt snapshot", () => {
    sessionStorage.setItem(COMPOSE_DRAFT_RELOAD_KEY, "{broken");
    load();

    setComposeDraftOwner("person-1");

    expect(draftFor("chat-1")).toBeUndefined();
    expect(sessionStorage.getItem(COMPOSE_DRAFT_RELOAD_KEY)).toBeNull();
  });
});

describe("a host's own reload (microphone consent)", () => {
  it("refuses while uploads are still running, so the host does not reload", () => {
    load();
    setComposeDraftOwner("person-1");
    const release = holdComposeReload();
    try {
      expect(() => saveComposeDraftForReload()).toThrow(
        expect.objectContaining({ name: "ComposeReloadBlockedError" }),
      );
    } finally {
      release();
    }
  });

  it("keeps the draft for the reload", () => {
    load();
    setComposeDraftOwner("person-1");
    typeDraft("chat-1", "Before the microphone prompt");
    saveComposeDraftForReload();
    pageDies();
    load();

    setComposeDraftOwner("person-1");

    expect(draftFor("chat-1")).toBe("Before the microphone prompt");
  });

  it("tells the host when storage refuses", () => {
    load();
    setComposeDraftOwner("person-1");
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
    try {
      expect(() => saveComposeDraftForReload()).toThrow("full");
    } finally {
      setItem.mockRestore();
    }
  });
});
