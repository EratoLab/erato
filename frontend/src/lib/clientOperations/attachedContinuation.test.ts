import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { createSSEConnection } from "@/utils/sse/sseClient";

import { continueAttachedOperation } from "./attachedContinuation";
import { registerOperationExecutor } from "./registration";

import type { OperationRequest } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SSEOptions } from "@/utils/sse/sseClient";

vi.mock("@/utils/sse/sseClient", () => ({ createSSEConnection: vi.fn() }));

const request: OperationRequest = {
  attempt_id: "attempt",
  operation_id: "outlook/fetch_availability",
  kind: "client_tool.v1",
  chat_id: "chat",
  message_id: "message",
  tool_call_id: "first",
  account_id: "account",
  realm: "office-addin",
  consent: "none",
  expires_at: "2099-01-01T00:00:00Z",
  input: {},
  binding: {
    device_id: "device",
    realm: "office-addin",
    host_context: { kind: "outlook_mailbox", identity: "a".repeat(64) },
  },
};

afterEach(() => {
  resetClientToolRegistryForTests();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("attached operation continuation", () => {
  it("advertises current tools and executes a later live call once without a mounted chat", async () => {
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
    const remove = registerOperationExecutor(
      "fetch_availability",
      () => request.binding,
    );
    registerClientToolExecutor("fetch_availability", execute);
    registerClientToolExecutor("another_tool", execute);
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ delivered: true, stored: false }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const done = continueAttachedOperation(
        request,
        new AbortController().signal,
      );
      expect(options?.headers).toMatchObject({
        Accept: "text/event-stream",
        "X-Erato-Executor": JSON.stringify(request.binding),
        "X-Erato-Client-Tools": "another_tool,fetch_availability",
      });
      const event = {
        type: "client_tool_call",
        data: JSON.stringify({
          message_type: "client_tool_call",
          message_id: "message",
          content_index: 2,
          tool_call_id: "second",
          tool_name: "fetch_availability",
          input: {},
        }),
      };
      options?.onMessage?.(event);
      options?.onMessage?.(event);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      expect(execute).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]?.[0]).toBe(
        "/api/v1beta/me/messages/clienttoolresult",
      );
      options?.onMessage?.({
        type: "stream_end",
        data: JSON.stringify({ message_type: "stream_end" }),
      });
      await done;
      expect(cleanup).toHaveBeenCalledOnce();
    } finally {
      remove();
    }
  });

  it("closes the owning stream when the coordinator is disposed", async () => {
    const cleanup = vi.fn();
    vi.mocked(createSSEConnection).mockReturnValue(cleanup);
    const controller = new AbortController();
    const done = continueAttachedOperation(request, controller.signal);
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
