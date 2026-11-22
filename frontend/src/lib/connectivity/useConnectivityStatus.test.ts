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
    let status: ConnectivityStatus = "online";
    let listener: () => void = () => {};
    vi.spyOn(connectivity, "getStatus").mockImplementation(() => status);
    vi.spyOn(connectivity, "subscribe").mockImplementation((next) => {
      listener = next;
      return () => {};
    });
    const notify = (next: ConnectivityStatus) => {
      status = next;
      listener();
    };

    connectQueryClientToConnectivity();
    expect(onlineManager.isOnline()).toBe(true);

    notify("offline");
    expect(onlineManager.isOnline()).toBe(false);

    notify("online");
    expect(onlineManager.isOnline()).toBe(true);
  });
});
