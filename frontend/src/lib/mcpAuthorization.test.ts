import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchCompleteMcpServerOauth,
  fetchListMcpServerTools,
  fetchStartMcpServerOauth,
  listMcpServersQuery,
} from "./generated/v1betaApi/v1betaApiComponents";
import {
  clearMcpAuthorization,
  completeMcpAuthorization,
  startMcpAuthorization,
  useMcpAuthorizationStore,
  watchMcpAuthorization,
} from "./mcpAuthorization";

vi.mock("./generated/v1betaApi/v1betaApiComponents", () => ({
  fetchCompleteMcpServerOauth: vi.fn(),
  fetchListMcpServerTools: vi.fn(),
  fetchStartMcpServerOauth: vi.fn(),
  listMcpServersQuery: () => ({ queryKey: ["servers"] }),
  listMcpServerToolsQuery: ({
    pathParams,
  }: {
    pathParams: { serverId: string };
  }) => ({ queryKey: ["tools", pathParams.serverId] }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const phase = () => useMcpAuthorizationStore.getState().phases.sales;
const tools = (status: "SUCCESS" | "NEEDS_AUTHENTICATION" | "FAILURE") => ({
  status,
  server_id: "sales",
  tools: [],
  allow_always: false,
  ask_available: false,
});

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  for (const serverId of Object.keys(
    useMcpAuthorizationStore.getState().phases,
  ))
    clearMcpAuthorization(serverId);
  useMcpAuthorizationStore.setState({ phases: {} });
  client.clear();
  vi.useRealTimers();
});

describe("MCP authorization lifecycle", () => {
  it("guards double-clicks synchronously while start is pending", async () => {
    const start = deferred<{ authorization_url: string }>();
    vi.mocked(fetchStartMcpServerOauth).mockReturnValue(start.promise);
    const first = startMcpAuthorization("sales");
    await startMcpAuthorization("sales");
    expect(fetchStartMcpServerOauth).toHaveBeenCalledTimes(1);
    expect(phase()).toBe("starting");
    // A cancelled start must never navigate on a late response.
    clearMcpAuthorization("sales");
    start.resolve({
      authorization_url: "https://provider.test/authorize?state=late",
    });
    await first;
    expect(phase()).toBeUndefined();
  });

  it("deduplicates callback remounts and confirms without refreshing every server", async () => {
    const grant = deferred<{ connection_status: "SUCCESS" }>();
    vi.mocked(fetchCompleteMcpServerOauth).mockReturnValue(grant.promise);
    const callback = {
      serverId: "sales",
      code: "code",
      state: "dedupe",
      iss: "https://issuer.test",
    };
    client.setQueryData(listMcpServersQuery({}).queryKey, {
      servers: [
        {
          id: "sales",
          authentication_mode: "oauth2",
          connection_status: "NEEDS_AUTHENTICATION",
        },
      ],
    });
    const first = completeMcpAuthorization(client, callback);
    const second = completeMcpAuthorization(client, callback);
    expect(first).toBe(second);
    expect(phase()).toBe("finishing");
    expect(fetchCompleteMcpServerOauth).toHaveBeenCalledTimes(1);
    expect(fetchCompleteMcpServerOauth).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: {
          code: "code",
          state: "dedupe",
          iss: "https://issuer.test",
        },
      }),
      expect.any(AbortSignal),
    );
    grant.resolve({ connection_status: "SUCCESS" });
    await first;
    expect(phase()).toBe("connected");
    expect(client.getQueryData(listMcpServersQuery({}).queryKey)).toMatchObject(
      { servers: [{ connection_status: "SUCCESS" }] },
    );
    expect(fetchListMcpServerTools).not.toHaveBeenCalled();
  });

  it("handles provider denial without calling the code exchange", async () => {
    await completeMcpAuthorization(client, {
      serverId: "sales",
      state: "denied",
      error: "access_denied",
    });
    expect(phase()).toBe("denied");
    expect(fetchCompleteMcpServerOauth).not.toHaveBeenCalled();
  });

  it("recovers actual success after a lost callback response without replaying the code", async () => {
    vi.mocked(fetchCompleteMcpServerOauth).mockRejectedValue(
      new Error("lost response"),
    );
    vi.mocked(fetchListMcpServerTools).mockResolvedValue(tools("SUCCESS"));
    await completeMcpAuthorization(client, {
      serverId: "sales",
      code: "used",
      state: "recovery",
    });
    expect(phase()).toBe("connected");
    expect(fetchCompleteMcpServerOauth).toHaveBeenCalledTimes(1);
    expect(fetchListMcpServerTools).toHaveBeenCalledTimes(1);
  });

  it("does not turn successful authorization with an unavailable MCP into success", async () => {
    vi.mocked(fetchCompleteMcpServerOauth).mockResolvedValue({
      connection_status: "FAILURE",
    });
    await completeMcpAuthorization(client, {
      serverId: "sales",
      code: "code",
      state: "unavailable",
    });
    expect(phase()).toBe("unavailable");
  });

  it("ignores late callback results after timeout and a new attempt", async () => {
    const grant = deferred<{ connection_status: "SUCCESS" }>();
    vi.mocked(fetchCompleteMcpServerOauth).mockReturnValue(grant.promise);
    const first = completeMcpAuthorization(client, {
      serverId: "sales",
      code: "code",
      state: "slow",
    });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(phase()).toBe("timeout");
    watchMcpAuthorization(client, "sales", () => {});
    grant.resolve({ connection_status: "SUCCESS" });
    await first;
    expect(phase()).toBe("waiting");
  });

  it("opens once, backs off on pending consent and stops on success", async () => {
    vi.mocked(fetchListMcpServerTools)
      .mockResolvedValueOnce(tools("NEEDS_AUTHENTICATION"))
      .mockResolvedValueOnce(tools("SUCCESS"));
    const open = vi.fn();
    watchMcpAuthorization(client, "sales", open);
    watchMcpAuthorization(client, "sales", open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(phase()).toBe("waiting");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchListMcpServerTools).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5_999);
    expect(fetchListMcpServerTools).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(phase()).toBe("connected");
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchListMcpServerTools).toHaveBeenCalledTimes(2);
  });

  it("does not overlap probes and stops after a dead server's request timeout", async () => {
    const probe = deferred<ReturnType<typeof tools>>();
    vi.mocked(fetchListMcpServerTools).mockReturnValue(probe.promise);
    watchMcpAuthorization(client, "sales", () => {});
    await vi.advanceTimersByTimeAsync(3_000);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(phase()).toBe("unavailable");
    probe.resolve(tools("SUCCESS"));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(phase()).toBe("unavailable");
    expect(fetchListMcpServerTools).toHaveBeenCalledTimes(1);
  });

  it("stops after the first network failure and allows explicit retry", async () => {
    vi.mocked(fetchListMcpServerTools)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(tools("SUCCESS"));
    watchMcpAuthorization(client, "sales", () => {});
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchListMcpServerTools).toHaveBeenCalledTimes(1);
    expect(phase()).toBe("unavailable");
    watchMcpAuthorization(client, "sales", () => {});
    await vi.advanceTimersByTimeAsync(3_000);
    expect(phase()).toBe("connected");
  });

  it("bounds unanswered consent to ten minutes and clears listeners", async () => {
    vi.mocked(fetchListMcpServerTools).mockResolvedValue(
      tools("NEEDS_AUTHENTICATION"),
    );
    watchMcpAuthorization(client, "sales", () => {});
    await vi.advanceTimersByTimeAsync(660_000);
    expect(phase()).toBe("timeout");
    expect(
      vi.mocked(fetchListMcpServerTools).mock.calls.length,
    ).toBeLessThanOrEqual(14);
    const count = vi.mocked(fetchListMcpServerTools).mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchListMcpServerTools).toHaveBeenCalledTimes(count);
  });
});
