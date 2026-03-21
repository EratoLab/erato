import { afterEach, describe, expect, it, vi } from "vitest";

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
});
