import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  COMPOSE_DRAFT_RELOAD_KEY,
  discardComposeDraftsOnUnload,
  installComposeDraftReloadKeeper,
  resetComposeDraftReloadKeeperForTests,
} from "../composeDraftReloadKeeper";
import { holdComposeReload } from "../composeReloadState";
import { useComposeSessionStore } from "../store/composeSessionStore";
import { useMessageQueueStore } from "../store/messageQueueStore";

let visibility: DocumentVisibilityState = "visible";
const uninstalls: (() => void)[] = [];

function install() {
  uninstalls.push(installComposeDraftReloadKeeper(window));
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

function pageDies() {
  uninstalls.splice(0).forEach((uninstall) => uninstall());
}

function freshPage() {
  // A reload starts with empty in-memory stores.
  useComposeSessionStore.setState({
    sessionIdByChatKey: {},
    draftsBySessionId: {},
  });
}

beforeEach(() => {
  sessionStorage.clear();
  resetComposeDraftReloadKeeperForTests();
  freshPage();
  useMessageQueueStore.setState({ queuedBySessionId: {} });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  visibility = "visible";
});
afterEach(() => {
  uninstalls.splice(0).forEach((uninstall) => uninstall());
});

describe("unsent draft over a reload", () => {
  it("keeps the text when the page is reloaded", () => {
    install();
    typeDraft("chat-1", "Half a question");
    window.dispatchEvent(new Event("pagehide"));
    pageDies();

    freshPage();
    install();

    expect(draftFor("chat-1")).toBe("Half a question");
    expect(sessionStorage.getItem(COMPOSE_DRAFT_RELOAD_KEY)).toBeNull();
  });

  it("keeps the text when iOS ends the page in the background", () => {
    install();
    typeDraft("__new-chat__", "Typed before locking the phone");
    setVisibility("hidden");
    pageDies();

    freshPage();
    install();

    expect(draftFor("__new-chat__")).toBe("Typed before locking the phone");
  });

  it("drops the snapshot when the page comes back without a reload", () => {
    install();
    typeDraft("chat-1", "Sent later");
    setVisibility("hidden");
    setVisibility("visible");

    expect(sessionStorage.getItem(COMPOSE_DRAFT_RELOAD_KEY)).toBeNull();
  });

  it("still keeps the text while an upload is running", () => {
    install();
    const release = holdComposeReload();
    typeDraft("chat-1", "With a file on its way");
    window.dispatchEvent(new Event("pagehide"));
    release();

    freshPage();
    install();

    expect(draftFor("chat-1")).toBe("With a file on its way");
  });

  it("keeps nothing for the next person after signing out", () => {
    install();
    typeDraft("chat-1", "Private");
    discardComposeDraftsOnUnload(window);
    window.dispatchEvent(new Event("pagehide"));

    freshPage();
    install();

    expect(draftFor("chat-1")).toBeUndefined();
  });

  it("does not bring back a queued message that sent while the page was hidden", () => {
    install();
    const store = useComposeSessionStore.getState();
    const sessionId = store.resolveSessionId("chat-1");
    useMessageQueueStore.setState({
      queuedBySessionId: {
        [sessionId]: {
          message: "Queued while answering",
          attachedFiles: [],
          mentionedAssistants: [],
        },
      },
    } as never);
    setVisibility("hidden");
    useMessageQueueStore.setState({ queuedBySessionId: {} });
    pageDies();

    freshPage();
    install();

    expect(draftFor("chat-1") ?? "").toBe("");
  });
});
