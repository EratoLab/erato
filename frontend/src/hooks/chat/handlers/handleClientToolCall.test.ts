import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleClientToolCall } from "./handleClientToolCall";
import {
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
    tool_name: "outlook.fetch_availability",
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
    registerClientToolExecutor("outlook.fetch_availability", async (input) => {
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
    registerClientToolExecutor("outlook.fetch_availability", async () => ({
      ok: false,
      error: "boom",
    }));

    await handleClientToolCall(makeEvent(), deps);

    expect(lastPostBody(fetchMock)).toMatchObject({ error: "boom" });
  });

  it("POSTs an error when the executor throws", async () => {
    registerClientToolExecutor("outlook.fetch_availability", async () => {
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
    registerClientToolExecutor("outlook.fetch_availability", executor);

    await handleClientToolCall(makeEvent(), deps);
    await handleClientToolCall(makeEvent(), deps); // replay, same tool_call_id

    expect(executor).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no-ops when the chat id is missing", async () => {
    await handleClientToolCall(makeEvent(), { ...deps, chatId: null });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
