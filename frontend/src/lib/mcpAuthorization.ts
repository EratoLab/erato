import { create } from "zustand";

import {
  fetchCompleteMcpServerOauth,
  fetchListMcpServerTools,
  fetchStartMcpServerOauth,
  listMcpServersQuery,
  listMcpServerToolsQuery,
} from "./generated/v1betaApi/v1betaApiComponents";
import { storeMcpOauthCallback } from "./mcpOauthCallback";

import type { ListMcpServersResponse } from "./generated/v1betaApi/v1betaApiSchemas";
import type { McpOauthCallback } from "./mcpOauthCallback";
import type { QueryClient } from "@tanstack/react-query";

export type McpAuthorizationPhase =
  | "starting"
  | "waiting"
  | "finishing"
  | "connected"
  | "denied"
  | "unavailable"
  | "error"
  | "timeout";

export const isMcpAuthorizationPending = (phase?: McpAuthorizationPhase) =>
  phase === "starting" || phase === "waiting" || phase === "finishing";

export const useMcpAuthorizationStore = create<{
  phases: Record<string, McpAuthorizationPhase | undefined>;
  browserUrls: Record<string, string | undefined>;
}>(() => ({ phases: {}, browserUrls: {} }));

interface Operation {
  controller: AbortController;
  dispose: () => void;
}

// Runtime-owned, not dialog-owned: closing settings doesn't lose an operation.
// The operation identity fences late responses after a retry or cancellation.
const operations = new Map<string, Operation>();
const callbacks = new Map<string, Promise<void>>();

function phase(serverId: string, value: McpAuthorizationPhase | undefined) {
  useMcpAuthorizationStore.setState(({ phases, browserUrls }) => ({
    phases: { ...phases, [serverId]: value },
    browserUrls:
      value === "waiting"
        ? browserUrls
        : { ...browserUrls, [serverId]: undefined },
  }));
}

function begin(serverId: string, initial: McpAuthorizationPhase) {
  if (operations.has(serverId)) return null;
  const operation: Operation = {
    controller: new AbortController(),
    dispose: () => {},
  };
  operations.set(serverId, operation);
  phase(serverId, initial);
  return operation;
}

function finish(
  serverId: string,
  operation: Operation,
  value: McpAuthorizationPhase,
) {
  if (operations.get(serverId) !== operation) return;
  operation.dispose();
  operation.controller.abort();
  operations.delete(serverId);
  phase(serverId, value);
}

export function clearMcpAuthorization(serverId: string) {
  const operation = operations.get(serverId);
  if (operation) {
    operation.dispose();
    operation.controller.abort();
    operations.delete(serverId);
  }
  phase(serverId, undefined);
}

async function connected(
  queryClient: QueryClient,
  serverId: string,
  operation: Operation,
) {
  if (operations.get(serverId) !== operation) return;
  // Discard an older live probe before applying the confirmed result. Never
  // make this server's confirmation wait for a fresh probe of every server.
  const queryKey = listMcpServersQuery({}).queryKey;
  await queryClient.cancelQueries({ queryKey });
  if (operations.get(serverId) !== operation) return;
  queryClient.setQueryData<ListMcpServersResponse>(queryKey, (current) =>
    current
      ? {
          ...current,
          servers: current.servers.map((server) =>
            server.id === serverId
              ? { ...server, connection_status: "SUCCESS" }
              : server,
          ),
        }
      : undefined,
  );
  void queryClient.invalidateQueries({
    queryKey: listMcpServerToolsQuery({ pathParams: { serverId } }).queryKey,
  });
  finish(serverId, operation, "connected");
}

export async function startMcpAuthorization(serverId: string) {
  const operation = begin(serverId, "starting");
  if (!operation) return;
  const timer = window.setTimeout(
    () => finish(serverId, operation, "timeout"),
    60_000,
  );
  operation.dispose = () => window.clearTimeout(timer);
  try {
    const response = await fetchStartMcpServerOauth(
      { pathParams: { serverId } },
      operation.controller.signal,
    );
    if (operations.get(serverId) !== operation) return;
    storeMcpOauthCallback(response.authorization_url, serverId);
    phase(serverId, "waiting");
    window.location.href = response.authorization_url;
  } catch {
    finish(serverId, operation, "error");
  }
  // Keep the guard through navigation. If navigation fails or the user goes
  // Back, its bounded timer restores a retryable state instead of hanging.
}

export function completeMcpAuthorization(
  queryClient: QueryClient,
  callback: McpOauthCallback,
): Promise<void> {
  const existing = callbacks.get(callback.state);
  if (existing) return existing;
  const task = complete(queryClient, callback);
  callbacks.set(callback.state, task);
  return task;
}

async function complete(queryClient: QueryClient, callback: McpOauthCallback) {
  const { serverId } = callback;
  clearMcpAuthorization(serverId);
  const operation = begin(serverId, "finishing");
  if (!operation) return;
  if (callback.error) {
    finish(serverId, operation, "denied");
    return;
  }
  if (!callback.code) {
    finish(serverId, operation, "error");
    return;
  }
  const timer = window.setTimeout(
    () => finish(serverId, operation, "timeout"),
    90_000,
  );
  operation.dispose = () => window.clearTimeout(timer);
  try {
    const response = await fetchCompleteMcpServerOauth(
      {
        pathParams: { serverId },
        queryParams: {
          code: callback.code,
          state: callback.state,
          ...(callback.iss ? { iss: callback.iss } : {}),
        },
      },
      operation.controller.signal,
    );
    if (response.connection_status === "SUCCESS") {
      await connected(queryClient, serverId, operation);
    } else {
      finish(
        serverId,
        operation,
        response.connection_status === "FAILURE" ? "unavailable" : "error",
      );
    }
  } catch {
    if (operations.get(serverId) !== operation) return;
    // A lost response/reloaded callback may already have consumed the code.
    // Read actual readiness once instead of automatically replaying the grant.
    try {
      const result = await fetchListMcpServerTools(
        { pathParams: { serverId } },
        operation.controller.signal,
      );
      if (result.status === "SUCCESS") {
        await connected(queryClient, serverId, operation);
        return;
      }
    } catch {
      /* The original failure remains actionable. */
    }
    finish(serverId, operation, "error");
  }
}

/** An explicit retry checks readiness once; it doesn't initiate another grant. */
export async function checkMcpConnection(
  queryClient: QueryClient,
  serverId: string,
) {
  const operation = begin(serverId, "finishing");
  if (!operation) return;
  const timer = window.setTimeout(
    () => finish(serverId, operation, "unavailable"),
    20_000,
  );
  operation.dispose = () => window.clearTimeout(timer);
  try {
    const result = await fetchListMcpServerTools(
      { pathParams: { serverId } },
      operation.controller.signal,
    );
    if (result.status === "SUCCESS") {
      await connected(queryClient, serverId, operation);
    } else {
      finish(
        serverId,
        operation,
        result.status === "FAILURE" ? "unavailable" : "error",
      );
    }
  } catch {
    finish(serverId, operation, "unavailable");
  }
}

/** Observe only the selected server after an explicit browser handoff.
 * No shared storage/opener assumptions, overlapping probes or idle polling.
 * Dead servers stop on the first failure. Consent waits back off to one
 * request per minute and end after ten minutes (including suspended panes).
 */
export function watchMcpAuthorization(
  queryClient: QueryClient,
  serverId: string,
  openBrowser: () => void,
  browserUrl?: string,
) {
  const operation = begin(serverId, "waiting");
  if (!operation) return;
  useMcpAuthorizationStore.setState(({ browserUrls }) => ({
    browserUrls: { ...browserUrls, [serverId]: browserUrl },
  }));
  const deadline = Date.now() + 10 * 60_000;
  let timer: number | undefined;
  let inFlight = false;
  let interval = 3_000;
  let lastProbe = 0;
  const probe = async () => {
    if (operations.get(serverId) !== operation || inFlight) return;
    if (Date.now() >= deadline) {
      finish(serverId, operation, "timeout");
      return;
    }
    // Focus/visibility can fire together. They cannot bypass the backoff.
    if (Date.now() - lastProbe < interval) return;
    window.clearTimeout(timer);
    lastProbe = Date.now();
    inFlight = true;
    const requestTimer = window.setTimeout(
      () => finish(serverId, operation, "unavailable"),
      20_000,
    );
    try {
      const result = await fetchListMcpServerTools(
        { pathParams: { serverId } },
        operation.controller.signal,
      );
      if (operations.get(serverId) !== operation) return;
      if (result.status === "SUCCESS") {
        await connected(queryClient, serverId, operation);
      } else if (result.status === "FAILURE") {
        finish(serverId, operation, "unavailable");
      } else {
        interval = Math.min(interval * 2, 60_000);
        timer = window.setTimeout(
          () => {
            void probe();
          },
          Math.min(interval, deadline - Date.now()),
        );
      }
    } catch {
      finish(serverId, operation, "unavailable");
    } finally {
      window.clearTimeout(requestTimer);
      inFlight = false;
    }
  };
  const onReturn = () => {
    if (document.visibilityState !== "hidden") void probe();
  };
  operation.dispose = () => {
    window.clearTimeout(timer);
    window.removeEventListener("focus", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
  };
  try {
    // Launch synchronously in the click handler to retain user activation.
    openBrowser();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    timer = window.setTimeout(() => {
      void probe();
    }, interval);
  } catch {
    finish(serverId, operation, "error");
  }
}
