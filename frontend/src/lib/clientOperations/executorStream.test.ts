import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { FrontendRequestError } from "@/utils/errorReport";
import { createSSEConnection } from "@/utils/sse/sseClient";

import {
  EXECUTOR_STREAM_URL,
  executorStreamHeaders,
  openExecutorStream,
} from "./executorStream";
import { registerOperationExecutor } from "./registration";

import type {
  CallLineage,
  ExecutorBinding,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SSEOptions } from "@/utils/sse/sseClient";

vi.mock("@/utils/sse/sseClient", () => ({ createSSEConnection: vi.fn() }));

const binding: ExecutorBinding = {
  device_id: "pane-device-000000",
  realm: "office-addin",
  host_context: { kind: "outlook_mailbox", identity: "a".repeat(64) },
};
const headers = {
  "X-Erato-Executor": JSON.stringify(binding),
  "X-Erato-Client-Tools": "fetch_availability",
};
const run = vi.fn(async () => ({ ok: true as const, result: { busy: [] } }));

afterEach(() => {
  resetClientToolRegistryForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("executorStreamHeaders", () => {
  it("needs a binding and lists grant-capable tools apart", () => {
    registerClientToolExecutor("fetch_availability", run);
    expect(executorStreamHeaders()).toBeUndefined();
    const unregister = registerOperationExecutor(
      "fetch_availability",
      () => binding,
    );
    registerClientToolExecutor("read_document_blocks", run, () => true, {
      acceptsGrantCalls: true,
    });
    try {
      expect(executorStreamHeaders()).toEqual({
        "X-Erato-Executor": JSON.stringify(binding),
        "X-Erato-Client-Tools": "fetch_availability,read_document_blocks",
        "X-Erato-Child-Client-Tools": "read_document_blocks",
      });
    } finally {
      unregister();
    }
  });
});

describe("openExecutorStream", () => {
  it("runs a pushed call for its chat and answers with the stream's binding", async () => {
    let options: SSEOptions | undefined;
    const cleanup = vi.fn();
    vi.mocked(createSSEConnection).mockImplementation((_url, current) => {
      options = current;
      return cleanup;
    });
    const execute = vi.fn(async () => ({
      ok: true as const,
      result: { busy: [] },
    }));
    registerClientToolExecutor("fetch_availability", execute);
    // The submit binding of another host must not replace the stream's own.
    const unregister = registerOperationExecutor("fetch_availability", () => ({
      ...binding,
      device_id: "other-device-00000",
    }));
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ delivered: true, stored: false }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const lineage: CallLineage = {
      owner_chat_id: "chat-a",
      owner_message_id: "message-a",
      requesting_chat_id: "chat-b",
      requesting_message_id: "message-b",
      context_ref: "capture-1",
    };
    const onNudge = vi.fn();
    const controller = new AbortController();
    try {
      const done = openExecutorStream(headers, onNudge, controller.signal);
      expect(createSSEConnection).toHaveBeenCalledWith(
        EXECUTOR_STREAM_URL,
        expect.objectContaining({
          method: "GET",
          headers: { ...headers, Accept: "text/event-stream" },
        }),
      );
      options?.onMessage?.({
        type: "client_tool_call",
        data: JSON.stringify({
          message_type: "client_tool_call",
          chat_id: "chat-b",
          message_id: "message-b",
          tool_call_id: "call-b",
          tool_name: "fetch_availability",
          input: { lookahead_days: 7 },
          lineage,
        }),
      });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      expect(execute).toHaveBeenCalledWith(
        { lookahead_days: 7 },
        expect.objectContaining({
          chatId: "chat-b",
          messageId: "message-b",
          toolCallId: "call-b",
          lineage,
        }),
      );
      const init = fetch.mock.calls[0]?.[1];
      expect(
        (init?.headers as Record<string, string>)["X-Erato-Executor"],
      ).toBe(JSON.stringify(binding));
      expect(JSON.parse(init?.body as string)).toMatchObject({
        chat_id: "chat-b",
        message_id: "message-b",
        tool_call_id: "call-b",
      });

      options?.onMessage?.({
        type: "client_operation_available",
        data: JSON.stringify({
          message_type: "client_operation_available",
          attempt_id: "attempt",
        }),
      });
      expect(onNudge).toHaveBeenCalledOnce();

      controller.abort();
      await done;
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });

  it("reconnects with backoff and stops when the server has streams disabled", async () => {
    vi.useFakeTimers();
    const connections: SSEOptions[] = [];
    vi.mocked(createSSEConnection).mockImplementation((_url, options) => {
      connections.push(options ?? {});
      return vi.fn();
    });
    const done = openExecutorStream(
      headers,
      vi.fn(),
      new AbortController().signal,
    );
    connections[0]?.onClose?.();
    await vi.advanceTimersByTimeAsync(999);
    expect(connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(2);
    connections[1]?.onError?.(new Error("network"));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(connections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(3);
    // A connection that opened resets the backoff.
    connections[2]?.onOpen?.();
    connections[2]?.onClose?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connections).toHaveLength(4);
    connections[3]?.onError?.(
      new FrontendRequestError(
        "SSE request failed: Not found",
        { method: "GET", url: EXECUTOR_STREAM_URL },
        { status: 404, statusText: "Not Found" },
      ),
    );
    await done;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connections).toHaveLength(4);
  });
});
