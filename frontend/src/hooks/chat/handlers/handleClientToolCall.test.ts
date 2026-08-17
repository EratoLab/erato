import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleClientToolCall } from "./handleClientToolCall";
import {
  abortClientToolCalls,
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
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

  it("POSTs an error when no executor is registered", async () => {
    await handleClientToolCall(makeEvent(), deps);

    expect(lastPostBody(fetchMock).error).toContain("No client-tool executor");
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
