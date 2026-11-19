import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { connectivity, type ConnectivityStatus } from "./connectivity";

export function useConnectivityStatus(): ConnectivityStatus {
  return useSyncExternalStore(
    connectivity.subscribe,
    connectivity.getStatus,
    () => "online",
  );
}

let queryConnectivityInstalled = false;

/**
 * Lets React Query pause queries and their retries while the server is
 * unreachable, and refetch once it is back. Replaces React Query's own
 * `online`/`offline` listener, which the monitor already covers.
 */
export function connectQueryClientToConnectivity(): void {
  if (queryConnectivityInstalled) {
    return;
  }
  queryConnectivityInstalled = true;
  onlineManager.setEventListener((setOnline) => {
    setOnline(connectivity.getStatus() === "online");
    return connectivity.subscribe((status) => setOnline(status === "online"));
  });
}
