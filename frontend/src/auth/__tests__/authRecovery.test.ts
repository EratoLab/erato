import { afterEach, describe, expect, it, vi } from "vitest";

import { setAuthRecoveryHandler, tryRecoverAuth } from "../authRecovery";

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
