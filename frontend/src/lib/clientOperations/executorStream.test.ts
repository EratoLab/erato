import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { FrontendRequestError } from "@/utils/errorReport";
import { createSSEConnection } from "@/utils/sse/sseClient";

import {
  EXECUTOR_STREAM_URL,
  executorStreamHeaderSets,
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

describe("executorStreamHeaderSets", () => {
  const desktop: ExecutorBinding = {
    device_id: "pane-device-000000",
    realm: "desktop-sidecar",
    host_context: { kind: "desktop_sidecar", identity: "local" },
  };
  const sidecarTools = ["get_sidecar_document", "search_sidecar_index"];

  it("keeps the primary set as before and gives an additional binding its own shared set", () => {
    let desktopReady = true;
    const cleanups = [
      registerOperationExecutor("fetch_availability", () => binding, {
        yields: true,
      }),
    ];
    registerClientToolExecutor("fetch_availability", run);
    sidecarTools.forEach((name) =>
      registerClientToolExecutor(name, run, () => desktopReady, {
        acceptsGrantCalls: true,
      }),
    );
    // What the pane opened before additional executors existed.
    const before = executorStreamHeaders();
    sidecarTools.forEach((name) =>
      cleanups.push(
        registerOperationExecutor(
          name,
          () => (desktopReady ? desktop : undefined),
          { additional: true },
        ),
      ),
    );
    try {
      const sets = executorStreamHeaderSets();
      expect(sets).toEqual([
        { headers: before, shared: false },
        {
          headers: {
            "X-Erato-Executor": JSON.stringify(desktop),
            "X-Erato-Client-Tools": sidecarTools.join(","),
            "X-Erato-Child-Client-Tools": sidecarTools.join(","),
          },
          shared: true,
        },
      ]);
      expect(before).toEqual({
        "X-Erato-Executor": JSON.stringify(binding),
        "X-Erato-Client-Tools": ["fetch_availability", ...sidecarTools].join(
          ",",
        ),
        "X-Erato-Child-Client-Tools": sidecarTools.join(","),
      });
      expect(sets[0]?.headers).not.toHaveProperty(
        "X-Erato-Additional-Executors",
      );
      desktopReady = false;
      expect(executorStreamHeaderSets()).toEqual([
        {
          headers: {
            "X-Erato-Executor": JSON.stringify(binding),
            "X-Erato-Client-Tools": "fetch_availability",
          },
          shared: false,
        },
      ]);
    } finally {
      cleanups.forEach((cleanup) => cleanup());
    }
  });

  it("serves an additional binding without a primary one", () => {
    registerClientToolExecutor("search_sidecar_index", run, () => true, {
      acceptsGrantCalls: true,
    });
    const unregister = registerOperationExecutor(
      "search_sidecar_index",
      () => desktop,
      { additional: true },
    );
    try {
      expect(executorStreamHeaders()).toBeUndefined();
      expect(executorStreamHeaderSets()).toEqual([
        {
          headers: {
            "X-Erato-Executor": JSON.stringify(desktop),
            "X-Erato-Client-Tools": "search_sidecar_index",
            "X-Erato-Child-Client-Tools": "search_sidecar_index",
          },
          shared: true,
        },
      ]);
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
    registerClientToolExecutor("fetch_availability", execute, undefined, {
      acceptsGrantCalls: true,
    });
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
    const onCall = vi.fn<(call: Promise<unknown>) => void>();
    const controller = new AbortController();
    try {
      const done = openExecutorStream(
        headers,
        onNudge,
        controller.signal,
        onCall,
      );
      expect(createSSEConnection).toHaveBeenCalledWith(
        EXECUTOR_STREAM_URL,
        expect.objectContaining({
          method: "GET",
          headers: {
            ...headers,
            "X-Erato-Executor-Instance": expect.any(String),
            Accept: "text/event-stream",
          },
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
      // The call is reported while it runs and settles once its result is posted.
      expect(onCall).toHaveBeenCalledOnce();
      await onCall.mock.calls[0]?.[0];
      expect(fetch).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith(
        { lookahead_days: 7 },
        expect.objectContaining({
          chatId: "chat-b",
          messageId: "message-b",
          toolCallId: "call-b",
          hostGrant: {
            ownerChatId: "chat-a",
            ownerMessageId: "message-a",
            requestingChatId: "chat-b",
            requestingMessageId: "message-b",
            contextRef: "capture-1",
          },
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
      expect(onCall).toHaveBeenCalledOnce();

      controller.abort();
      await done;
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });

  it("closes a pushed call when the server stops waiting, by the time left on delivery", async () => {
    vi.useFakeTimers();
    let options: SSEOptions | undefined;
    vi.mocked(createSSEConnection).mockImplementation((_url, current) => {
      options = current;
      return vi.fn();
    });
    const signals: AbortSignal[] = [];
    registerClientToolExecutor(
      "fetch_availability",
      (_input, context) =>
        new Promise((resolve) => {
          if (context?.signal) signals.push(context.signal);
          context?.signal?.addEventListener("abort", () =>
            resolve({ ok: false, error: "Stopped" }),
          );
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 409 })),
    );
    const controller = new AbortController();
    const done = openExecutorStream(headers, vi.fn(), controller.signal);
    options?.onMessage?.({
      type: "client_tool_call",
      data: JSON.stringify({
        message_type: "client_tool_call",
        chat_id: "chat-b",
        message_id: "message-b",
        tool_call_id: "call-deadline",
        tool_name: "fetch_availability",
        input: {},
        expires_at: "2000-01-01T00:00:00Z",
        timeout_ms: 30_000,
      }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    controller.abort();
    await done;
  });

  it("reconnects as its pane with backoff and stops when the server has streams disabled", async () => {
    vi.useFakeTimers();
    const connections: SSEOptions[] = [];
    const cleanups: (() => void)[] = [];
    vi.mocked(createSSEConnection).mockImplementation((_url, options) => {
      connections.push(options ?? {});
      const cleanup = vi.fn();
      cleanups.push(cleanup);
      return cleanup;
    });
    const done = openExecutorStream(
      headers,
      vi.fn(),
      new AbortController().signal,
    );
    connections[0]?.onClose?.();
    expect(cleanups[0]).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(2);
    connections[1]?.onError?.(new Error("network"));
    expect(cleanups[1]).toHaveBeenCalledOnce();
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
    const instances = new Set(
      connections.map(
        (options) => options.headers?.["X-Erato-Executor-Instance"],
      ),
    );
    expect(instances.size).toBe(1);
    const [instance] = [...instances];
    expect(instance).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const controller = new AbortController();
    const other = openExecutorStream(headers, vi.fn(), controller.signal);
    expect(connections[4]?.headers?.["X-Erato-Executor-Instance"]).toBe(
      instance,
    );
    controller.abort();
    await other;
  });
});
