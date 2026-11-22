import { onlineManager } from "@tanstack/react-query";

import { useValueStore } from "@/utils/chat/valueStore";

import {
  connectivity,
  connectivityStatus,
  type ConnectivityStatus,
} from "./connectivity";

export function useConnectivityStatus(): ConnectivityStatus {
  return useValueStore(connectivityStatus);
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
    const update = () => setOnline(connectivity.getStatus() === "online");
    update();
    return connectivity.subscribe(update);
  });
}
