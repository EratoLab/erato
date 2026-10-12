import { afterEach, describe, expect, it, vi } from "vitest";

import { resetClientToolRegistryForTests } from "@/hooks/chat/clientToolExecutors";
import { fakeWebLocks } from "@/test/webLocks";

import { ClientToolOperationHandler } from "./clientToolHandler";
import { ClientOperationCoordinator, clientOperationApi } from "./coordinator";
import { createClientOperationHandlerRegistry } from "./handlers";

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
    } finally {
      coordinator.dispose();
      vi.unstubAllGlobals();
    }
  });
});
