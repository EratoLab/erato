import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import {
  checkMcpConnection,
  clearMcpAuthorization,
  useMcpAuthorizationStore,
} from "@/lib/mcpAuthorization";

import { toast } from "../Toast";

import type { ToastInput } from "../Toast";
import type { McpAuthorizationPhase } from "@/lib/mcpAuthorization";

/**
 * One toast slot per server: emitting a new phase replaces the previous one
 * instead of stacking a history of the same connection attempt.
 */
export const mcpAuthorizationToastKey = (serverId: string) =>
  `mcp-authorization:${serverId}`;

/**
 * A phase only clears the runtime state if it is still the phase the toast was
 * emitted for. A dismissal that arrives after a retry has already started must
 * not abort the new operation — the same fence the store uses for late
 * responses.
 */
const clearIfUnchanged = (serverId: string, phase: McpAuthorizationPhase) => {
  if (useMcpAuthorizationStore.getState().phases[serverId] === phase)
    clearMcpAuthorization(serverId);
};

export interface McpAuthorizationToastContext {
  /** Re-runs the readiness check; never starts a second grant. */
  onCheck: () => void;
  /**
   * Where the browser was sent for the grant, when a host handed authorization
   * off to it. Present only while waiting.
   */
  browserUrl?: string;
}

/**
 * The toast for a phase, or null where the row carries the state on its own.
 *
 * Progress lives on the server's row (a pending status), so only the two
 * moments that need the user say anything here: a wait they have to act on in
 * another tab, and the outcome. Outcomes are events — a toast states that one
 * happened, where the old banner claimed a truth it then had to keep
 * reconciling against the server list.
 */
export function mcpAuthorizationToast(
  serverId: string,
  phase: McpAuthorizationPhase,
  { onCheck, browserUrl }: McpAuthorizationToastContext,
): ToastInput | null {
  const dedupeKey = mcpAuthorizationToastKey(serverId);
  const onDismiss = () => clearIfUnchanged(serverId, phase);
  const stopWaiting = {
    id: "mcp-authorization-stop",
    label: t({
      id: "preferences.dialog.mcpServers.oauth.stopWaiting",
      message: "Stop waiting",
    }),
    onClick: () => clearMcpAuthorization(serverId),
  };
  const check = {
    id: "mcp-authorization-check",
    label: t({
      id: "preferences.dialog.mcpServers.oauth.check",
      message: "Check connection",
    }),
    variant: "primary" as const,
    onClick: onCheck,
  };

  switch (phase) {
    // Opening and finishing are over in a moment and cannot be acted on; the
    // row's pending status is the whole story.
    case "starting":
    case "finishing":
      return null;
    case "waiting":
      // Only a host that handed the grant to another tab can still show a
      // toast — a full-page redirect has already left this document.
      if (!browserUrl) return null;
      return {
        variant: "info",
        dedupeKey,
        title: t({
          id: "preferences.dialog.mcpServers.oauth.waiting.title",
          message: "Waiting for authorization",
        }),
        description: t({
          id: "preferences.dialog.mcpServers.oauth.waiting.description",
          message: "Complete the steps in your browser using the same account.",
        }),
        actions: [
          {
            id: "mcp-authorization-reopen",
            label: t({
              id: "preferences.dialog.mcpServers.oauth.reopen",
              message: "Open authorization page again",
            }),
            // A link, not another window.open: the blocker that swallowed the
            // first popup would swallow a second one too.
            href: browserUrl,
          },
          stopWaiting,
        ],
        onDismiss,
      };
    case "connected":
      return {
        variant: "success",
        dedupeKey,
        title: t({
          id: "preferences.dialog.mcpServers.oauth.connected.title",
          message: "Authorization complete",
        }),
        description: t({
          id: "preferences.dialog.mcpServers.oauth.connected.description",
          message: "The server is ready to use.",
        }),
        onDismiss,
      };
    case "denied":
      // The user declined; offering to check a connection they just refused
      // would only restate the refusal.
      return {
        variant: "warning",
        dedupeKey,
        title: t({
          id: "preferences.dialog.mcpServers.oauth.denied.title",
          message: "Authorization was not granted",
        }),
        description: t({
          id: "preferences.dialog.mcpServers.oauth.denied.description",
          message: "You can try again when you are ready.",
        }),
        onDismiss,
      };
    case "unavailable":
      return {
        variant: "warning",
        dedupeKey,
        title: t({
          id: "preferences.dialog.mcpServers.oauth.unavailable.title",
          message: "Could not confirm the server connection",
        }),
        description: t({
          id: "preferences.dialog.mcpServers.oauth.unavailable.description",
          message: "Check the connection again after completing authorization.",
        }),
        actions: [check],
        onDismiss,
      };
    case "timeout":
      return {
        variant: "warning",
        dedupeKey,
        title: t({
          id: "preferences.dialog.mcpServers.oauth.timeout.title",
          message: "The connection has not been confirmed yet",
        }),
        description: t({
          id: "preferences.dialog.mcpServers.oauth.timeout.description",
          message: "Check again before starting another authorization.",
        }),
        actions: [check],
        onDismiss,
      };
    default:
      return {
        variant: "error",
        dedupeKey,
        title: t({
          id: "preferences.dialog.mcpServers.oauth.error.title",
          message: "Could not complete authorization",
        }),
        description: t({
          id: "preferences.dialog.mcpServers.oauth.error.description",
          message: "Check the connection or try authorizing again.",
        }),
        actions: [check],
        onDismiss,
      };
  }
}

/** Emits the phase's toast, or dismisses the server's slot when it has none. */
function showMcpAuthorizationToast(
  serverId: string,
  phase: McpAuthorizationPhase | undefined,
  context: McpAuthorizationToastContext,
) {
  const input = phase ? mcpAuthorizationToast(serverId, phase, context) : null;
  if (input) {
    toast.custom(input);
    return;
  }
  toast.dismissKey(mcpAuthorizationToastKey(serverId));
}

/**
 * Keeps each server's toast slot in step with its authorization phase.
 *
 * This belongs to the app, not to the settings pane: an authorization the user
 * started there outlives the dialog they started it from, and its outcome has
 * to reach them wherever they are when it lands — otherwise closing settings
 * mid-flow strands a wait that nothing ever answers.
 */
export function useMcpAuthorizationToasts() {
  const queryClient = useQueryClient();
  const phases = useMcpAuthorizationStore((state) => state.phases);
  const browserUrls = useMcpAuthorizationStore((state) => state.browserUrls);
  const announced = useRef(new Map<string, string>());
  useEffect(() => {
    // Read through to the live store rather than this render's snapshot: the
    // pane reconciles phases against the authoritative server list in its own
    // effect, and a phase it just retired must not be announced anyway.
    const state = useMcpAuthorizationStore.getState();
    const serverIds = new Set([
      ...Object.keys(state.phases),
      ...announced.current.keys(),
    ]);
    for (const serverId of serverIds) {
      const phase = state.phases[serverId];
      const browserUrl = state.browserUrls[serverId];
      const key = `${phase ?? ""}:${browserUrl ?? ""}`;
      if (announced.current.get(serverId) === key) continue;
      if (phase) announced.current.set(serverId, key);
      else announced.current.delete(serverId);
      showMcpAuthorizationToast(serverId, phase, {
        browserUrl,
        onCheck: () => void checkMcpConnection(queryClient, serverId),
      });
    }
  }, [phases, browserUrls, queryClient]);
}

/**
 * Mount once beside the app's `<Toaster />`, in every host that can authorize
 * an MCP server.
 */
export function McpAuthorizationToasts() {
  useMcpAuthorizationToasts();
  return null;
}
