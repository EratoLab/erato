import { afterEach, describe, expect, it, vi } from "vitest";

import { setAuthRecoveryHandler } from "@/auth/authRecovery";
import { setIdToken } from "@/auth/tokenStore";
import {
  connectivity,
  isNetworkFailure,
} from "@/lib/connectivity/connectivity";

import {
  ClientOperationCoordinator,
  clientOperationApi,
} from "./clientOperations/coordinator";
import {
  READ_RESPONSE_TIMEOUT_MS,
  REQUEST_TIMED_OUT_MESSAGE,
  v1betaApiFetch,
} from "./generated/v1betaApi/v1betaApiFetcher";

describe("v1betaApiFetch optional query parameters", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mockFetch(body: unknown = {}) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it.each([
    ["operations", clientOperationApi.list, "/api/v1beta/me/client-operations"],
  ] as const)(
    "omits the first-page cursor for %s and preserves later cursors",
    async (_name, list, endpoint) => {
      const fetchMock = mockFetch({ operations: [] });
      const caller = new AbortController();
      const cursor = "550e8400-e29b-41d4-a716-446655440000";

      await list(undefined, caller.signal);
      await list(cursor, caller.signal);

      expect(fetchMock.mock.calls[0][0]).toBe(endpoint);
      expect(fetchMock.mock.calls[1][0]).toBe(`${endpoint}?after=${cursor}`);
    },
  );

  it.each([undefined, {}, { after: undefined }])(
    "has no trailing question mark for %j",
    async (queryParams) => {
      const fetchMock = mockFetch();
      await v1betaApiFetch({ url: "/probe", method: "get", queryParams });
      expect(fetchMock.mock.calls[0][0]).toBe("/probe");
    },
  );

  it("preserves defined values and encoding without mutating query parameters", async () => {
    const fetchMock = mockFetch();
    const queryParams = Object.freeze({
      after: undefined,
      limit: 0,
      active: false,
      empty: "",
      q: "a b&c+ü",
      literal: "undefined",
      nullable: null,
    });
    await v1betaApiFetch({ url: "/probe", method: "get", queryParams });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/probe?limit=0&active=false&empty=&q=a+b%26c%2B%C3%BC&literal=undefined&nullable=null",
    );
    expect(Object.hasOwn(queryParams, "after")).toBe(true);
  });

  it("starts every coordinator sweep without a cursor and follows server pagination", async () => {
    const cursor = "550e8400-e29b-41d4-a716-446655440000";
    const page = {
      account_id: "account",
      enabled: true,
      executor_stream_enabled: false,
      operations: [],
    };
    const fetchMock = mockFetch();
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => (url.includes("?") ? page : { ...page, after: cursor }),
    }));
    const coordinator = new ClientOperationCoordinator(
      "account",
      clientOperationApi,
      [],
      vi.fn(),
    );
    try {
      await coordinator.reconcile();
      await coordinator.reconcile();
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        "/api/v1beta/me/client-operations",
        `/api/v1beta/me/client-operations?after=${cursor}`,
        "/api/v1beta/me/client-operations",
        `/api/v1beta/me/client-operations?after=${cursor}`,
      ]);
    } finally {
      coordinator.dispose();
    }
  });

  it("receives cloud disablement through the real adapter and stops polling", async () => {
    const fetchMock = mockFetch({
      account_id: "account",
      enabled: false,
      executor_stream_enabled: false,
      operations: [],
    });
    const coordinator = new ClientOperationCoordinator(
      "account",
      clientOperationApi,
      [],
      vi.fn(),
    );
    try {
      await coordinator.reconcile();
      await coordinator.reconcile();
      expect(coordinator.enabled).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        "/api/v1beta/me/client-operations",
      );
    } finally {
      coordinator.dispose();
    }
  });
});

describe("v1betaApiFetch auth injection", () => {
  afterEach(() => {
    setIdToken(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("injects bearer auth when an add-in token is available", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ ok: true }),
    });

    setIdToken("test-id-token");
    vi.stubGlobal("fetch", fetchMock);

    await v1betaApiFetch({
      url: "/api/v1beta/me/budget",
      method: "get",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-id-token",
    });
  });

  it("preserves an explicit authorization header from the caller", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ ok: true }),
    });

    setIdToken("test-id-token");
    vi.stubGlobal("fetch", fetchMock);

    await v1betaApiFetch({
      url: "/api/v1beta/chats/test/messages",
      method: "get",
      headers: {
        Authorization: "Bearer caller-token",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer caller-token",
    });
  });

  it("keeps auth while removing multipart content-type so the browser sets the boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ ok: true }),
    });

    setIdToken("test-id-token");
    vi.stubGlobal("fetch", fetchMock);

    const formData = new FormData();
    formData.append("file", new File(["hello"], "hello.txt"));

    await v1betaApiFetch({
      url: "/api/v1beta/me/files",
      method: "post",
      body: formData,
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Authorization: "Bearer test-id-token",
    });
  });

  it("does not apply the json content-type default to FormData uploads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ ok: true }),
    });

    setIdToken("test-id-token");
    vi.stubGlobal("fetch", fetchMock);

    const formData = new FormData();
    formData.append("file", new File(["hello"], "hello.txt"));

    await v1betaApiFetch({
      url: "/api/v1beta/me/files",
      method: "post",
      body: formData,
      headers: {
        Authorization: "Bearer caller-token",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Authorization: "Bearer caller-token",
    });
  });
});

// Guards the hand-added 401-recovery seam in the (codegen-generated) fetcher: if
// a regenerate ever clobbers it back to the stock template, these fail in CI
// rather than silently shipping a fetcher that can't recover.
describe("v1betaApiFetch 401 auth recovery", () => {
  afterEach(() => {
    setAuthRecoveryHandler(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const okJson = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: vi.fn().mockResolvedValue({ recovered: true }),
  });
  const unauthorized = () => ({
    ok: false,
    status: 401,
    headers: new Headers(),
    json: vi.fn().mockResolvedValue({ detail: "unauthorized" }),
  });

  it("recovers on a 401 and replays the request exactly once", async () => {
    const handler = vi.fn().mockResolvedValue(true);
    setAuthRecoveryHandler(handler);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(okJson());
    vi.stubGlobal("fetch", fetchMock);

    const result = await v1betaApiFetch({
      url: "/api/v1beta/me/budget",
      method: "get",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("rest-401");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ recovered: true });
  });

  it("recovers on the proxy's 403 sign-in page and replays the request once", async () => {
    const handler = vi.fn().mockResolvedValue(true);
    setAuthRecoveryHandler(handler);
    const signInPage = {
      ok: false,
      status: 403,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      json: vi.fn().mockRejectedValue(new SyntaxError("not JSON")),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(signInPage)
      .mockResolvedValueOnce(okJson());
    vi.stubGlobal("fetch", fetchMock);

    const result = await v1betaApiFetch({
      url: "/api/v1beta/token_usage/estimate",
      method: "post",
      body: { chat_id: "chat-1" },
    });

    expect(handler).toHaveBeenCalledWith("rest-403");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ recovered: true });
  });

  it("does not recover on the backend's own 403", async () => {
    const handler = vi.fn().mockResolvedValue(true);
    setAuthRecoveryHandler(handler);
    const forbidden = {
      ok: false,
      status: 403,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ error: "forbidden" }),
    };
    const fetchMock = vi.fn().mockResolvedValue(forbidden);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      v1betaApiFetch({ url: "/api/v1beta/me/budget", method: "get" }),
    ).rejects.toBeDefined();
    expect(handler).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not replay when no recovery handler is registered (web app)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(unauthorized());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      v1betaApiFetch({ url: "/api/v1beta/me/budget", method: "get" }),
    ).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not replay when recovery fails", async () => {
    const handler = vi.fn().mockResolvedValue(false);
    setAuthRecoveryHandler(handler);
    const fetchMock = vi.fn().mockResolvedValue(unauthorized());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      v1betaApiFetch({ url: "/api/v1beta/me/budget", method: "get" }),
    ).rejects.toBeDefined();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("v1betaApiFetch network failures", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function pendingUntilAborted() {
    return vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
  }

  it("times out a hanging read and reports it as a network failure", async () => {
    vi.useFakeTimers();
    const failure = vi
      .spyOn(connectivity, "reportNetworkFailure")
      .mockImplementation(() => {});
    vi.stubGlobal("fetch", pendingUntilAborted());

    const request = v1betaApiFetch({
      url: "/api/v1beta/me/budget",
      method: "get",
    });
    const outcome = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(READ_RESPONSE_TIMEOUT_MS);

    const error = await outcome;
    expect((error as Error).message).toBe("Network error (request timed out)");
    expect(isNetworkFailure(error)).toBe(true);
    expect(failure).toHaveBeenCalledTimes(1);
  });

  it("lets a read with a longer limit of its own wait past the default", async () => {
    vi.useFakeTimers();
    vi.spyOn(connectivity, "reportNetworkFailure").mockImplementation(() => {});
    vi.stubGlobal("fetch", pendingUntilAborted());

    let settled = false;
    const request = v1betaApiFetch({
      url: "/api/v1beta/me/wait-lines",
      method: "get",
      readTimeoutMs: READ_RESPONSE_TIMEOUT_MS * 2,
    }).catch((error: unknown) => error);
    void request.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(READ_RESPONSE_TIMEOUT_MS + 1_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(READ_RESPONSE_TIMEOUT_MS);
    expect(((await request) as Error).message).toBe(
      "Network error (request timed out)",
    );
  });

  it("forwards the caller's abort and does not report it", async () => {
    const failure = vi
      .spyOn(connectivity, "reportNetworkFailure")
      .mockImplementation(() => {});
    vi.stubGlobal("fetch", pendingUntilAborted());
    const caller = new AbortController();

    const request = v1betaApiFetch({
      url: "/api/v1beta/me/budget",
      method: "get",
      signal: caller.signal,
    });
    caller.abort();

    const error = await request.catch((e: unknown) => e);
    expect(isNetworkFailure(error)).toBe(false);
    expect(failure).not.toHaveBeenCalled();
  });

  it("marks a request that got no response", async () => {
    const failure = vi
      .spyOn(connectivity, "reportNetworkFailure")
      .mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const error = await v1betaApiFetch({
      url: "/api/v1beta/me/budget",
      method: "post",
    }).catch((e: unknown) => e);

    expect(isNetworkFailure(error)).toBe(true);
    expect(failure).toHaveBeenCalledTimes(1);
  });

  it("treats an HTTP error as reachable", async () => {
    const failure = vi
      .spyOn(connectivity, "reportNetworkFailure")
      .mockImplementation(() => {});
    const success = vi
      .spyOn(connectivity, "reportNetworkSuccess")
      .mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ status: 500, payload: "boom" }),
      }),
    );

    const error = await v1betaApiFetch({
      url: "/api/v1beta/me/budget",
      method: "get",
    }).catch((e: unknown) => e);

    expect(error).toEqual({ status: 500, payload: "boom" });
    expect(isNetworkFailure(error)).toBe(false);
    expect(failure).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledTimes(1);
  });

  it("does not time out writes", async () => {
    vi.useFakeTimers();
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = v1betaApiFetch({
      url: "/api/v1beta/me/compact",
      method: "post",
    });
    await vi.advanceTimersByTimeAsync(READ_RESPONSE_TIMEOUT_MS * 2);
    resolveFetch({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ done: true }),
    });

    await expect(request).resolves.toEqual({ done: true });
  });
  it("times out a write only when the caller gives it a limit", async () => {
    vi.useFakeTimers();
    vi.spyOn(connectivity, "reportNetworkFailure").mockImplementation(() => {});
    vi.stubGlobal("fetch", pendingUntilAborted());

    const request = v1betaApiFetch({
      url: "/api/v1beta/me/files",
      method: "post",
      requestTimeoutMs: 1_000,
    });
    const outcome = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);

    const error = await outcome;
    expect((error as Error).message).toBe(REQUEST_TIMED_OUT_MESSAGE);
    expect(isNetworkFailure(error)).toBe(true);
  });

  it("does not cut a slow body once the response has started", async () => {
    vi.useFakeTimers();
    vi.spyOn(connectivity, "reportNetworkSuccess").mockImplementation(() => {});
    let finishBody: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          new Promise((resolve) => {
            finishBody = resolve;
          }),
      }),
    );

    const request = v1betaApiFetch({
      url: "/api/v1beta/me/budget",
      method: "get",
    });
    await vi.advanceTimersByTimeAsync(READ_RESPONSE_TIMEOUT_MS * 2);
    finishBody({ slow: true });

    await expect(request).resolves.toEqual({ slow: true });
  });

  it("does not take a request that could not be built for a network failure", async () => {
    const failure = vi
      .spyOn(connectivity, "reportNetworkFailure")
      .mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const error = await v1betaApiFetch({
      url: "/api/v1beta/me/budget",
      method: "post",
      body: circular,
    }).catch((e: unknown) => e);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(isNetworkFailure(error)).toBe(false);
    expect(failure).not.toHaveBeenCalled();
  });
});
