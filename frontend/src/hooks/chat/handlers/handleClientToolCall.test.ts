import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientOperationHandlerRegistry } from "@/lib/clientOperations/handlers";
import { registerOperationExecutor } from "@/lib/clientOperations/registration";
import { fakeWebLocks } from "@/test/webLocks";

import { handleClientToolCall } from "./handleClientToolCall";
import { handleToolCallUpdate } from "./handleToolCallUpdate";
import {
  abortClientToolCalls,
  hasClientToolCallBeenAnswered,
  isClientToolCallInFlight,
  registerClientToolExecutor,
  registerLocalOnlyClientTools,
  resetClientToolRegistryForTests,
  trackClientToolCallAbort,
} from "../clientToolExecutors";

import type { MessageSubmitStreamingResponseClientToolCall } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const deps = {
  chatId: "chat-1",
  getAuthHeaders: () => ({ Authorization: "Bearer tok" }),
  extraHeaders: { "X-Erato-Platform": "outlook" },
};

function makeEvent(
  overrides: Partial<MessageSubmitStreamingResponseClientToolCall> = {},
) {
  return {
    message_type: "client_tool_call",
    message_id: "msg-1",
    content_index: 0,
    tool_call_id: "call-1",
    tool_name: "fetch_availability",
    input: { window_start: "x" },
    ...overrides,
  } as MessageSubmitStreamingResponseClientToolCall & {
    message_type: "client_tool_call";
  };
}

function lastPostBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe("handleClientToolCall", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetClientToolRegistryForTests();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetClientToolRegistryForTests();
  });

  it("cancels pending local approval when the server times out the tool", () => {
    const signal = trackClientToolCallAbort("expired-call", "chat-1");
    const other = trackClientToolCallAbort("other-call", "chat-1");
    handleToolCallUpdate({
      message_type: "tool_call_update",
      message_id: "msg-1",
      content_index: 0,
      tool_call_id: "expired-call",
      tool_name: "get_sidecar_document",
      status: "error",
    });
    expect(signal.aborted).toBe(true);
    expect(other.aborted).toBe(false);
  });

  it("does not automatically report durable local operations or local-only dispositions", async () => {
    await handleClientToolCall(
      makeEvent({ tool_name: "local_collect_evidence" }),
      deps,
    );
    registerClientToolExecutor("fetch_availability", async () => ({
      ok: true,
      disposition: "local_only",
    }));
    await handleClientToolCall(
      makeEvent({ tool_call_id: "private-call" }),
      deps,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("suppresses a native exception even if strict mode activates during execution", async () => {
    let strict = false;
    registerLocalOnlyClientTools(["get_sidecar_document"], () => strict);
    registerClientToolExecutor("get_sidecar_document", async () => {
      strict = true;
      throw new Error("PRIVATE_SECRET metadata");
    });
    await handleClientToolCall(
      makeEvent({ tool_name: "get_sidecar_document" }),
      deps,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs the registered executor and POSTs its result", async () => {
    registerClientToolExecutor("fetch_availability", async (input) => {
      expect(input).toEqual({ window_start: "x" });
      return { ok: true, result: { slots: 3 } };
    });

    await handleClientToolCall(makeEvent(), deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1beta/me/messages/clienttoolresult");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
    expect(lastPostBody(fetchMock)).toEqual({
      chat_id: "chat-1",
      message_id: "msg-1",
      tool_call_id: "call-1",
      result: { slots: 3 },
    });
  });

  it("sends the tool's own executor binding only when one is registered", async () => {
    registerClientToolExecutor("fetch_availability", async () => ({
      ok: true,
      result: null,
    }));
    await handleClientToolCall(makeEvent(), deps);
    const unbound = fetchMock.mock.calls[0][1] as RequestInit;
    expect(unbound.headers).not.toHaveProperty("X-Erato-Executor");

    const binding = {
      device_id: "pane-device-000000",
      realm: "office-addin" as const,
      host_context: { kind: "outlook_mailbox", identity: "a".repeat(64) },
    };
    const unregister = [
      registerOperationExecutor("fetch_availability", () => binding, {
        yields: true,
      }),
      registerOperationExecutor("local_collect_evidence", () => ({
        device_id: "sidecar-device",
        realm: "desktop-sidecar",
      })),
    ];
    try {
      await handleClientToolCall(makeEvent({ tool_call_id: "call-2" }), deps);
      const bound = fetchMock.mock.calls[1][1] as RequestInit;
      expect(
        (bound.headers as Record<string, string>)["X-Erato-Executor"],
      ).toBe(JSON.stringify(binding));
    } finally {
      unregister.forEach((cleanup) => cleanup());
    }
  });

  describe("a delegated task's call", () => {
    const executor = {
      device_id: "pane-device-000000",
      realm: "office-addin" as const,
      host_context: { kind: "outlook_mailbox", identity: "a".repeat(64) },
    };
    const lineage = {
      owner_chat_id: "chat-0",
      owner_message_id: "msg-0",
      requesting_chat_id: "chat-1",
      requesting_message_id: "msg-1",
      context_ref: "capture-1",
    };

    it("passes the grant as hostGrant and answers with the executor stream's binding", async () => {
      const execute = vi.fn(async () => ({ ok: true as const, result: null }));
      registerClientToolExecutor("fetch_availability", execute, undefined, {
        acceptsGrantCalls: true,
      });
      const unregister = registerOperationExecutor(
        "fetch_availability",
        () => ({
          ...executor,
          device_id: "other-device-00000",
        }),
      );
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ delivered: true, stored: false }),
      });
      try {
        await handleClientToolCall(makeEvent(), { ...deps, executor, lineage });
        expect(execute).toHaveBeenCalledWith(
          { window_start: "x" },
          expect.objectContaining({
            chatId: "chat-1",
            hostGrant: {
              ownerChatId: "chat-0",
              ownerMessageId: "msg-0",
              requestingChatId: "chat-1",
              requestingMessageId: "msg-1",
              contextRef: "capture-1",
            },
          }),
        );
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(
          (init.headers as Record<string, string>)["X-Erato-Executor"],
        ).toBe(JSON.stringify(executor));
      } finally {
        unregister();
      }
    });

    it("leaves contextRef out when the grant carries no context version", async () => {
      const execute = vi.fn(async () => ({ ok: true as const, result: null }));
      registerClientToolExecutor("fetch_availability", execute, undefined, {
        acceptsGrantCalls: true,
      });
      const { context_ref: _unused, ...withoutRef } = lineage;
      await handleClientToolCall(makeEvent(), {
        ...deps,
        executor,
        lineage: withoutRef,
      });
      const context = (execute.mock.calls[0] as unknown[])[1] as {
        hostGrant: Record<string, string>;
      };
      expect(context.hostGrant).not.toHaveProperty("contextRef");
    });

    it("is refused without running a handler that did not opt in", async () => {
      const execute = vi.fn(async () => ({ ok: true as const, result: null }));
      registerClientToolExecutor("fetch_availability", execute);
      await handleClientToolCall(makeEvent(), { ...deps, executor, lineage });

      expect(execute).not.toHaveBeenCalled();
      expect(lastPostBody(fetchMock)).toEqual({
        chat_id: "chat-1",
        message_id: "msg-1",
        tool_call_id: "call-1",
        error:
          'The client tool "fetch_availability" does not take calls from delegated tasks',
      });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)["X-Erato-Executor"]).toBe(
        JSON.stringify(executor),
      );
    });
  });

  it("runs a call of the user's own turn without a grant, opted in or not", async () => {
    const execute = vi.fn(async () => ({ ok: true as const, result: 1 }));
    registerClientToolExecutor("fetch_availability", execute);
    await handleClientToolCall(makeEvent(), deps);

    expect(execute).toHaveBeenCalledTimes(1);
    const context = (execute.mock.calls[0] as unknown[])[1] as object;
    expect(context).not.toHaveProperty("hostGrant");
    expect(context).not.toHaveProperty("lineage");
    expect(lastPostBody(fetchMock)).toMatchObject({ result: 1 });
  });

  describe("with an operation binding", () => {
    const sweep = vi.fn<() => void>();
    let unregister: () => void;
    let unsubscribe: () => void;

    beforeEach(() => {
      unregister = registerOperationExecutor(
        "fetch_availability",
        () => ({
          device_id: "pane-device-000000",
          realm: "office-addin",
          host_context: { kind: "outlook_mailbox", identity: "a".repeat(64) },
        }),
        { yields: true },
      );
      sweep.mockClear();
      unsubscribe = clientOperationHandlerRegistry.subscribe(sweep);
      registerClientToolExecutor("fetch_availability", async () => ({
        ok: true,
        result: null,
      }));
    });

    afterEach(() => {
      unsubscribe();
      unregister();
    });

    it("stays in flight until its result POST settles, then sweeps for a stored call", async () => {
      let respond!: (response: {
        ok: boolean;
        status: number;
        json: () => Promise<unknown>;
      }) => void;
      fetchMock.mockReturnValueOnce(
        new Promise((resolve) => {
          respond = resolve;
        }),
      );
      const pending = handleClientToolCall(makeEvent(), deps);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(isClientToolCallInFlight("call-1")).toBe(true);
      expect(sweep).not.toHaveBeenCalled();

      respond({
        ok: true,
        status: 200,
        json: async () => ({ delivered: true, stored: true }),
      });
      await pending;
      expect(isClientToolCallInFlight("call-1")).toBe(false);
      expect(sweep).toHaveBeenCalledTimes(1);
    });

    it("requests no sweep when the live answer settled nothing stored", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ delivered: true, stored: false }),
      });
      await handleClientToolCall(makeEvent(), deps);
      expect(sweep).not.toHaveBeenCalled();
    });

    it("skips a call another pane of this browser already runs", async () => {
      const executor = vi.fn(async () => ({ ok: true as const, result: null }));
      registerClientToolExecutor("fetch_availability", executor);
      const restore = fakeWebLocks(new Set(["erato.client-call:msg-1:call-1"]));
      try {
        await handleClientToolCall(makeEvent(), deps);
      } finally {
        restore();
      }
      expect(executor).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps a conflicting call answered without requesting a sweep", async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 409 });
      await handleClientToolCall(makeEvent(), deps);
      expect(hasClientToolCallBeenAnswered("call-1")).toBe(true);
      expect(isClientToolCallInFlight("call-1")).toBe(false);

      fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
      await handleClientToolCall(makeEvent({ tool_call_id: "call-2" }), deps);
      expect(hasClientToolCallBeenAnswered("call-2")).toBe(false);
      expect(sweep).not.toHaveBeenCalled();
    });
  });

  it("requests no sweep for an unbound call and lets its conflict retry", async () => {
    const sweep = vi.fn<() => void>();
    const unsubscribe = clientOperationHandlerRegistry.subscribe(sweep);
    try {
      registerClientToolExecutor("fetch_availability", async () => ({
        ok: true,
        result: null,
      }));
      await handleClientToolCall(makeEvent(), deps);
      fetchMock.mockResolvedValueOnce({ ok: false, status: 409 });
      await handleClientToolCall(makeEvent({ tool_call_id: "call-2" }), deps);
      expect(hasClientToolCallBeenAnswered("call-2")).toBe(false);
      expect(sweep).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("delivers attachment file references through the ordinary result endpoint", async () => {
    registerClientToolExecutor("read_sidecar_conversation", async () => ({
      ok: true,
      result: { messages: [] },
      fileUploadIds: ["file-1"],
    }));
    await handleClientToolCall(
      makeEvent({ tool_name: "read_sidecar_conversation" }),
      deps,
    );
    expect(lastPostBody(fetchMock)).toMatchObject({
      result: { messages: [] },
      file_upload_ids: ["file-1"],
    });
  });

  it("POSTs an error when the executor returns a failure", async () => {
    registerClientToolExecutor("fetch_availability", async () => ({
      ok: false,
      error: "boom",
    }));

    await handleClientToolCall(makeEvent(), deps);

    expect(lastPostBody(fetchMock)).toMatchObject({ error: "boom" });
  });

  it("POSTs an error when the executor throws", async () => {
    registerClientToolExecutor("fetch_availability", async () => {
      throw new Error("kaboom");
    });

    await handleClientToolCall(makeEvent(), deps);

    expect(lastPostBody(fetchMock)).toMatchObject({ error: "kaboom" });
  });

  it("preserves parser diagnostics without resubmitting the draft", async () => {
    const issues = [
      {
        path: "/items/0/source",
        code: "unknown_reference",
        message: "Use a current source ID.",
      },
    ];
    registerClientToolExecutor("fetch_availability", async () => ({
      ok: false,
      error: "Draft validation failed",
      validationErrors: issues,
    }));
    await handleClientToolCall(makeEvent(), deps);
    expect(lastPostBody(fetchMock)).toEqual({
      chat_id: "chat-1",
      message_id: "msg-1",
      tool_call_id: "call-1",
      error: "Draft validation failed",
      validation_errors: issues,
    });
  });

  it("POSTs an error when no executor is registered", async () => {
    await handleClientToolCall(makeEvent(), deps);

    expect(lastPostBody(fetchMock).error).toContain("No client-tool executor");
  });

  it("preserves correction handles and terminal failures as rejections", async () => {
    registerClientToolExecutor("fetch_availability", async () => ({
      ok: false,
      error: "Repeated invalid proposal",
      validationErrors: [
        { path: "", code: "no-progress", message: "Unchanged proposal." },
      ],
      submissionFeedback: {
        draft: { id: "draft-1", revision: 2 },
        terminal: true,
      },
    }));
    await handleClientToolCall(makeEvent(), deps);
    expect(lastPostBody(fetchMock)).toMatchObject({
      submission_feedback: {
        draft: { id: "draft-1", revision: 2 },
        terminal: true,
      },
      validation_errors: [{ code: "no-progress" }],
    });
    expect(lastPostBody(fetchMock)).not.toHaveProperty("result");
  });

  it("execute-once: a replayed event does not re-run or re-POST the tool", async () => {
    const executor = vi.fn(async () => ({ ok: true as const, result: 1 }));
    registerClientToolExecutor("fetch_availability", executor);

    await handleClientToolCall(makeEvent(), deps);
    await handleClientToolCall(makeEvent(), deps); // replay, same tool_call_id

    expect(executor).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no-ops when the chat id is missing", async () => {
    await handleClientToolCall(makeEvent(), { ...deps, chatId: null });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("execute-once holds under a concurrent (unawaited) double-fire", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executor = vi.fn(async () => {
      await gate;
      return { ok: true as const, result: 1 };
    });
    registerClientToolExecutor("fetch_availability", executor);

    // Fire both before the first resolves; the pre-await guard must block the
    // second (this would fail if the mark moved after the await).
    const p1 = handleClientToolCall(makeEvent(), deps);
    const p2 = handleClientToolCall(makeEvent(), deps);
    release();
    await Promise.all([p1, p2]);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("a call pushed over the executor stream", () => {
    const executor = {
      device_id: "pane-device-000000",
      realm: "office-addin" as const,
      host_context: { kind: "outlook_mailbox", identity: "a".repeat(64) },
    };
    const execute = vi.fn(async () => ({ ok: true as const, result: 1 }));

    beforeEach(() => {
      vi.useFakeTimers();
      execute.mockClear();
      registerClientToolExecutor("fetch_availability", execute);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries its result POST after a network error or a 5xx", async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ delivered: true, stored: false }),
        });
      const done = handleClientToolCall(makeEvent(), { ...deps, executor });
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2_000);
      await done;
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(execute).toHaveBeenCalledOnce();
      expect(hasClientToolCallBeenAnswered("call-1")).toBe(true);
    });

    it("gives up on a 4xx at once, and on a 5xx after its retries", async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
      await handleClientToolCall(makeEvent(), { ...deps, executor });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockResolvedValue({ ok: false, status: 503 });
      const done = handleClientToolCall(makeEvent({ tool_call_id: "call-2" }), {
        ...deps,
        executor,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      await done;
      expect(fetchMock).toHaveBeenCalledTimes(1 + 5);
    });
  });

  it("un-marks on a failed POST so a later replay retries", async () => {
    const executor = vi.fn(async () => ({ ok: true as const, result: 1 }));
    registerClientToolExecutor("fetch_availability", executor);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });

    await handleClientToolCall(makeEvent(), deps);
    expect(executor).toHaveBeenCalledTimes(1);

    // The failed delivery un-marked the id, so the replay runs + POSTs again.
    await handleClientToolCall(makeEvent(), deps);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fires the context signal when the user aborts the turn's chat", async () => {
    let seenSignal: AbortSignal | undefined;
    registerClientToolExecutor(
      "fetch_availability",
      (_input, context) =>
        new Promise((resolve) => {
          seenSignal = context?.signal;
          context?.signal?.addEventListener("abort", () =>
            resolve({ ok: false, error: "stopped" }),
          );
        }),
    );

    const pending = handleClientToolCall(makeEvent(), deps);
    expect(seenSignal).toBeDefined();
    expect(seenSignal?.aborted).toBe(false);

    abortClientToolCalls("chat-1");
    await pending;

    expect(seenSignal?.aborted).toBe(true);
    expect(lastPostBody(fetchMock)).toMatchObject({ error: "stopped" });
  });

  it("scopes the abort to the chat: other chats keep running", async () => {
    let seenSignal: AbortSignal | undefined;
    registerClientToolExecutor(
      "fetch_availability",
      async (_input, context) => {
        seenSignal = context?.signal;
        return { ok: true as const, result: 1 };
      },
    );

    const pending = handleClientToolCall(makeEvent(), deps);
    abortClientToolCalls("chat-other");
    await pending;

    expect(seenSignal?.aborted).toBe(false);
    expect(lastPostBody(fetchMock)).toMatchObject({ result: 1 });
  });

  it.each([10, -10])(
    "closes a pushed call's prompt when the server stops waiting, with the client clock %i minutes off",
    async (minutesOff) => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + minutesOff * 60_000);
      try {
        const signals: AbortSignal[] = [];
        registerClientToolExecutor(
          "get_sidecar_document",
          (_input, context) =>
            new Promise((resolve) => {
              if (context?.signal) signals.push(context.signal);
              context?.signal?.addEventListener("abort", () =>
                resolve({ ok: false, error: "The prompt closed." }),
              );
            }),
        );
        const done = handleClientToolCall(
          makeEvent({ tool_name: "get_sidecar_document", tool_call_id: "c" }),
          { ...deps, timeoutMs: 90_000 },
        );
        await vi.advanceTimersByTimeAsync(89_999);
        expect(signals[0]?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(signals[0]?.aborted).toBe(true);
        await done;
        expect(lastPostBody(fetchMock)).toMatchObject({
          tool_call_id: "c",
          error: "The prompt closed.",
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("releases the controller once the execution settles", async () => {
    let seenSignal: AbortSignal | undefined;
    registerClientToolExecutor(
      "fetch_availability",
      async (_input, context) => {
        seenSignal = context?.signal;
        return { ok: true as const, result: 1 };
      },
    );

    await handleClientToolCall(makeEvent(), deps);
    // The settled execution's controller is gone, so a later stop of the same
    // chat must not fire its (already delivered) signal.
    abortClientToolCalls("chat-1");

    expect(seenSignal?.aborted).toBe(false);
  });

  it("delivers an empty success as an explicit null result", async () => {
    registerClientToolExecutor("fetch_availability", async () => ({
      ok: true as const,
      result: undefined,
    }));

    await handleClientToolCall(makeEvent(), deps);

    const body = lastPostBody(fetchMock);
    expect(body).toHaveProperty("result", null);
    expect(body).not.toHaveProperty("error");
  });
});
