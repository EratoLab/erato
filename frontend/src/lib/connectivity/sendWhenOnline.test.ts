import { describe, expect, it, vi } from "vitest";

import { SignedOutError } from "@/auth/authRecovery";
import {
  UploadNetworkError,
  UploadUnknownError,
  toUploadError,
} from "@/hooks/files/errors";
import { uploadTimeLimitMs } from "@/hooks/files/uploadTimeLimit";

import {
  createConnectivityMonitor,
  isNetworkFailure,
  markNetworkFailure,
} from "./connectivity";
import { sendWhenOnline } from "./sendWhenOnline";

const signedIn = () => Promise.resolve(true);

function dropped() {
  return markNetworkFailure({
    name: "unknown",
    message: "Network error (Load failed)",
  });
}

function reachableMonitor() {
  return createConnectivityMonitor({
    fetchImpl: vi.fn().mockResolvedValue(new Response(null)),
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

describe("sendWhenOnline", () => {
  it("sends again once the server answers the probe", async () => {
    const connectivity = reachableMonitor();
    const send = vi
      .fn()
      .mockImplementationOnce(() => {
        connectivity.reportNetworkFailure();
        return Promise.reject(dropped());
      })
      .mockResolvedValueOnce({ files: [{ id: "f1" }] });

    await expect(
      sendWhenOnline(send, { connectivity, stillSignedIn: signedIn }),
    ).resolves.toEqual({ files: [{ id: "f1" }] });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits while the network is gone, says so, and goes on when it is back", async () => {
    const { connectivity, comeBack } = offlineMonitor();
    connectivity.reportNetworkFailure();
    await vi.waitFor(() => expect(connectivity.getStatus()).toBe("offline"));

    const waiting: boolean[] = [];
    const send = vi.fn().mockResolvedValue("done");
    const upload = sendWhenOnline(send, {
      connectivity,
      onWaitingForNetwork: (value: boolean) => waiting.push(value),
      stillSignedIn: signedIn,
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

    const error = await sendWhenOnline(send, {
      connectivity,
      onWaitingForNetwork: (value: boolean) => waiting.push(value),
      networkWaitMs: 700,
      stillSignedIn: signedIn,
    }).catch((e: unknown) => e);

    expect(send).toHaveBeenCalledTimes(1);
    expect(isNetworkFailure(error)).toBe(true);
    expect(waiting).toEqual([true, false]);
  });

  it("gives up after the last try with a network failure", async () => {
    const send = vi.fn().mockRejectedValue(dropped());

    const error = await sendWhenOnline(send, {
      connectivity: reachableMonitor(),
      maxAttempts: 2,
      stillSignedIn: signedIn,
    }).catch((e: unknown) => e);

    expect(send).toHaveBeenCalledTimes(2);
    expect(toUploadError(error, ["a.txt"]).message).toBe(
      "No connection to the server. Check your network and try again.",
    );
  });

  it("throws an answer from the server at once", async () => {
    const tooLarge = { status: 413, payload: "too large" };
    const send = vi.fn().mockRejectedValue(tooLarge);

    await expect(
      sendWhenOnline(send, {
        connectivity: reachableMonitor(),
        stillSignedIn: signedIn,
      }),
    ).rejects.toBe(tooLarge);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops and says so when the session ended instead of the network", async () => {
    const send = vi.fn().mockRejectedValue(dropped());

    const error = await sendWhenOnline(send, {
      connectivity: reachableMonitor(),
      stillSignedIn: () => Promise.resolve(false),
    }).catch((e: unknown) => e);

    expect(send).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(SignedOutError);
    expect(toUploadError(error, ["a.txt"]).message).toBe(
      "You are signed out. Reload to sign in again.",
    );
  });

  it("does not send again when the caller refuses a second copy", async () => {
    const send = vi.fn().mockRejectedValue(dropped());

    await expect(
      sendWhenOnline(send, {
        connectivity: reachableMonitor(),
        mayResend: () => false,
        stillSignedIn: signedIn,
      }),
    ).rejects.toSatisfy(isNetworkFailure);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("ends the wait when the caller cancels", async () => {
    const { connectivity } = offlineMonitor();
    connectivity.reportNetworkFailure();
    await vi.waitFor(() => expect(connectivity.getStatus()).toBe("offline"));
    const controller = new AbortController();
    const send = vi.fn().mockResolvedValue("done");

    const upload = sendWhenOnline(send, {
      connectivity,
      signal: controller.signal,
      stillSignedIn: signedIn,
    }).catch((e: unknown) => e);
    controller.abort(new Error("left the chat"));

    expect(await upload).toEqual(new Error("left the chat"));
    expect(send).not.toHaveBeenCalled();
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

  it("scales the upload time limit with the size", () => {
    expect(uploadTimeLimitMs(0)).toBe(120_000);
    expect(uploadTimeLimitMs(10 * 1024 * 1024)).toBeGreaterThan(600_000);
  });
});
