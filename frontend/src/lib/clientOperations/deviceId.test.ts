import { afterEach, describe, expect, it, vi } from "vitest";

import { clientOperationDeviceId } from "./deviceId";

const KEY = "erato.clientOperations.deviceId";

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.localStorage.clear();
});

describe("clientOperationDeviceId", () => {
  it("persists one id per origin", () => {
    const first = clientOperationDeviceId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(globalThis.localStorage.getItem(KEY)).toBe(first);
    expect(clientOperationDeviceId()).toBe(first);
  });

  it("replaces a stored value that is not a valid id", () => {
    globalThis.localStorage.setItem(KEY, "short");
    const id = clientOperationDeviceId();
    expect(id).not.toBe("short");
    expect(globalThis.localStorage.getItem(KEY)).toBe(id);
  });

  it("has no id without storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(clientOperationDeviceId()).toBeUndefined();
  });
});
