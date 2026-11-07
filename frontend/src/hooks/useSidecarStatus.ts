import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";

import type { SidecarStatusV1Result } from "@erato/desktop-sidecar-protocol";
import type { UseQueryResult } from "@tanstack/react-query";

/**
 * `sidecar.status.v1`, polled every 10 s while a component shows it; one
 * query serves the permission list and the desktop UI package line.
 */
export function useSidecarStatus(): UseQueryResult<
  SidecarStatusV1Result,
  Error
> & { supported: boolean } {
  const { client, snapshot } = useDesktopSidecar();
  const supported =
    snapshot.state === "ready" && !!client?.supports("sidecar.status.v1");
  const query = useQuery<SidecarStatusV1Result, Error>({
    queryKey: ["sidecar-status", snapshot.instanceId],
    enabled: supported,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: ({ signal }) => {
      if (!client) throw new Error("Sidecar unavailable");
      return client.invoke("sidecar.status.v1", {}, { signal });
    },
  });
  const { refetch } = query;
  useEffect(() => {
    if (!supported) return;
    // Returning from System Settings focuses the window without changing its
    // visibility, which is all react-query's focus refetch listens to.
    const onFocus = () => void refetch({ cancelRefetch: false });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch, supported]);
  return { ...query, supported };
}
