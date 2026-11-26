import { describe, expect, it, vi } from "vitest";

import {
  createConnectivityMonitor,
  isNetworkFailure,
  markNetworkFailure,
} from "@/lib/connectivity/connectivity";

import {
  UploadNetworkError,
  UploadUnknownError,
  toUploadError,
} from "../errors";
import {
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

function offlineMonitor() {
  let online = false;
  const connectivity = createConnectivityMonitor({
    fetchImpl: vi.fn(() =>
      online
        ? Promise.resolve(new Response(null))
        : Promise.reject(new TypeError("Load failed")),
    ),
  });
  return {
    connectivity,
    comeBack: () => {
      online = true;
      connectivity.reportNetworkSuccess();
    },
  };
}

describe("uploadWithNetworkRetry", () => {
  it("sends again once the server answers the probe", async () => {
    const connectivity = createConnectivityMonitor({
      fetchImpl: vi.fn().mockResolvedValue(new Response(null)),
    });
    const send = vi
      .fn()
      .mockImplementationOnce(() => {
        connectivity.reportNetworkFailure();
        return Promise.reject(dropped());
      })
      .mockResolvedValueOnce({ files: [{ id: "f1" }] });

    await expect(
      uploadWithNetworkRetry(send, { connectivity, sleep: noSleep }),
    ).resolves.toEqual({ files: [{ id: "f1" }] });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits while the network is gone, says so, and goes on when it is back", async () => {
    const { connectivity, comeBack } = offlineMonitor();
    connectivity.reportNetworkFailure();
    await vi.waitFor(() => expect(connectivity.getStatus()).toBe("offline"));

    const waiting: boolean[] = [];
    const send = vi.fn().mockResolvedValue("done");
    const upload = uploadWithNetworkRetry(send, {
      connectivity,
      onWaitingForNetwork: (value) => waiting.push(value),
      sleep: noSleep,
    });

    await vi.waitFor(() => expect(waiting).toEqual([true]));
    expect(send).not.toHaveBeenCalled();
    comeBack();

    await expect(upload).resolves.toBe("done");
    expect(waiting).toEqual([true, false]);
  });

  it("says it is waiting and stops at the wait limit when a running probe finds the network gone", async () => {
    const { connectivity } = offlineMonitor();
    const waiting: boolean[] = [];
    const send = vi.fn(() => {
      // The failed send starts a probe that is still out when the wait begins.
      connectivity.reportNetworkFailure();
      return Promise.reject(dropped());
    });

    const error = await uploadWithNetworkRetry(send, {
      connectivity,
      onWaitingForNetwork: (value) => waiting.push(value),
      networkWaitMs: 700,
      sleep: noSleep,
    }).catch((e: unknown) => e);

    expect(send).toHaveBeenCalledTimes(1);
    expect(isNetworkFailure(error)).toBe(true);
    expect(waiting).toEqual([true, false]);
  });

  it("gives up after the last try with a network failure", async () => {
    const connectivity = createConnectivityMonitor({
      fetchImpl: vi.fn().mockResolvedValue(new Response(null)),
    });
    const send = vi.fn().mockRejectedValue(dropped());

    const error = await uploadWithNetworkRetry(send, {
      connectivity,
      maxAttempts: 3,
      sleep: noSleep,
    }).catch((e: unknown) => e);

    expect(send).toHaveBeenCalledTimes(3);
    expect(toUploadError(error, ["a.txt"]).message).toBe(
      "No connection to the server. Check your network and try again.",
    );
  });

  it("throws an answer from the server at once", async () => {
    const connectivity = createConnectivityMonitor();
    const tooLarge = { status: 413, payload: "too large" };
    const send = vi.fn().mockRejectedValue(tooLarge);

    await expect(
      uploadWithNetworkRetry(send, { connectivity, sleep: noSleep }),
    ).rejects.toBe(tooLarge);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("scales the time limit with the upload size", () => {
    expect(uploadTimeLimitMs(0)).toBe(120_000);
    expect(uploadTimeLimitMs(10 * 1024 * 1024)).toBeGreaterThan(600_000);
  });
});

describe("upload error texts", () => {
  it("says a known failure in plain words alone", () => {
    const timedOut = markNetworkFailure(
      new Error("Network error (request timed out)"),
    );
    expect(toUploadError(timedOut, ["a.txt"])).toBeInstanceOf(
      UploadNetworkError,
    );
    expect(toUploadError(timedOut, ["a.txt"]).message).toBe(
      "The server did not answer in time. Please try again.",
    );
    expect(new UploadUnknownError({ status: 503, payload: "" }).message).toBe(
      "The server did not answer. Please try again in a moment.",
    );
  });

  it("never shows [object Object]", () => {
    const error = new UploadUnknownError({ status: 500, payload: "{}" });
    expect(error.message).not.toContain("[object Object]");
    expect(error.message).not.toContain(":");
  });
});
