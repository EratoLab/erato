import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useComposeSession } from "../useComposeSession";

describe("useComposeSession", () => {
  it("mints a stable session id for a given chatId across rerenders", () => {
    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: string | null }) => useComposeSession({ chatId }),
      { initialProps: { chatId: "chat-a" } },
    );

    const initialSessionId = result.current.sessionId;
    expect(initialSessionId).toBeTruthy();

    rerender({ chatId: "chat-a" });
    expect(result.current.sessionId).toBe(initialSessionId);
  });

  it("keeps the same session id when chatId transitions from null to a real id", () => {
    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: string | null }) => useComposeSession({ chatId }),
      { initialProps: { chatId: null as string | null } },
    );

    const sentinelSessionId = result.current.sessionId;
    expect(sentinelSessionId).toBeTruthy();

    rerender({ chatId: "chat-new-1" });

    // The session that was created while the chat had no id should follow
    // the chat into its real identity. This is the load-bearing property
    // for mid-dictation chat_created transitions.
    expect(result.current.sessionId).toBe(sentinelSessionId);
  });

  it("assigns a fresh session id when switching to a previously-unseen chat", () => {
    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: string | null }) => useComposeSession({ chatId }),
      { initialProps: { chatId: "chat-a" } },
    );

    const sessionA = result.current.sessionId;
    rerender({ chatId: "chat-b" });
    const sessionB = result.current.sessionId;

    expect(sessionB).toBeTruthy();
    expect(sessionB).not.toBe(sessionA);
  });

  it("restores the same session id when returning to a previously-seen chat", () => {
    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: string | null }) => useComposeSession({ chatId }),
      { initialProps: { chatId: "chat-a" } },
    );

    const sessionA = result.current.sessionId;
    rerender({ chatId: "chat-b" });
    rerender({ chatId: "chat-a" });

    expect(result.current.sessionId).toBe(sessionA);
  });

  it("persists and retrieves drafts by session id", () => {
    const { result } = renderHook(() =>
      useComposeSession({ chatId: "chat-a" }),
    );

    const id = result.current.sessionId;
    result.current.saveDraft(id, {
      message: "hello",
      attachedFiles: [],
    });

    expect(result.current.getDraft(id)).toEqual({
      message: "hello",
      attachedFiles: [],
    });
  });

  it("returns an empty draft for unknown session ids", () => {
    const { result } = renderHook(() =>
      useComposeSession({ chatId: "chat-a" }),
    );

    expect(result.current.getDraft("never-saved")).toEqual({
      message: "",
      attachedFiles: [],
    });
  });

  it("exposes a getActiveSessionId getter that reflects the latest session id", () => {
    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: string | null }) => useComposeSession({ chatId }),
      { initialProps: { chatId: "chat-a" } },
    );

    const initialActive = result.current.getActiveSessionId();
    expect(initialActive).toBe(result.current.sessionId);

    rerender({ chatId: "chat-b" });
    expect(result.current.getActiveSessionId()).toBe(result.current.sessionId);
    expect(result.current.getActiveSessionId()).not.toBe(initialActive);
  });
});
