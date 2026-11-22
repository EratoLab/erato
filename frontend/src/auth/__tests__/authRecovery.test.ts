import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchWithAuthRecovery,
  isSignedOutResponse,
  setAuthRecoveryHandler,
  tryRecoverAuth,
} from "../authRecovery";

describe("authRecovery", () => {
  afterEach(() => {
    setAuthRecoveryHandler(null);
  });

  it("is a no-op returning false when no handler is registered (web app)", async () => {
    await expect(tryRecoverAuth("rest-401")).resolves.toBe(false);
  });

  it("runs the registered handler with the reason and returns its result", async () => {
    const handler = vi.fn().mockResolvedValue(true);
    setAuthRecoveryHandler(handler);

    await expect(tryRecoverAuth("sse-401")).resolves.toBe(true);
    expect(handler).toHaveBeenCalledWith("sse-401");
  });

  it("treats a throwing handler as a failed recovery", async () => {
    setAuthRecoveryHandler(vi.fn().mockRejectedValue(new Error("boom")));

    await expect(tryRecoverAuth("rest-401")).resolves.toBe(false);
  });

  it("stops invoking the handler once cleared with null", async () => {
    const handler = vi.fn().mockResolvedValue(true);
    setAuthRecoveryHandler(handler);
    setAuthRecoveryHandler(null);

    await expect(tryRecoverAuth("rest-401")).resolves.toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});

const response = (status: number, contentType?: string) =>
  new Response(status === 204 ? null : "body", {
    status,
    headers: contentType ? { "content-type": contentType } : {},
  });

describe("tryRecoverAuth after a renewal", () => {
  afterEach(() => {
    setAuthRecoveryHandler(null);
    vi.useRealTimers();
  });

  it("replays without another recovery for 30 s after one renewed the session", async () => {
    vi.useFakeTimers();
    const recover = vi.fn().mockResolvedValue(true);
    setAuthRecoveryHandler(recover);

    await expect(tryRecoverAuth("first")).resolves.toBe(true);
    await expect(tryRecoverAuth("second")).resolves.toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    await expect(tryRecoverAuth("third")).resolves.toBe(true);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it("tries again at once after a recovery that failed", async () => {
    const recover = vi.fn().mockResolvedValue(false);
    setAuthRecoveryHandler(recover);

    await tryRecoverAuth("first");
    await tryRecoverAuth("second");

    expect(recover).toHaveBeenCalledTimes(2);
  });
});

describe("isSignedOutResponse", () => {
  it("reads a 401 and the proxy's 403 sign-in page as signed out", () => {
    expect(isSignedOutResponse(response(401))).toBe(true);
    expect(isSignedOutResponse(response(403, "text/html; charset=utf-8"))).toBe(
      true,
    );
  });

  it("leaves the backend's own 403s and every other answer alone", () => {
    expect(isSignedOutResponse(response(403, "application/json"))).toBe(false);
    expect(isSignedOutResponse(response(403))).toBe(false);
    expect(isSignedOutResponse(response(200, "text/html"))).toBe(false);
    expect(isSignedOutResponse(response(500, "text/html"))).toBe(false);
  });
});

describe("fetchWithAuthRecovery", () => {
  afterEach(() => {
    setAuthRecoveryHandler(null);
  });

  it("renews the session and sends once more after a signed-out answer", async () => {
    const recover = vi.fn().mockResolvedValue(true);
    setAuthRecoveryHandler(recover);
    const send = vi
      .fn()
      .mockResolvedValueOnce(response(403, "text/html"))
      .mockResolvedValueOnce(response(403, "text/html"));

    const result = await fetchWithAuthRecovery(send, "test");

    expect(recover).toHaveBeenCalledWith("test");
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(403);
  });

  it("sends once when the answer is not signed out or the session cannot be renewed", async () => {
    const recover = vi.fn().mockResolvedValue(false);
    setAuthRecoveryHandler(recover);
    const ok = vi.fn().mockResolvedValue(response(200));
    await fetchWithAuthRecovery(ok, "test");
    expect(ok).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();

    const refused = vi.fn().mockResolvedValue(response(401));
    await fetchWithAuthRecovery(refused, "test");
    expect(refused).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("sends once without a recovery handler (the web app)", async () => {
    const send = vi.fn().mockResolvedValue(response(403, "text/html"));
    await fetchWithAuthRecovery(send, "test");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
