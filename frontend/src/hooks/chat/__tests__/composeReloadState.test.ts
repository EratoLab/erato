import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  holdComposeReload,
  registerComposeReloadOptions,
  takeComposeReloadOptions,
  restoreComposeReloadState,
  saveComposeReloadState,
} from "../composeReloadState";
import { useComposeSessionStore } from "../store/composeSessionStore";
import { useMessageQueueStore } from "../store/messageQueueStore";

import type { ComposeDraftState } from "../useComposeSession";

beforeEach(() => {
  sessionStorage.clear();
  useComposeSessionStore.setState({
    sessionIdByChatKey: {},
    draftsBySessionId: {},
  });
  useMessageQueueStore.setState({ queuedBySessionId: {} });
});

describe("composer consent reload", () => {
  it("restores unsent text, uploaded attachments and mentions for existing and new chats exactly once", () => {
    const state = useComposeSessionStore.getState();
    const existing = state.resolveSessionId("chat-1");
    const fresh = state.resolveSessionId("__new-chat__");
    const draft = {
      message: "Unsent draft",
      attachedFiles: [{ id: "uploaded-file", filename: "notes.pdf" }],
      mentionedAssistants: [{ id: "assistant-1", name: "Writer" }],
    };
    state.saveDraft(existing, draft as ComposeDraftState);
    state.saveDraft(fresh, {
      message: "New draft",
      attachedFiles: [],
      mentionedAssistants: [],
    });
    saveComposeReloadState(sessionStorage, "reload");
    useComposeSessionStore.setState({
      sessionIdByChatKey: {},
      draftsBySessionId: {},
    });
    restoreComposeReloadState(sessionStorage, "reload");
    expect(useComposeSessionStore.getState().resolveSessionId("chat-1")).toBe(
      existing,
    );
    expect(useComposeSessionStore.getState().getDraft(existing)).toEqual(draft);
    expect(useComposeSessionStore.getState().getDraft(fresh).message).toBe(
      "New draft",
    );
    expect(sessionStorage.getItem("reload")).toBeNull();
  });

  it("returns queued messages to drafts without enabling automatic submission", () => {
    const id = useComposeSessionStore.getState().resolveSessionId("chat-1");
    useComposeSessionStore.getState().saveDraft(id, {
      message: "Next",
      attachedFiles: [],
      mentionedAssistants: [],
    });
    useMessageQueueStore.getState().setQueued(id, {
      message: "Queued",
      attachedFiles: [],
      mentionedAssistants: [],
    });
    saveComposeReloadState(sessionStorage, "reload");
    useMessageQueueStore.setState({ queuedBySessionId: {} });
    restoreComposeReloadState(sessionStorage, "reload");
    expect(useComposeSessionStore.getState().getDraft(id).message).toBe(
      "Queued\n\nNext",
    );
    expect(useMessageQueueStore.getState().getQueued(id)).toBeNull();
  });

  it("holds the reload while local attachments are pending", () => {
    const release = holdComposeReload();
    try {
      expect(() => saveComposeReloadState(sessionStorage, "reload")).toThrow(
        "Pending local attachments",
      );
      expect(sessionStorage.getItem("reload")).toBeNull();
    } finally {
      release();
    }
    expect(() =>
      saveComposeReloadState(sessionStorage, "reload"),
    ).not.toThrow();
  });

  it("restores model and tool selections once", () => {
    const unregister = registerComposeReloadOptions("session", () => ({
      selectedFacetIds: ["tool"],
      selectedChatProviderId: "model",
    }));
    saveComposeReloadState(sessionStorage, "reload");
    unregister();
    restoreComposeReloadState(sessionStorage, "reload");
    expect(takeComposeReloadOptions("session")).toEqual({
      selectedFacetIds: ["tool"],
      selectedChatProviderId: "model",
    });
    expect(takeComposeReloadOptions("session")).toBeUndefined();
  });

  it("propagates storage failures so the host can prevent reload", () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    } as unknown as Storage;
    expect(() => saveComposeReloadState(storage, "reload")).toThrow(
      "quota exceeded",
    );
  });
});
