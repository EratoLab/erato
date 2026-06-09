import { afterEach, describe, expect, it, vi } from "vitest";

import { setAuthRecoveryHandler } from "@/auth/authRecovery";
import { setIdToken } from "@/auth/tokenStore";

import { v1betaApiFetch } from "./generated/v1betaApi/v1betaApiFetcher";

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
