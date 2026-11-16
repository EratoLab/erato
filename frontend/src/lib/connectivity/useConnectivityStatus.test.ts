import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { connectivity } from "./connectivity";
import { connectQueryClientToConnectivity } from "./useConnectivityStatus";

import type { ConnectivityStatus } from "./connectivity";

describe("connectQueryClientToConnectivity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pauses React Query while the connection is lost and resumes it once back", () => {
    let notify: (status: ConnectivityStatus) => void = () => {};
    vi.spyOn(connectivity, "getStatus").mockReturnValue("online");
    vi.spyOn(connectivity, "subscribe").mockImplementation((listener) => {
      notify = listener;
      return () => {};
    });

    connectQueryClientToConnectivity();
    expect(onlineManager.isOnline()).toBe(true);

    notify("offline");
    expect(onlineManager.isOnline()).toBe(false);

    notify("online");
    expect(onlineManager.isOnline()).toBe(true);
  });
});
