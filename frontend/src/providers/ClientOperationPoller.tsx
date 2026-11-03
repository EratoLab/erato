import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useProfileApi } from "@/hooks/profile/useProfileApi";
import {
  ClientOperationCoordinator,
  clientOperationApi,
} from "@/lib/clientOperations/coordinator";

/** Inbox cadence; the idle load of an authenticated shell. Handlers ask for
 * an immediate sweep when something changes in between. */
const SWEEP_INTERVAL_MS = 10_000;

/**
 * Runs the signed-in account's durable client operations in this shell: one
 * coordinator per account, swept on a steady cadence, on focus and on
 * reconnect, until the backend reports them disabled. Renders nothing.
 */
export function ClientOperationPoller() {
  const { profile, error, refreshProfile } = useProfileApi();
  const [coordinator, setCoordinator] =
    useState<ClientOperationCoordinator | null>(null);
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : undefined;
  // Retain cached identity during transient profile failures. Auth failures and
  // the coordinator's authoritative account comparison still dispose old work.
  const accountId = status === 401 || status === 403 ? undefined : profile?.id;
  useEffect(() => {
    if (!accountId) {
      setCoordinator(null);
      return;
    }
    const instance = new ClientOperationCoordinator(
      accountId,
      clientOperationApi,
      [],
      () => {
        void refreshProfile();
      },
    );
    setCoordinator(instance);
    return () => {
      instance.dispose();
    };
  }, [accountId, refreshProfile]);
  useQuery({
    queryKey: ["client-operations-coordinator", accountId],
    enabled: !!coordinator && coordinator.accountId === accountId,
    queryFn: async () => {
      await coordinator?.reconcile();
      // Cache only cloud enablement, never operation payloads.
      return { enabled: coordinator?.enabled ?? false };
    },
    refetchInterval: (query) =>
      query.state.data?.enabled === false ? false : SWEEP_INTERVAL_MS,
    refetchOnWindowFocus: (query) =>
      query.state.data?.enabled === false ? false : "always",
    refetchOnReconnect: (query) =>
      query.state.data?.enabled === false ? false : "always",
    retry: false,
    gcTime: 0,
  });
  return null;
}
