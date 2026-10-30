import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FrontendRequestError } from "@/utils/errorReport";

import { useConfirmationRegistryStore } from "../store/confirmationRegistryStore";
import { useGenerationStatusStore } from "../store/generationStatusStore";
import { getStreamKey, useMessagingStore } from "../store/messagingStore";
import {
  SETTLED_STOP_GRACE_MS,
  resetSettledStopAsksForTest,
  settledWaitingStopOf,
  useResumeSettledWaitingStop,
} from "../useResumeSettledWaitingStop";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const slot = (id: string, status: string): ContentPart =>
  ({
    content_type: "tool_use",
    tool_call_id: id,
    tool_name: "delegate_task",
    input: {},
    status,
  }) as unknown as ContentPart;

const item = (id: string, waiting: boolean) => ({
  approval_id: id,
  tool_call_id: id,
  tool_name: "delegate_task",
  input: { task: id },
  child: {
    child_chat_id: `child-${id}`,
    child_message_id: `message-${id}`,
    child_tool_call_id: `call-${id}`,
    tool_name: "fetch_availability",
    mcp_server_id: "outlook",
    input: {},
    annotations: {},
    preset: "",
    requested_at: "2026-10-29T10:00:00Z",
    ...(waiting
      ? {
          waiting_for: {
            host_context: "outlook_mailbox",
            attempt_id: "attempt",
          },
        }
      : {}),
  },
});

const stop = (items: ReturnType<typeof item>[]): ContentPart =>
  ({
    content_type: "tool_approval_request",
    tool_call_id: items[0]?.tool_call_id ?? "call",
    tool_name: "delegate_task",
    mcp_server_id: "",
    input: {},
    annotations: {},
    preset: "",
    allow_always: false,
    requested_at: "2026-10-29T10:00:00Z",
    kind: "delegated_task",
    approvals: items,
  }) as unknown as ContentPart;

const settled = (): ContentPart[] => [
  slot("wait", "success"),
  stop([item("wait", true)]),
];

describe("settledWaitingStopOf", () => {
  it("finds a last stop whose waiting tasks all settled", () => {
    expect(settledWaitingStopOf(settled())).toEqual({
      index: 1,
      toolCallId: "wait",
    });
  });

  it("finds nothing while a waiting task's slot is in progress", () => {
    expect(
      settledWaitingStopOf([
        slot("wait", "in_progress"),
        stop([item("wait", true)]),
      ]),
    ).toBeNull();
  });

  it("finds nothing while something is left to decide", () => {
    expect(
      settledWaitingStopOf([
        slot("wait", "success"),
        slot("ask", "in_progress"),
        stop([item("wait", true), item("ask", false)]),
      ]),
    ).toBeNull();
  });

  it("finds nothing on a stop that never waited or that was answered", () => {
    expect(
      settledWaitingStopOf([
        stop([item("ask", false)]),
        {
          content_type: "tool_approval",
          tool_call_id: "ask",
          approval_id: "ask",
        } as unknown as ContentPart,
      ]),
    ).toBeNull();
    expect(
      settledWaitingStopOf([
        ...settled(),
        { content_type: "text", text: "Done." },
      ]),
    ).toBeNull();
  });
});

const message = (content: ContentPart[]): Message =>
  ({
    id: "message-1",
    role: "assistant",
    sender: "assistant",
    authorId: "assistant_id",
    content,
    createdAt: "2026-10-29T10:00:00Z",
    status: "complete",
  }) as Message;

const refusal = (status: number, body: string) =>
  new FrontendRequestError(
    `SSE request failed: ${body}`,
    { method: "POST", url: "/api/v1beta/me/messages/continuestream" },
    { status, statusText: "Conflict", body },
  );

describe("useResumeSettledWaitingStop", () => {
  const render = (content: ContentPart[], isBusy = false) => {
    const resume = vi.fn<
      (messageId: string, toolCallId: string) => Promise<void>
    >(async () => undefined);
    const attach = vi.fn();
    const refetch = vi.fn();
    const hook = renderHook(
      ({ rows }: { rows: ContentPart[] }) =>
        useResumeSettledWaitingStop({
          chatId: "chat-1",
          messages: { "message-1": message(rows) },
          messageOrder: ["message-1"],
          isBusy,
          resume,
          attach,
          refetch,
        }),
      { initialProps: { rows: content } },
    );
    return { ...hook, resume, attach, refetch };
  };
  const parked = () =>
    act(() => {
      useGenerationStatusStore
        .getState()
        .seedActionRequired("chat-1", "2026-10-29T10:00:00Z");
    });

  beforeEach(() => {
    vi.useFakeTimers();
    resetSettledStopAsksForTest();
  });
  afterEach(() => {
    vi.useRealTimers();
    useGenerationStatusStore.getState().reset();
    useMessagingStore.setState({ sseAbortCallbacksByKey: {} });
    useConfirmationRegistryStore.setState({
      pendingIdsByChatId: {},
      waitingOnlyIds: {},
    });
  });
  const queueHeld = () => {
    const { pendingIdsByChatId, waitingOnlyIds } =
      useConfirmationRegistryStore.getState();
    const ids = pendingIdsByChatId["chat-1"] ?? [];
    return ids.length > 0 && ids.every((id) => waitingOnlyIds[id] === true);
  };

  it("holds the queue as waiting only until the turn answers", () => {
    parked();
    const { rerender } = render(settled());
    expect(queueHeld()).toBe(true);
    rerender({
      rows: [...settled(), { content_type: "text", text: "Done." }],
    });
    expect(queueHeld()).toBe(false);
  });

  it("holds the queue only while the chat is parked", () => {
    const { rerender } = render(settled());
    expect(queueHeld()).toBe(false);
    parked();
    rerender({ rows: settled() });
    expect(queueHeld()).toBe(true);
    act(() => {
      useGenerationStatusStore.getState().reset();
    });
    expect(queueHeld()).toBe(false);
  });

  it("releases the queue when the resume fails for another reason", async () => {
    parked();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { resume } = render(settled());
    resume.mockRejectedValueOnce(new Error("offline"));
    expect(queueHeld()).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLED_STOP_GRACE_MS);
    });
    expect(queueHeld()).toBe(false);
    warn.mockRestore();
  });

  it("resumes the turn once, after the grace, while the chat is parked", async () => {
    parked();
    const { resume, rerender } = render(settled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLED_STOP_GRACE_MS - 1);
    });
    expect(resume).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(resume).toHaveBeenCalledExactlyOnceWith("message-1", "wait");
    rerender({ rows: [...settled()] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLED_STOP_GRACE_MS * 2);
    });
    expect(resume).toHaveBeenCalledOnce();
  });

  it("does nothing unless the chat is parked", async () => {
    const { resume } = render(settled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLED_STOP_GRACE_MS * 2);
    });
    expect(resume).not.toHaveBeenCalled();
  });

  it("does nothing while this client streams or holds a socket for the chat", async () => {
    parked();
    const busy = render(settled(), true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLED_STOP_GRACE_MS * 2);
    });
    expect(busy.resume).not.toHaveBeenCalled();
    busy.unmount();

    act(() => {
      useMessagingStore.setState({
        sseAbortCallbacksByKey: { [getStreamKey("chat-1")]: vi.fn() },
      });
    });
    const socket = render(settled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLED_STOP_GRACE_MS * 2);
    });
    expect(socket.resume).not.toHaveBeenCalled();
  });

  it("does nothing while a task still waits", async () => {
    parked();
    const { resume } = render([
      slot("wait", "in_progress"),
      stop([item("wait", true)]),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLED_STOP_GRACE_MS * 2);
    });
    expect(resume).not.toHaveBeenCalled();
  });

  it("attaches to the turn the server resumed itself", async () => {
    parked();
    const { resume, attach, refetch } = render(settled());
    resume.mockRejectedValueOnce(
      refusal(409, JSON.stringify({ code: "generation_running" })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLED_STOP_GRACE_MS);
    });
    expect(attach).toHaveBeenCalledWith("chat-1");
    expect(refetch).not.toHaveBeenCalled();
  });

  it.each(["children_waiting", "already_continued"])(
    "reads the row again on a 409 %s",
    async (code) => {
      parked();
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const { resume, attach, refetch } = render(settled());
      resume.mockRejectedValueOnce(refusal(409, JSON.stringify({ code })));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SETTLED_STOP_GRACE_MS);
      });
      expect(refetch).toHaveBeenCalledOnce();
      expect(attach).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    },
  );
});
