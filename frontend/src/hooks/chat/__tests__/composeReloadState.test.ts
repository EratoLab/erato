import { beforeEach, describe, expect, it } from "vitest";

import {
  applyComposeReloadSnapshot,
  buildComposeReloadSnapshot,
  parseComposeReloadSnapshot,
  registerComposeReloadOptions,
  takeComposeReloadOptions,
} from "../composeReloadState";
import { useComposeSessionStore } from "../store/composeSessionStore";
import { useMessageQueueStore } from "../store/messageQueueStore";

import type { ComposeDraftState } from "../useComposeSession";

function resetStores() {
  useComposeSessionStore.setState({
    sessionIdByChatKey: {},
    draftsBySessionId: {},
    restoreEpoch: 0,
  });
  useMessageQueueStore.setState({ queuedBySessionId: {} });
}

/** Builds, serialises and parses a snapshot, as a reload would. */
function overReload() {
  const raw = JSON.stringify(buildComposeReloadSnapshot("person-1", 1_000));
  resetStores();
  const snapshot = parseComposeReloadSnapshot(raw);
  if (!snapshot) throw new Error("snapshot did not parse");
  return snapshot;
}

beforeEach(resetStores);

describe("composer reload snapshot", () => {
  it("brings back unsent text, uploaded attachments and mentions for existing and new chats", () => {
    const state = useComposeSessionStore.getState();
    const existing = state.resolveSessionId("chat-1");
    const fresh = state.resolveSessionId("__new-chat__");
    state.saveDraft(existing, {
      message: "Unsent draft",
      attachedFiles: [
        {
          id: "uploaded-file",
          filename: "notes.pdf",
          download_url: "https://storage.example/signed?sig=secret",
          preview_url: "/api/v1beta/files/uploaded-file/preview",
        },
      ],
      mentionedAssistants: [{ id: "assistant-1", name: "Writer" }],
    } as unknown as ComposeDraftState);
    state.saveDraft(fresh, {
      message: "New draft",
      attachedFiles: [],
      mentionedAssistants: [],
    });

    applyComposeReloadSnapshot(overReload());

    const restored = useComposeSessionStore.getState();
    const draft = restored.getDraft(restored.sessionIdByChatKey["chat-1"]!);
    expect(draft.message).toBe("Unsent draft");
    expect(draft.mentionedAssistants).toEqual([
      { id: "assistant-1", name: "Writer" },
    ]);
    expect(
      restored.getDraft(restored.sessionIdByChatKey["__new-chat__"]!).message,
    ).toBe("New draft");
    expect(restored.restoreEpoch).toBe(1);
  });

  it("keeps no download link, only the proxied preview", () => {
    const state = useComposeSessionStore.getState();
    state.saveDraft(state.resolveSessionId("chat-1"), {
      message: "",
      attachedFiles: [
        {
          id: "f",
          filename: "a.pdf",
          download_url: "https://storage.example/signed?sig=secret",
          preview_url: "/preview/f",
        },
      ],
      mentionedAssistants: [],
    } as unknown as ComposeDraftState);

    const raw = JSON.stringify(buildComposeReloadSnapshot("person-1", 1));

    expect(raw).not.toContain("sig=secret");
    expect(raw).toContain("/preview/f");
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

    applyComposeReloadSnapshot(overReload());

    expect(useComposeSessionStore.getState().getDraft(id).message).toBe(
      "Queued\n\nNext",
    );
    expect(useMessageQueueStore.getState().getQueued(id)).toBeNull();
  });

  it("does not overwrite text typed after the page loaded", () => {
    const state = useComposeSessionStore.getState();
    state.saveDraft(state.resolveSessionId("chat-1"), {
      message: "Old",
      attachedFiles: [],
      mentionedAssistants: [],
    });
    const snapshot = overReload();
    const typed = useComposeSessionStore.getState().resolveSessionId("chat-1");
    useComposeSessionStore.getState().saveDraft(typed, {
      message: "Typed now",
      attachedFiles: [],
      mentionedAssistants: [],
    });

    applyComposeReloadSnapshot(snapshot);

    const after = useComposeSessionStore.getState();
    expect(after.sessionIdByChatKey["chat-1"]).toBe(typed);
    expect(after.getDraft(typed).message).toBe("Typed now");
  });

  it("brings back model and tool selections once", () => {
    const sessionId = useComposeSessionStore
      .getState()
      .resolveSessionId("chat-1");
    const unregister = registerComposeReloadOptions(sessionId, () => ({
      selectedFacetIds: ["tool"],
      selectedChatProviderId: "model",
    }));
    const snapshot = overReload();
    unregister();

    applyComposeReloadSnapshot(snapshot);

    expect(takeComposeReloadOptions(sessionId)).toEqual({
      selectedFacetIds: ["tool"],
      selectedChatProviderId: "model",
    });
    expect(takeComposeReloadOptions(sessionId)).toBeUndefined();
  });

  it("reads nothing from a corrupt or old snapshot", () => {
    expect(parseComposeReloadSnapshot("{not json")).toBeNull();
    expect(
      parseComposeReloadSnapshot(
        JSON.stringify({
          version: 1,
          sessionIdByChatKey: {},
          draftsBySessionId: {},
        }),
      ),
    ).toBeNull();
  });
});
