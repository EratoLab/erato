import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWordDocumentCaptures } from "../useWordDocumentCaptures";

import type { AddinChatController } from "../../../core/AddinChatCore";
import type { WordDocumentCapture } from "../../utils/wordDocumentCapture";
import type { Message } from "@erato/frontend/library";

const capture = (identity: string): WordDocumentCapture => ({
  identity,
  ordinalMap: new Map([[1, { uniqueLocalId: "id-1", text: "Revenue grew." }]]),
  paragraphsSent: 1,
  renderedOrdinals: new Set([1]),
  partialOrdinal: null,
});

const message = (
  role: "user" | "assistant",
  status: string,
  previousMessageId?: string,
): Message =>
  ({
    role,
    status,
    previous_message_id: previousMessageId,
  }) as unknown as Message;

interface Snapshot {
  currentChatId: string | null;
  messages: Record<string, Message>;
  messageOrder: string[];
}

const controllerFor = (snapshot: Snapshot) =>
  snapshot as unknown as AddinChatController;

const empty: Snapshot = {
  currentChatId: null,
  messages: {},
  messageOrder: [],
};
const streaming: Snapshot = {
  currentChatId: "chat-1",
  messages: {
    u1: message("user", "complete"),
    a1: message("assistant", "sending", "u1"),
  },
  messageOrder: ["u1", "a1"],
};
const switchedAway: Snapshot = { ...empty, currentChatId: "chat-0" };
const complete: Snapshot = {
  currentChatId: "chat-1",
  messages: {
    u1: message("user", "complete"),
    a1: message("assistant", "complete", "u1"),
  },
  messageOrder: ["u1", "a1"],
};

describe("useWordDocumentCaptures", () => {
  it("promotes the staged capture onto the message that just completed", () => {
    const { result, rerender } = renderHook(
      (snapshot: Snapshot) => useWordDocumentCaptures(controllerFor(snapshot)),
      { initialProps: empty },
    );

    act(() => result.current.stagePendingCapture(capture("doc-a")));
    rerender(streaming);
    expect(result.current.capturesByAssistantMessageId.size).toBe(0);

    rerender(complete);
    expect(result.current.capturesByAssistantMessageId.get("a1")).toEqual(
      capture("doc-a"),
    );
  });

  it("promotes nothing when no capture was staged", () => {
    const { result, rerender } = renderHook(
      (snapshot: Snapshot) => useWordDocumentCaptures(controllerFor(snapshot)),
      { initialProps: empty },
    );

    rerender(streaming);
    rerender(complete);

    expect(result.current.capturesByAssistantMessageId.size).toBe(0);
  });

  it("clears the pending capture when a send carries no document identity", () => {
    const { result, rerender } = renderHook(
      (snapshot: Snapshot) => useWordDocumentCaptures(controllerFor(snapshot)),
      { initialProps: empty },
    );

    act(() => result.current.stagePendingCapture(capture("doc-a")));
    // A chip-off send: nothing must be promoted onto its reply.
    act(() => result.current.hostCallbacks.beforeSend?.(null));
    rerender(streaming);
    rerender(complete);

    expect(result.current.capturesByAssistantMessageId.size).toBe(0);
  });

  it("keeps the capture when a new chat receives its id on first send", () => {
    const { result, rerender } = renderHook(
      (snapshot: Snapshot) => useWordDocumentCaptures(controllerFor(snapshot)),
      { initialProps: empty },
    );

    act(() => result.current.stagePendingCapture(capture("doc-a")));
    // null -> "chat-1" is the same conversation continuing, not a switch.
    rerender(streaming);
    rerender(complete);

    expect(result.current.capturesByAssistantMessageId.get("a1")).toEqual(
      capture("doc-a"),
    );
  });

  it("discards a pending capture when the chat genuinely switches", () => {
    const { result, rerender } = renderHook(
      (snapshot: Snapshot) => useWordDocumentCaptures(controllerFor(snapshot)),
      { initialProps: switchedAway },
    );

    act(() => result.current.stagePendingCapture(capture("doc-a")));
    rerender(streaming);
    rerender(complete);

    expect(result.current.capturesByAssistantMessageId.size).toBe(0);
  });

  it("restores the right stamp on edit and on regenerate", () => {
    const { result, rerender } = renderHook(
      (snapshot: Snapshot) => useWordDocumentCaptures(controllerFor(snapshot)),
      { initialProps: empty },
    );

    act(() => result.current.stagePendingCapture(capture("doc-a")));
    rerender(streaming);
    rerender(complete);

    // An edit replays the ORIGINAL document, so the stamp comes from the
    // assistant message that answered the edited user message.
    act(() => result.current.hostCallbacks.beforeEdit?.("u1"));
    const afterEdit: Snapshot = {
      currentChatId: "chat-1",
      messages: {
        u1: message("user", "complete"),
        a2: message("assistant", "sending", "u1"),
      },
      messageOrder: ["u1", "a2"],
    };
    rerender(afterEdit);
    rerender({
      ...afterEdit,
      messages: {
        u1: message("user", "complete"),
        a2: message("assistant", "complete", "u1"),
      },
    });
    expect(result.current.capturesByAssistantMessageId.get("a2")).toEqual(
      capture("doc-a"),
    );

    act(() => result.current.hostCallbacks.beforeRegenerate?.("a2"));
    const afterRegenerate: Snapshot = {
      currentChatId: "chat-1",
      messages: {
        u1: message("user", "complete"),
        a3: message("assistant", "sending", "u1"),
      },
      messageOrder: ["u1", "a3"],
    };
    rerender(afterRegenerate);
    rerender({
      ...afterRegenerate,
      messages: {
        u1: message("user", "complete"),
        a3: message("assistant", "complete", "u1"),
      },
    });
    expect(result.current.capturesByAssistantMessageId.get("a3")).toEqual(
      capture("doc-a"),
    );
  });

  it("stamps nothing on an edit this session no longer knows", () => {
    const { result, rerender } = renderHook(
      (snapshot: Snapshot) => useWordDocumentCaptures(controllerFor(snapshot)),
      { initialProps: empty },
    );

    // No capture was ever promoted: an in-memory map is empty after a reload,
    // and ERMAIN-822 must then fail closed rather than write blind.
    act(() => result.current.hostCallbacks.beforeEdit?.("u1"));
    rerender(streaming);
    rerender(complete);

    expect(result.current.capturesByAssistantMessageId.size).toBe(0);
  });
});
