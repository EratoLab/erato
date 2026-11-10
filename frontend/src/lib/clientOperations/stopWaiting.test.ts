import { afterEach, describe, expect, it, vi } from "vitest";

import { clientOperationHandlerRegistry } from "./handlers";
import { stopWaitingForCall } from "./stopWaiting";

vi.mock("@/auth/tokenStore", () => ({
  getIdToken: () => null,
}));

// The routes answer JSON on success and a plain-text reason on a refusal,
// which is what keeps the status on the generated fetcher's error.
const respond = (...statuses: number[]) => {
  const fetchMock = vi.fn();
  for (const status of statuses)
    fetchMock.mockResolvedValueOnce(
      status < 400
        ? new Response(JSON.stringify({ state: "ready" }), {
            status,
            headers: { "content-type": "application/json" },
          })
        : new Response("Operation already settled", { status }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("stopWaitingForCall", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancels the call, then continues it", async () => {
    const fetchMock = respond(200, 200);
    await expect(stopWaitingForCall("attempt-1")).resolves.toBe("stopped");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1beta/me/client-operations/attempt-1/cancel",
      "/api/v1beta/me/client-operations/attempt-1/continue",
    ]);
  });

  it("leaves a continuation it could not start to the inbox sweep", async () => {
    respond(200, 409);
    const swept = vi.fn();
    const unsubscribe = clientOperationHandlerRegistry.subscribe(swept);
    try {
      await expect(stopWaitingForCall("attempt-1")).resolves.toBe("stopped");
      expect(swept).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it("reports a call that had already ended, without continuing it", async () => {
    const fetchMock = respond(409);
    await expect(stopWaitingForCall("attempt-1")).resolves.toBe("settled");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws on any other refusal", async () => {
    respond(404);
    await expect(stopWaitingForCall("attempt-1")).rejects.toMatchObject({
      status: 404,
    });
  });
});
