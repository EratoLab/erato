import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { fakeWebLocks } from "@/test/webLocks";

import { ClientToolOperationHandler } from "./clientToolHandler";
import { ClientOperationCoordinator, clientOperationApi } from "./coordinator";
import { createClientOperationHandlerRegistry } from "./handlers";
import { registerOperationExecutor } from "./registration";

import type { ClientOperationApi, ClientOperationHandler } from "./coordinator";
import type { ClientToolExecutor } from "@/hooks/chat/clientToolExecutors";
import type {
  AttemptState,
  ExecutorBinding,
  OperationRequest,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const binding: ExecutorBinding = {
  device_id: "device-one-0000000",
  realm: "office-addin",
  host_context: { kind: "outlook_mailbox", identity: "a".repeat(64) },
};

function operation(
  overrides: Partial<OperationRequest> = {},
): OperationRequest {
  return {
    attempt_id: "00000000-0000-4000-8000-0000000000a1",
    operation_id: "outlook/fetch_availability",
    kind: "client_tool.v1",
    account_id: ACCOUNT,
    chat_id: "00000000-0000-4000-8000-0000000000c1",
    message_id: "00000000-0000-4000-8000-0000000000e1",
    tool_call_id: "avail-call",
    realm: "office-addin",
    consent: "none",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    input: { lookahead_days: 7 },
    binding,
    ...overrides,
  };
}

function fakeApi(request: OperationRequest = operation()) {
  let state: AttemptState = "pending";
  const api = {
    list: vi.fn<ClientOperationApi["list"]>(async () => ({
      enabled: true,
      executor_stream_enabled: false,
      account_id: ACCOUNT,
      operations:
        state === "completed"
          ? []
          : [{ request: globalThis.structuredClone(request), state }],
    })),
    claim: vi.fn<ClientOperationApi["claim"]>(async () => {
      state = "claimed";
      return {
        claim_token: "claim",
        expires_at: new Date(Date.now() + 120_000).toISOString(),
      };
    }),
    complete: vi.fn<ClientOperationApi["complete"]>(async () => {
      state = "ready";
      return { state };
    }),
    continue: vi.fn<ClientOperationApi["continue"]>(async () => {
      state = "completed";
    }),
    cancel: vi.fn<ClientOperationApi["cancel"]>(async () => {}),
  } satisfies ClientOperationApi;
  return {
    api,
    reopen: () => {
      state = "pending";
    },
  };
}

function toolHandler(
  toolName = "fetch_availability",
  inFlight: (toolCallId: string) => boolean = () => false,
) {
  const run = vi.fn<ClientToolExecutor>(async () => ({
    ok: true,
    result: { busy: [] },
  }));
  const handler = new ClientToolOperationHandler(
    toolName,
    run,
    () => binding,
    () => true,
    inFlight,
  );
  return { run, handler };
}

function coordinatorWith(
  api: ClientOperationApi,
  builtIns: readonly ClientOperationHandler[] = [],
  registered: readonly ClientOperationHandler[] = [],
) {
  const registry = createClientOperationHandlerRegistry();
  registered.forEach((handler) => registry.register(handler));
  const coordinator = new ClientOperationCoordinator(
    ACCOUNT,
    api,
    builtIns,
    vi.fn(),
    registry,
  );
  return { registry, coordinator };
}

afterEach(resetClientToolRegistryForTests);

describe("ClientOperationCoordinator handler registry", () => {
  it.each(["pending", "claimed"] as const)(
    "expires a %s operation after its executor has gone away",
    async (state) => {
      for (const executor of [
        undefined,
        { ...binding, device_id: "another-device-0000" },
        {
          ...binding,
          host_context: { kind: "outlook_mailbox", identity: "b".repeat(64) },
        },
      ]) {
        const request = operation({ expires_at: new Date(0).toISOString() });
        const { api } = fakeApi(request);
        api.list.mockResolvedValue({
          enabled: true,
          executor_stream_enabled: false,
          account_id: ACCOUNT,
          operations: [{ request, state }],
        });
        const attach = vi.fn<NonNullable<ClientOperationApi["attach"]>>();
        const { handler, run } = toolHandler();
        vi.spyOn(handler, "executor").mockReturnValue(executor);
        const { coordinator } = coordinatorWith(
          { ...api, attach },
          [],
          [handler],
        );
        try {
          await coordinator.reconcile();
          expect(api.continue).toHaveBeenCalledWith(
            request.attempt_id,
            expect.any(AbortSignal),
          );
          expect(attach).not.toHaveBeenCalled();
          expect(api.claim).not.toHaveBeenCalled();
          expect(run).not.toHaveBeenCalled();
        } finally {
          coordinator.dispose();
        }
      }
    },
  );

  it.each(["ready", "continuing"] as const)(
    "does not detach a %s continuation from another device or an unavailable executor",
    async (state) => {
      const request = operation();
      const { api } = fakeApi(request);
      api.list.mockResolvedValue({
        enabled: true,
        executor_stream_enabled: false,
        account_id: ACCOUNT,
        operations: [{ request, state }],
      });
      const attach = vi.fn<NonNullable<ClientOperationApi["attach"]>>();
      const { handler } = toolHandler();
      const executor = vi.spyOn(handler, "executor");
      const { coordinator } = coordinatorWith(
        { ...api, attach },
        [],
        [handler],
      );
      try {
        for (const current of [
          undefined,
          { ...binding, device_id: "another-device-0000" },
          {
            ...binding,
            host_context: { kind: "outlook_mailbox", identity: "b".repeat(64) },
          },
        ]) {
          executor.mockReturnValue(current);
          await coordinator.reconcile();
        }
        expect(attach).not.toHaveBeenCalled();
        expect(api.continue).not.toHaveBeenCalled();
        expect(api.claim).not.toHaveBeenCalled();
        executor.mockReturnValue(binding);
        attach.mockResolvedValue(undefined);
        await coordinator.reconcile();
        expect(attach).toHaveBeenCalledOnce();
      } finally {
        coordinator.dispose();
      }
    },
  );

  it.each([
    { consent: "ask" as const },
    { consent: "native" as const, kind: "native.v1" },
  ])("keeps $consent continuations detached", async (overrides) => {
    const request = operation(overrides);
    const { api } = fakeApi(request);
    api.list.mockResolvedValue({
      enabled: true,
      executor_stream_enabled: false,
      account_id: ACCOUNT,
      operations: [{ request, state: "ready" }],
    });
    const attach = vi.fn<NonNullable<ClientOperationApi["attach"]>>();
    const handler: ClientOperationHandler = {
      kind: request.kind,
      executor: () => undefined,
      execute: vi.fn(),
    };
    const { coordinator } = coordinatorWith({ ...api, attach }, [handler]);
    try {
      await coordinator.reconcile();
      expect(api.continue).toHaveBeenCalledOnce();
      expect(attach).not.toHaveBeenCalled();
    } finally {
      coordinator.dispose();
    }
  });

  it("keeps sweeping other chats while attached continuations are open", async () => {
    const first = operation();
    const second = operation({
      attempt_id: "00000000-0000-4000-8000-0000000000a2",
      chat_id: "00000000-0000-4000-8000-0000000000c2",
    });
    const { api } = fakeApi(first);
    api.list.mockImplementation(async () => ({
      enabled: true,
      executor_stream_enabled: false,
      account_id: ACCOUNT,
      operations: [first, second].map((request) => ({
        request,
        state: "ready" as const,
      })),
    }));
    const attach = vi.fn<NonNullable<ClientOperationApi["attach"]>>(
      (_request, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    );
    const { coordinator } = coordinatorWith(
      { ...api, attach },
      [],
      [toolHandler().handler],
    );
    try {
      await coordinator.reconcile();
      await coordinator.reconcile();
      expect(attach.mock.calls.map(([request]) => request.attempt_id)).toEqual([
        first.attempt_id,
        second.attempt_id,
      ]);
      expect(api.continue).not.toHaveBeenCalled();
      expect(api.claim).not.toHaveBeenCalled();
    } finally {
      coordinator.dispose();
    }
    expect(attach.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
  });

  it("dispatches a kind to the handler whose operation id matches", async () => {
    const { api } = fakeApi();
    const { registry, coordinator } = coordinatorWith(api);
    const draft = toolHandler("create_draft");
    const availability = toolHandler();
    registry.register(draft.handler);
    registry.register(availability.handler);
    await coordinator.reconcile();
    expect(draft.run).not.toHaveBeenCalled();
    expect(availability.run).toHaveBeenCalledWith(
      { lookahead_days: 7 },
      expect.objectContaining({ toolCallId: "avail-call" }),
    );
    expect(api.complete.mock.calls[0][2]).toMatchObject({
      outcome: "succeeded",
      result: { type: "value", value: { busy: [] } },
    });
    expect(api.continue).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it("never claims an operation no handler matches", async () => {
    const { api } = fakeApi(
      operation({ operation_id: "outlook/create_draft" }),
    );
    const { registry, coordinator } = coordinatorWith(api);
    const availability = toolHandler();
    registry.register(availability.handler);
    await coordinator.reconcile();
    expect(api.claim).not.toHaveBeenCalled();
    expect(availability.run).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("claims after a late registration and stops after unregistering", async () => {
    const { api, reopen } = fakeApi();
    const { registry, coordinator } = coordinatorWith(api);
    await coordinator.reconcile();
    expect(api.claim).not.toHaveBeenCalled();
    const availability = toolHandler();
    const unregister = registry.register(availability.handler);
    await vi.waitFor(() => expect(api.continue).toHaveBeenCalledTimes(1));
    expect(availability.run).toHaveBeenCalledTimes(1);
    unregister();
    reopen();
    await coordinator.reconcile();
    expect(api.claim).toHaveBeenCalledTimes(1);
    expect(availability.run).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it("sweeps on a nudge", async () => {
    const { api } = fakeApi();
    const { registry, coordinator } = coordinatorWith(api);
    registry.nudge();
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    coordinator.dispose();
  });

  it("defers the claim while the live call still runs in this pane", async () => {
    const { api } = fakeApi();
    const { registry, coordinator } = coordinatorWith(api);
    let inFlight = true;
    const availability = toolHandler("fetch_availability", () => inFlight);
    registry.register(availability.handler);
    await coordinator.reconcile();
    expect(api.claim).not.toHaveBeenCalled();
    inFlight = false;
    await coordinator.reconcile();
    expect(api.claim).toHaveBeenCalledTimes(1);
    expect(availability.run).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it("skips an operation another pane of this browser already runs", async () => {
    const request = operation();
    const restore = fakeWebLocks(
      new Set([`erato.client-call:${request.message_id}:avail-call`]),
    );
    try {
      const { api } = fakeApi(request);
      const { registry, coordinator } = coordinatorWith(api);
      const availability = toolHandler();
      registry.register(availability.handler);
      await coordinator.reconcile();
      expect(api.claim).not.toHaveBeenCalled();
      expect(availability.run).not.toHaveBeenCalled();
      coordinator.dispose();
    } finally {
      restore();
    }
  });

  it("disposes its built-in handlers but leaves registered ones to the shell", async () => {
    const { api } = fakeApi();
    const builtInDispose = vi.fn();
    const builtIn: ClientOperationHandler = toolHandler("create_draft").handler;
    builtIn.dispose = builtInDispose;
    const { registry, coordinator } = coordinatorWith(api, [builtIn]);
    const registeredDispose = vi.fn();
    const registered: ClientOperationHandler = toolHandler().handler;
    registered.dispose = registeredDispose;
    registry.register(registered);
    coordinator.dispose();
    expect(builtInDispose).toHaveBeenCalledTimes(1);
    expect(registeredDispose).not.toHaveBeenCalled();
    expect(registry.handlers()).toEqual([registered]);
    api.list.mockClear();
    registry.nudge();
    await coordinator.reconcile();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("claims, completes and continues through the real adapter without user confirmation", async () => {
    const request = operation();
    let state: AttemptState = "pending";
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      let body: unknown = {};
      if (url === "/api/v1beta/me/client-operations")
        body = {
          enabled: true,
          executor_stream_enabled: false,
          account_id: ACCOUNT,
          operations: state === "completed" ? [] : [{ request, state }],
        };
      else if (url.endsWith("/claim")) {
        state = "claimed";
        body = {
          claim_token: "claim",
          expires_at: new Date(Date.now() + 120_000).toISOString(),
        };
      } else if (url.endsWith("/result")) state = "ready";
      else if (url.endsWith("/continue")) state = "completed";
      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => body,
        init,
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { coordinator } = coordinatorWith(
      clientOperationApi,
      [],
      [toolHandler().handler],
    );
    try {
      await coordinator.reconcile();
      const calls = fetchMock.mock.calls.map(([url, init]) => ({
        url,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      }));
      const path = `/api/v1beta/me/client-operations/${request.attempt_id}`;
      expect(calls.map(({ url }) => url)).toEqual([
        "/api/v1beta/me/client-operations",
        `${path}/claim`,
        `${path}/result`,
        `${path}/continue`,
      ]);
      expect(calls[1].body).toEqual({ binding, user_confirmed: false });
      expect(calls[1].headers).toMatchObject({
        "X-Erato-Executor": JSON.stringify(binding),
        "X-Erato-Client-Tools": "fetch_availability",
      });
      expect(calls[2].body).toEqual({
        claim_token: "claim",
        result: {
          attempt_id: request.attempt_id,
          operation_id: request.operation_id,
          executor: binding,
          outcome: "succeeded",
          result: { type: "value", value: { busy: [] } },
        },
      });
      expect(calls[3].headers).toMatchObject({
        Accept: "text/event-stream",
        "X-Erato-Executor": JSON.stringify(binding),
      });
    } finally {
      coordinator.dispose();
      vi.unstubAllGlobals();
    }
  });
});

describe("ClientOperationCoordinator executor stream", () => {
  function streamApi() {
    const { api } = fakeApi();
    const page = { durable: false, stream: true };
    api.list.mockImplementation(async () => ({
      enabled: page.durable,
      executor_stream_enabled: page.stream,
      account_id: ACCOUNT,
      operations: [],
    }));
    const signals: AbortSignal[] = [];
    const nudges: (() => void)[] = [];
    const stream = vi.fn<NonNullable<ClientOperationApi["stream"]>>(
      (_headers, onNudge, signal) => {
        signals.push(signal);
        nudges.push(onNudge);
        return new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    return { api: { ...api, stream }, page, stream, signals, nudges };
  }

  it("holds one stream for the binding while only executor streams are enabled", async () => {
    const unregister = registerOperationExecutor(
      "fetch_availability",
      () => binding,
    );
    const { api, stream, signals } = streamApi();
    const { coordinator } = coordinatorWith(api);
    try {
      await coordinator.reconcile();
      await coordinator.reconcile();
      expect(coordinator.enabled).toBe(true);
      expect(stream).toHaveBeenCalledOnce();
      expect(stream.mock.calls[0]?.[0]).toEqual({
        "X-Erato-Executor": JSON.stringify(binding),
        "X-Erato-Client-Tools": "fetch_availability",
      });
      expect(api.claim).not.toHaveBeenCalled();
      coordinator.dispose();
      expect(signals[0]?.aborted).toBe(true);
    } finally {
      unregister();
    }
  });

  it("reopens the stream when the tools change and closes it without a binding", async () => {
    let current: ExecutorBinding | undefined = binding;
    const unregister = registerOperationExecutor(
      "fetch_availability",
      () => current,
    );
    const { api, stream, signals } = streamApi();
    const { coordinator } = coordinatorWith(api);
    try {
      await coordinator.reconcile();
      registerClientToolExecutor(
        "read_document_blocks",
        vi.fn<ClientToolExecutor>(),
        () => true,
        { acceptsGrantCalls: true },
      );
      await coordinator.reconcile();
      expect(signals[0]?.aborted).toBe(true);
      expect(stream.mock.calls[1]?.[0]).toMatchObject({
        "X-Erato-Client-Tools": "fetch_availability,read_document_blocks",
        "X-Erato-Child-Client-Tools": "read_document_blocks",
      });
      current = undefined;
      await coordinator.reconcile();
      expect(signals[1]?.aborted).toBe(true);
      expect(stream).toHaveBeenCalledTimes(2);
    } finally {
      coordinator.dispose();
      unregister();
    }
  });

  it("closes the stream when the server turns it off", async () => {
    const unregister = registerOperationExecutor(
      "fetch_availability",
      () => binding,
    );
    const { api, page, signals } = streamApi();
    const { coordinator } = coordinatorWith(api);
    try {
      await coordinator.reconcile();
      page.stream = false;
      await coordinator.reconcile();
      expect(signals[0]?.aborted).toBe(true);
      expect(coordinator.enabled).toBe(false);
    } finally {
      coordinator.dispose();
      unregister();
    }
  });

  it("sweeps the inbox when the stream announces an operation", async () => {
    const unregister = registerOperationExecutor(
      "fetch_availability",
      () => binding,
    );
    const { api, page, nudges } = streamApi();
    page.durable = true;
    const { coordinator } = coordinatorWith(api);
    try {
      await coordinator.reconcile();
      const sweeps = api.list.mock.calls.length;
      nudges[0]?.();
      await vi.waitFor(() =>
        expect(api.list).toHaveBeenCalledTimes(sweeps + 1),
      );
    } finally {
      coordinator.dispose();
      unregister();
    }
  });
});
