import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FrontendRequestError } from "@/utils/errorReport";
import { createSSEConnection } from "@/utils/sse/sseClient";

vi.mock("@/utils/sse/sseClient", () => ({
  createSSEConnection: vi.fn(() => vi.fn()),
}));

import {
  resetReactAttemptsForTest,
  useReactToTaskResult,
} from "../useReactToTaskResult";

import type { TaskResultInput } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const mockCreateSSEConnection = vi.mocked(createSSEConnection);

const delivery = (
  overrides: Partial<TaskResultInput> = {},
): TaskResultInput => ({
  child_chat_id: "child-1",
  delivery_id: "delivery-1",
  scheduling: "when_idle",
  sequence: 0,
  status: "completed",
  ...overrides,
});

const row = (
  id: string,
  role: Message["role"],
  createdAt: string,
  extra: Partial<Message> = {},
): Message =>
  ({
    id,
    role,
    sender: role,
    authorId: role === "user" ? "user_id" : "assistant_id",
    content: [],
    createdAt,
    status: "complete",
    ...extra,
  }) as Message;

const thread = (rows: Message[]) => ({
  messages: Object.fromEntries(rows.map((message) => [message.id, message])),
  messageOrder: rows.map((message) => message.id),
});

/**
 * Stands in for `useChatMessaging`'s guard: it runs the caller's `open` and
 * reports success, so the tests see exactly the socket the trigger asked for.
 */
const passThroughAttach = (
  options: Parameters<
    Parameters<typeof useReactToTaskResult>[0]["attachToServerGeneration"]
  >[0],
) => options.open?.(options.chatId) ?? false;

type TriggerOverrides = Partial<Parameters<typeof useReactToTaskResult>[0]>;

const renderTrigger = (overrides: TriggerOverrides = {}) => {
  const processStreamEvent = vi.fn();
  const onGenerationRunningRefusal = vi.fn();
  const attachToServerGeneration = vi.fn(passThroughAttach);
  const result = renderHook((props: TriggerOverrides) =>
    useReactToTaskResult({
      chatId: "chat-1",
      platform: "web",
      ...thread([
        row("m1", "user", "2026-09-19T12:00:00.000Z"),
        row("m2", "user", "2026-09-19T12:00:01.000Z", {
          task_result: delivery(),
        }),
      ]),
      processStreamEvent,
      attachToServerGeneration,
      setSSECleanupForKey: vi.fn(),
      setSSEAbortCallback: vi.fn(),
      onGenerationRunningRefusal,
      ...overrides,
      ...props,
    }),
  );
  return {
    ...result,
    processStreamEvent,
    onGenerationRunningRefusal,
    attachToServerGeneration,
  };
};

/** The shape `createSSEConnection` throws for a non-ok response. */
const refusal = (status: number, body: string) =>
  new FrontendRequestError(
    `SSE request failed: ${body}`,
    { method: "POST", url: "/api/v1beta/me/chats/chat-1/react" },
    { status, statusText: "Conflict", body },
  );

const lastOptions = () => {
  const call = mockCreateSSEConnection.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![1] ?? {};
};

describe("useReactToTaskResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReactAttemptsForTest();
    mockCreateSSEConnection.mockImplementation(() => vi.fn());
  });

  it("asks for the reaction when a delivered task result is the thread tip", () => {
    renderTrigger();

    expect(mockCreateSSEConnection).toHaveBeenCalledTimes(1);
    expect(mockCreateSSEConnection).toHaveBeenCalledWith(
      "/api/v1beta/me/chats/chat-1/react",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ task_result_message_id: "m2" }),
      }),
    );
  });

  it("does not ask when the conversation has moved past the task result", () => {
    // Precondition 11 of `task_result_still_reactable` compares the named row
    // against the active-thread tip, so an "any row carries task_result"
    // predicate earns `tip_moved` on every chat that ever answered a delivery.
    renderTrigger(
      thread([
        row("m1", "user", "2026-09-19T12:00:00.000Z", {
          task_result: delivery(),
        }),
        row("m2", "assistant", "2026-09-19T12:00:01.000Z"),
      ]),
    );

    expect(mockCreateSSEConnection).not.toHaveBeenCalled();
  });

  it("goes quiet as soon as the reaction's own row lands", () => {
    // The same property from the other side: the predicate is what stops the
    // trigger re-entering while its own stream is producing rows.
    const { rerender } = renderTrigger();
    expect(mockCreateSSEConnection).toHaveBeenCalledTimes(1);
    mockCreateSSEConnection.mockClear();
    resetReactAttemptsForTest();

    rerender(
      thread([
        row("m1", "user", "2026-09-19T12:00:00.000Z"),
        row("m2", "user", "2026-09-19T12:00:01.000Z", {
          task_result: delivery(),
        }),
        row("m3", "assistant", "2026-09-19T12:00:02.000Z"),
      ]),
    );

    expect(mockCreateSSEConnection).not.toHaveBeenCalled();
  });

  it("leaves a silent result alone", () => {
    renderTrigger(
      thread([
        row("m2", "user", "2026-09-19T12:00:01.000Z", {
          task_result: delivery({ scheduling: "silent" }),
        }),
      ]),
    );

    expect(mockCreateSSEConnection).not.toHaveBeenCalled();
  });

  it("takes the guard rather than opening a socket of its own", () => {
    const attachToServerGeneration = vi.fn(() => false);
    renderTrigger({ attachToServerGeneration });

    expect(attachToServerGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "chat-1" }),
    );
    expect(mockCreateSSEConnection).not.toHaveBeenCalled();
  });

  it("asks once per row per session, across remounts", () => {
    const first = renderTrigger();
    first.rerender({});
    first.unmount();
    renderTrigger();

    expect(mockCreateSSEConnection).toHaveBeenCalledTimes(1);
  });

  it("feeds the stream to processStreamEvent instead of discarding it", () => {
    const { processStreamEvent } = renderTrigger();

    // `/react` calls `run_generation_after_user_message` directly, so the
    // stream opens on an assistant delta with no `user_message_saved` and no
    // `chat_created` ahead of it.
    const event = {
      data: JSON.stringify({
        message_type: "assistant_message_started",
        message_id: "assistant-1",
      }),
      type: "message",
    };
    lastOptions().onMessage?.(event);

    expect(processStreamEvent).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ current: "chat-1" }),
    );
  });

  describe("refusals", () => {
    it("discriminates the two 409s on `code`, not on the status", () => {
      const { onGenerationRunningRefusal } = renderTrigger();
      const onError = lastOptions().onError;

      onError?.(
        refusal(
          409,
          JSON.stringify({
            code: "nothing_to_react",
            reason: "already_reacted",
            chat_id: "chat-1",
            task_result_message_id: "m2",
          }),
        ),
      );
      expect(onGenerationRunningRefusal).not.toHaveBeenCalled();

      onError?.(
        refusal(
          409,
          JSON.stringify({ code: "generation_running", chat_id: "chat-1" }),
        ),
      );
      expect(onGenerationRunningRefusal).toHaveBeenCalledWith("chat-1");
    });

    it("keeps `tip_moved` distinct from `already_reacted`", () => {
      // The backend orders its checks so a client can tell "suppress the
      // affordance" from "offer a re-anchor". 779-B renders neither, so the
      // distinction lives in the log line and this is what pins it; when the
      // re-anchor affordance lands it takes over as the assertion.
      const logs: unknown[][] = [];
      window.localStorage.setItem("DEBUG_FORCE", "true");
      window.localStorage.setItem("DEBUG", "true");
      const spy = vi
        .spyOn(console, "log")
        .mockImplementation((...args: unknown[]) => {
          logs.push(args);
        });
      try {
        renderTrigger();
        const onError = lastOptions().onError;
        onError?.(
          refusal(
            409,
            JSON.stringify({ code: "nothing_to_react", reason: "tip_moved" }),
          ),
        );
        expect(logs.flat().join(" ")).toContain("moved past");

        logs.length = 0;
        onError?.(
          refusal(
            409,
            JSON.stringify({
              code: "nothing_to_react",
              reason: "already_reacted",
            }),
          ),
        );
        expect(logs.flat().join(" ")).toContain("already been answered");
      } finally {
        spy.mockRestore();
        window.localStorage.removeItem("DEBUG_FORCE");
        window.localStorage.removeItem("DEBUG");
      }
    });

    it("says nothing on a 404", () => {
      // The route 404s identically when async delivery is off, when the chat
      // is unknown, and when the row is not ours.
      const { onGenerationRunningRefusal } = renderTrigger();
      expect(() =>
        lastOptions().onError?.(refusal(404, "Not found")),
      ).not.toThrow();
      expect(onGenerationRunningRefusal).not.toHaveBeenCalled();
    });

    it("survives a plain-text 409 from an archived chat", () => {
      const { onGenerationRunningRefusal } = renderTrigger();
      expect(() =>
        lastOptions().onError?.(refusal(409, "Chat is archived")),
      ).not.toThrow();
      expect(onGenerationRunningRefusal).not.toHaveBeenCalled();
    });
  });
});
