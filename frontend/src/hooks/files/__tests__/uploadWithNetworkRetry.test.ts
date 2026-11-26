import { describe, expect, it, vi } from "vitest";

import {
  createConnectivityMonitor,
  isNetworkFailure,
  markNetworkFailure,
} from "@/lib/connectivity/connectivity";

import { UploadNetworkError, UploadUnknownError } from "../errors";
import {
  UploadTimedOutError,
  uploadTimeLimitMs,
  uploadWithNetworkRetry,
} from "../uploadWithNetworkRetry";

const noSleep = () => Promise.resolve();

function dropped() {
  return markNetworkFailure({
    name: "unknown",
    message: "Network error (Load failed)",
  });
}

describe("uploadWithNetworkRetry", () => {
  it("sends again once the server answers the probe", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null));
    const connectivity = createConnectivityMonitor({ fetchImpl });
    const send = vi
      .fn()
      .mockImplementationOnce(() => {
        connectivity.reportNetworkFailure();
        return Promise.reject(dropped());
      })
      .mockResolvedValueOnce({ files: [{ id: "f1" }] });

    await expect(
      uploadWithNetworkRetry(send, {
        timeLimitMs: 10_000,
        connectivity,
        sleep: noSleep,
      }),
    ).resolves.toEqual({ files: [{ id: "f1" }] });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits while the network is gone, says so, and goes on when it is back", async () => {
    let online = false;
    const fetchImpl = vi.fn(() =>
      online
        ? Promise.resolve(new Response(null))
        : Promise.reject(new TypeError("Load failed")),
    );
    const connectivity = createConnectivityMonitor({ fetchImpl });
    connectivity.reportNetworkFailure();
    await vi.waitFor(() => expect(connectivity.getStatus()).toBe("offline"));

    const waiting: boolean[] = [];
    const send = vi.fn().mockResolvedValue("done");
    const upload = uploadWithNetworkRetry(send, {
      timeLimitMs: 10_000,
      connectivity,
      onWaitingForNetwork: (value) => waiting.push(value),
      sleep: noSleep,
    });

    await vi.waitFor(() => expect(waiting).toEqual([true]));
    expect(send).not.toHaveBeenCalled();
    online = true;
    connectivity.reportNetworkSuccess();

    await expect(upload).resolves.toBe("done");
    expect(waiting).toEqual([true, false]);
  });

  it("gives up after the last try with a network failure", async () => {
    const connectivity = createConnectivityMonitor({
      fetchImpl: vi.fn().mockResolvedValue(new Response(null)),
    });
    const send = vi.fn().mockRejectedValue(dropped());

    const error = await uploadWithNetworkRetry(send, {
      timeLimitMs: 10_000,
      connectivity,
      maxAttempts: 3,
      sleep: noSleep,
    }).catch((e: unknown) => e);

    expect(send).toHaveBeenCalledTimes(3);
    expect(isNetworkFailure(error)).toBe(true);
    expect(new UploadNetworkError(error).message).toBe(
      "No connection to the server. Check your network and try again.",
    );
  });

  it("throws an answer from the server at once", async () => {
    const connectivity = createConnectivityMonitor();
    const tooLarge = { status: 413, payload: "too large" };
    const send = vi.fn().mockRejectedValue(tooLarge);

    await expect(
      uploadWithNetworkRetry(send, {
        timeLimitMs: 10_000,
        connectivity,
        sleep: noSleep,
      }),
    ).rejects.toBe(tooLarge);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("ends a request that gets no answer within the time limit", async () => {
    vi.useFakeTimers();
    try {
      const connectivity = createConnectivityMonitor({
        fetchImpl: vi.fn().mockResolvedValue(new Response(null)),
      });
      const send = vi.fn(
        (signal: AbortSignal) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const upload = uploadWithNetworkRetry(send, {
        timeLimitMs: 1_000,
        connectivity,
        maxAttempts: 1,
        sleep: noSleep,
      }).catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(1_000);
      const error = await upload;
      expect(error).toBeInstanceOf(UploadTimedOutError);
      expect(new UploadNetworkError(error).message).toBe(
        "The server did not answer in time. Please try again.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("scales the time limit with the upload size", () => {
    expect(uploadTimeLimitMs(0)).toBe(60_000);
    expect(uploadTimeLimitMs(10 * 1024 * 1024)).toBeGreaterThan(260_000);
  });
});

describe("upload error texts", () => {
  it("never shows [object Object]", () => {
    const error = new UploadUnknownError({ status: 500, payload: "{}" });
    expect(error.message).not.toContain("[object Object]");
  });
});
