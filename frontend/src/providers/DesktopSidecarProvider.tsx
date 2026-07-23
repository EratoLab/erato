"use client";

import {
  DesktopSidecarClient,
  HttpTransport,
  createBrowserClientInfo,
} from "@erato/desktop-sidecar-protocol";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { useOrganizationConfiguration } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type {
  SidecarClientInfo,
  SidecarSnapshot,
} from "@erato/desktop-sidecar-protocol";
import type { PropsWithChildren } from "react";

declare global {
  interface Window {
    DESKTOP_SIDECAR_URL?: string;
  }
}

export interface DesktopSidecarContextValue {
  client: DesktopSidecarClient | null;
  snapshot: SidecarSnapshot;
}

export interface DesktopSidecarProviderProps extends PropsWithChildren {
  endpoint?: string | null;
  clientInfo?: SidecarClientInfo;
  retryDiscovery?: boolean;
}

const emptySnapshot: SidecarSnapshot = {
  state: "unavailable",
  protocolVersion: null,
  serverInfo: null,
  instanceId: null,
  catalogue: null,
  capabilities: new Map(),
  error: null,
};

const DesktopSidecarContext = createContext<DesktopSidecarContextValue>({
  client: null,
  snapshot: emptySnapshot,
});

export function resolveDesktopSidecarEndpoint(): string | null {
  const configured =
    import.meta.env.VITE_DESKTOP_SIDECAR_URL ??
    window.DESKTOP_SIDECAR_URL ??
    null;
  return configured && configured.trim() !== "" ? configured : null;
}

function defaultClientInfo(): SidecarClientInfo {
  const officeAddin = window.FRONTEND_PLATFORM === "platform-office-addin";
  return createBrowserClientInfo({
    name: officeAddin ? "erato-office-addin" : "erato-web",
    version: import.meta.env.VITE_APP_VERSION ?? "unversioned",
    hostApplication: officeAddin ? "Microsoft Office add-in" : "browser",
  });
}

export function DesktopSidecarProvider({
  children,
  endpoint = resolveDesktopSidecarEndpoint(),
  clientInfo,
  retryDiscovery = true,
}: DesktopSidecarProviderProps) {
  const resolvedClientInfo = useMemo(
    () => clientInfo ?? defaultClientInfo(),
    [clientInfo],
  );
  const [value, setValue] = useState<DesktopSidecarContextValue>({
    client: null,
    snapshot: emptySnapshot,
  });

  useEffect(() => {
    if (!endpoint) {
      setValue({ client: null, snapshot: emptySnapshot });
      return;
    }

    const abortController = new AbortController();
    const client = new DesktopSidecarClient({
      transport: new HttpTransport(endpoint),
      clientInfo: resolvedClientInfo,
    });
    let disposed = false;
    const unsubscribe = client.subscribe(() => {
      if (!disposed) setValue({ client, snapshot: client.getSnapshot() });
    });
    setValue({ client, snapshot: client.getSnapshot() });

    const run = async (): Promise<void> => {
      let retryDelayMs = 1_000;
      while (!disposed) {
        try {
          await client.discover(abortController.signal);
          return;
        } catch {
          // State and the typed error are exposed through the context snapshot.
        }
        if (abortController.signal.aborted || !retryDiscovery) return;
        await abortableDelay(retryDelayMs, abortController.signal).catch(
          () => undefined,
        );
        retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
      }
    };
    void run();

    return () => {
      disposed = true;
      abortController.abort();
      unsubscribe();
      client.reset();
    };
  }, [endpoint, resolvedClientInfo, retryDiscovery]);

  return (
    <DesktopSidecarContext.Provider value={value}>
      {children}
    </DesktopSidecarContext.Provider>
  );
}

export function useDesktopSidecar(): DesktopSidecarContextValue {
  return useContext(DesktopSidecarContext);
}

export function DesktopSidecarConfigurationSync() {
  const { client, snapshot } = useDesktopSidecar();
  const { data: organizationConfiguration } = useOrganizationConfiguration(
    {},
    { retry: false },
  );

  useEffect(() => {
    if (
      !client ||
      snapshot.state !== "ready" ||
      !client.supports("sidecar.configure.v1") ||
      !organizationConfiguration
    ) {
      return;
    }

    void client
      .invoke("sidecar.configure.v1", {
        user_configuration: { show_tray_icon: null },
        organization_configuration: organizationConfiguration,
      })
      .catch((error: unknown) => {
        console.warn("Failed to configure the Erato desktop sidecar:", error);
      });
  }, [client, organizationConfiguration, snapshot.instanceId, snapshot.state]);

  return null;
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
